import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, type PDFObject } from 'pdf-lib';

import { createRedactionDecoder } from './redaction-bounded-decode';

type Value = PDFObject | undefined;
type Uses = { Font: Set<string>; XObject: Set<string>; ExtGState: Set<string> };
const newUses = (): Uses => ({ Font: new Set(), XObject: new Set(), ExtGState: new Set() });
const mergeUses = (target: Uses, source: Uses): void => { for (const family of ['Font', 'XObject', 'ExtGState'] as const) for (const name of source[family]) target[family].add(name); }; 
const k = PDFName.of;

/** Closed retained graph: only standard fonts, simple lossless images and ordinary
 * content streams. Ancillary roots must be removed before this check. No embedded
 * fonts, ICC profiles, custom encodings, masks, predictors or extensible dictionaries.
 * This is structural sanitization, not a claim about steganography in visible data. */
export function validateRetainedRedactionGraph(doc: PDFDocument, nativeOutput = false, decode = createRedactionDecoder(), pruneUnused = false): void {
  const refuse = (): never => { throw new Error('unsupported-structure'); };
  const resolve = (v: Value): Value => v instanceof PDFRef ? doc.context.lookup(v) : v;
  const dict = (v: Value): PDFDict => { const r = resolve(v); return r instanceof PDFDict ? r : refuse(); };
  const fields = (d: PDFDict, allowed: string[]): void => {
    for (const name of d.keys()) if (!allowed.includes(name.decodeText()) || name !== k(name.decodeText())) refuse();
  };
  const name = (v: Value, allowed: string[]): void => { if (!(v instanceof PDFName) || !allowed.includes(v.decodeText())) refuse(); };
  const number = (v: Value): number => { if (!(v instanceof PDFNumber) || !Number.isFinite(v.asNumber()) || Math.abs(v.asNumber()) > 1e8) refuse(); return (v as PDFNumber).asNumber(); };
  const numericArray = (v: Value, size: number): void => {
    const a = resolve(v); if (!(a instanceof PDFArray) || a.size() !== size) refuse();
    for (const value of (a as PDFArray).asArray()) number(value);
  };
  const optional = (d: PDFDict, field: string, check: (v: Value) => void): void => { if (d.has(k(field))) check(d.get(k(field))); };
  let budget = 0;
  const seenPages = new Set<PDFDict>();
  const active = new Set<PDFObject>();
  const enter = (v: PDFObject): void => { if (++budget > 100000 || active.has(v)) refuse(); active.add(v); };
  const stream = (v: Value, image = false, form = false): Uses => {
    if (!(v instanceof PDFRef)) refuse();
    const s = resolve(v); if (!(s instanceof PDFRawStream)) refuse();
    const raw = s as PDFRawStream, d = raw.dict;
    fields(d, ['Length', 'Filter', ...(image ? ['Type', 'Subtype', 'Width', 'Height', 'BitsPerComponent', 'ColorSpace'] : form ? ['Type', 'Subtype', 'FormType', 'BBox', 'Matrix', 'Resources'] : [])]);
    number(d.get(k('Length')));
    optional(d, 'Filter', v => name(v, ['FlateDecode']));
    const bytes = decode(raw);
    if (image) {
      name(d.get(k('Type')), ['XObject']); name(d.get(k('Subtype')), ['Image']);
      name(d.get(k('ColorSpace')), ['DeviceRGB', 'DeviceGray']);
      if (number(d.get(k('BitsPerComponent'))) !== 8) refuse();
      const w = number(d.get(k('Width'))), h = number(d.get(k('Height')));
      const channels = d.get(k('ColorSpace')) === k('DeviceRGB') ? 3 : 1;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || bytes.length !== w * h * channels) refuse();
    } else {
      if (form) {
        name(d.get(k('Type')), ['XObject']); name(d.get(k('Subtype')), ['Form']);
        optional(d, 'FormType', v => { if (number(v) !== 1) refuse(); });
        numericArray(d.get(k('BBox')), 4); optional(d, 'Matrix', v => numericArray(v, 6));
        d.set(k('Resources'), resources(d.get(k('Resources')), validateContent(bytes, refuse)));
      }
      return validateContent(bytes, refuse);
    }
    return newUses();
  };
  const font = (v: Value): void => {
    const d = dict(v); fields(d, ['Type', 'Subtype', 'BaseFont', 'Encoding']);
    name(d.get(k('Type')), ['Font']); name(d.get(k('Subtype')), ['Type1']);
    name(d.get(k('BaseFont')), Object.values(StandardFonts));
    optional(d, 'Encoding', v => name(v, ['WinAnsiEncoding', 'MacRomanEncoding', 'StandardEncoding']));
  };
  const resources = (v: Value, uses?: Uses): PDFDict => {
    const d = dict(v); enter(d); fields(d, ['Font', 'XObject', 'ProcSet', 'ExtGState']);
    optional(d, 'ProcSet', v => { const a = resolve(v); if (!(a instanceof PDFArray)) refuse(); for (const n of (a as PDFArray).asArray()) name(n, ['PDF', 'Text', 'ImageB', 'ImageC', 'ImageI']); });
    optional(d, 'Font', v => { for (const [, f] of dict(v).entries()) font(f); });
    optional(d, 'XObject', v => { for (const [, x] of dict(v).entries()) {
      const s = resolve(x); if (!(s instanceof PDFRawStream)) refuse();
      const subtype = (s as PDFRawStream).dict.get(k('Subtype')); name(subtype, ['Form', 'Image']); stream(x, subtype === k('Image'), subtype === k('Form'));
    } });
    optional(d, 'ExtGState', v => { const gs = dict(v); if (!nativeOutput && gs.keys().length) refuse(); for (const [, g] of gs.entries()) {
      const state = dict(g); fields(state, ['BM', 'CA', 'ca']); name(state.get(k('BM')), ['Normal']);
      if (number(state.get(k('CA'))) !== 1 || number(state.get(k('ca'))) !== 1) refuse();
    } });
    // Each owner gets a private resource dictionary before pruning. A page cannot
    // remove entries still used by a different page sharing the original resource.
    const result = pruneUnused && uses ? d.clone(doc.context) : d;
    if (uses) for (const family of ['Font', 'XObject', 'ExtGState'] as const) {
      const familyDict = d.has(k(family)) ? dict(d.get(k(family))) : undefined;
      const entries = familyDict?.keys() ?? [];
      if ([...uses[family]].some(n => !entries.some(entry => entry.decodeText() === n))) refuse();
      if (pruneUnused && familyDict) {
        const retained = familyDict.clone(doc.context);
        for (const entry of entries) if (!uses[family].has(entry.decodeText())) retained.delete(entry);
        result.set(k(family), retained);
      } else if (entries.some(entry => !uses[family].has(entry.decodeText()))) refuse();
    }
    active.delete(d); return result;
  };  const tree = (v: Value, parent?: PDFDict, depth = 0, inheritedResources?: Value): number => {
    if (depth > 64) refuse(); const d = dict(v); if (seenPages.has(d)) refuse(); seenPages.add(d);
    name(d.get(k('Type')), ['Page', 'Pages']);
    const page = d.get(k('Type')) === k('Page');
    fields(d, ['Type', 'Parent', 'Resources', 'MediaBox', 'CropBox', 'Rotate', ...(page ? ['Contents', 'BleedBox', 'TrimBox', 'ArtBox', 'UserUnit'] : ['Kids', 'Count'])]);
    if (parent ? resolve(d.get(k('Parent'))) !== parent : d.has(k('Parent'))) refuse();
    for (const field of ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) optional(d, field, v => numericArray(v, 4));
    optional(d, 'Rotate', v => { if (number(v) % 90 !== 0) refuse(); });
    optional(d, 'UserUnit', v => { if (number(v) <= 0) refuse(); });
    optional(d, 'Resources', resources);
    const effectiveResources = d.get(k('Resources')) ?? inheritedResources;
    if (page) {
      const uses = newUses();
      optional(d, 'Contents', v => { const content = resolve(v); if (content instanceof PDFArray) { for (const c of content.asArray()) mergeUses(uses, stream(c)); } else mergeUses(uses, stream(v)); });
      if (effectiveResources) d.set(k('Resources'), resources(effectiveResources, uses));
      else if (Object.values(uses).some(set => set.size)) refuse();
      return 1;
    }
    const kids = resolve(d.get(k('Kids'))); if (!(kids instanceof PDFArray)) refuse();
    let count = 0; for (const child of (kids as PDFArray).asArray()) count += tree(child, d, depth + 1, effectiveResources);
    if (number(d.get(k('Count'))) !== count) refuse();
    if (pruneUnused) d.delete(k('Resources'));
    return count;
  };
  fields(doc.catalog, ['Type', 'Pages']); name(doc.catalog.get(k('Type')), ['Catalog']);
  if (tree(doc.catalog.get(k('Pages'))) !== doc.getPageCount()) refuse();
}

/** Reject comments, inline images, extension operators, dictionary operands and
 * unused trailing operands. Strings can only occur as text-show operands. */
function validateContent(bytes: Uint8Array, refuse: () => never): Uses {
  const text = new TextDecoder('latin1').decode(bytes);
  type Token = 'number' | 'name' | 'string' | Token[];
  let i = 0; let operandNames: string[] = []; const uses = newUses();
  const token = (): Token | string | undefined => {
    while (/[\x00\t\n\f\r ]/.test(text[i] ?? '') && i < text.length) i++;
    if (i === text.length) return;
    const rest = text.slice(i);
    if (text[i] === '(') {
      i++; let depth = 1;
      while (i < text.length && depth) { const c = text[i++]; if (c === '\\') { if (i >= text.length) refuse(); i++; } else if (c === '(') depth++; else if (c === ')') depth--; }
      if (depth) refuse(); return 'string';
    }
    const hex = /^<[\da-fA-F\s]*>/.exec(rest); if (hex) { i += hex[0].length; return 'string'; }
    if (text[i] === '[') {
      i++; const a: Token[] = [];
      while (true) { while (/\s/.test(text[i] ?? '') && i < text.length) i++; if (text[i] === ']') { i++; return a; } const t = token(); if (t !== 'number' && t !== 'string') refuse(); a.push(t as Token); }
    }
    const n = /^[+-]?(?:\d+\.?\d*|\.\d+)(?=[\s\[\]<>/()]|$)/.exec(rest); if (n) { i += n[0].length; if (!Number.isFinite(Number(n[0]))) refuse(); return 'number'; }
    const name = /^\/[^\s\x00()[\]<>\/%]+/.exec(rest); if (name) { i += name[0].length; operandNames.push(PDFName.of(name[0].slice(1)).decodeText()); return 'name'; }
    const op = /^[a-zA-Z*'"]+(?=\s|$)/.exec(rest); if (op) { i += op[0].length; if (['number', 'name', 'string'].includes(op[0])) refuse(); return op[0]; }
    return refuse();
  };
  const numeric: Record<string, number> = { w: 1, J: 1, j: 1, M: 1, i: 1, cm: 6, m: 2, l: 2, c: 6, v: 4, y: 4, re: 4, G: 1, g: 1, RG: 3, rg: 3, K: 4, k: 4, Tc: 1, Tw: 1, Tz: 1, TL: 1, Tr: 1, Ts: 1, Td: 2, TD: 2, Tm: 6 };
  const zero = new Set(['q', 'Q', 'h', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n', 'W', 'W*', 'BT', 'ET', 'T*']);
  let stack: Token[] = [];
  while (i < text.length) {
    const t = token(); if (t === undefined) break;
    if (t === 'number' || t === 'name' || t === 'string' || Array.isArray(t)) { stack.push(t); if (stack.length > 10000) refuse(); continue; }
    const match = (...types: Token[]): boolean => stack.length === types.length && stack.every((v, index) => v === types[index]);
    if (t in numeric) { if (stack.length !== numeric[t] || stack.some(v => v !== 'number')) refuse(); }
    else if (zero.has(t)) { if (stack.length) refuse(); }
    else if (['Do', 'gs'].includes(t)) { if (!match('name')) refuse(); }
    else if (t === 'Tf') { if (!match('name', 'number')) refuse(); }
    else if (t === 'Tj' || t === "'") { if (!match('string')) refuse(); }
    else if (t === '"') { if (!match('number', 'number', 'string')) refuse(); }
    else if (t === 'TJ') { if (stack.length !== 1 || !Array.isArray(stack[0])) refuse(); }
    else if (t === 'd') { if (stack.length !== 2 || !Array.isArray(stack[0]) || stack[0].some(v => v !== 'number') || stack[1] !== 'number') refuse(); }
    else refuse();
    if (t === 'Tf') uses.Font.add(operandNames[0]);
    if (t === 'Do') uses.XObject.add(operandNames[0]);
    if (t === 'gs') uses.ExtGState.add(operandNames[0]);
    operandNames = []; stack = [];
  }
  if (stack.length) refuse(); return uses;
}





