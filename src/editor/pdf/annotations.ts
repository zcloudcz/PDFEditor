import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, type PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { loadStandardDocument, standardFail, validateRect } from './forms';
import type { AnnotationChange, AnnotationDraft, AnnotationKind, PdfAnnotation } from './annotation-types';
const key = PDFName.of;
const supported: readonly string[] = ['Highlight', 'Underline', 'StrikeOut', 'Text', 'Ink', 'Stamp'];
function text(dict: PDFDict, name: string): string { const v = dict.lookup(key(name)); return v instanceof PDFString || v instanceof PDFHexString || v instanceof PDFName ? v.decodeText() : ''; }
function numbers(value: unknown): number[] { if (!(value instanceof PDFArray)) standardFail('unsupported-structure'); return value.asArray().map(v => { if (!(v instanceof PDFNumber) || !Number.isFinite(v.asNumber())) standardFail('unsupported-structure'); return v.asNumber(); }); }
function annotationColor(dict:PDFDict):[number,number,number]|undefined {if(!dict.has(key('C')))return undefined;const c=numbers(dict.lookup(key('C')));if(c.some(v=>v<0||v>1))standardFail('unsupported-structure');if(!c.length)return undefined;if(c.length===1)return[c[0],c[0],c[0]];if(c.length===3)return c as [number,number,number];if(c.length===4)return[1-Math.min(1,c[0]+c[3]),1-Math.min(1,c[1]+c[3]),1-Math.min(1,c[2]+c[3])];return standardFail('unsupported-structure');}
function entries(doc: PDFDocument): Array<{ ref: PDFRef; dict: PDFDict; pageIndex: number; array: PDFArray }> {
  const result: ReturnType<typeof entries> = []; const seen = new Set<string>();
  doc.getPages().forEach((page, pageIndex) => {
    const raw = page.node.get(key('Annots')); if (!raw) return;
    const array = doc.context.lookup(raw); if (!(array instanceof PDFArray)) standardFail('unsupported-structure');
    for (const ref of array.asArray()) {
      const dict = doc.context.lookup(ref); if (!(dict instanceof PDFDict)) standardFail('unsupported-structure');
      if (!supported.includes(text(dict, 'Subtype'))) continue;
      if (!(ref instanceof PDFRef) || seen.has(ref.toString())) standardFail('unsupported-structure'); seen.add(ref.toString());
      result.push({ ref, dict, pageIndex, array }); if (result.length > 10000) standardFail('limit-exceeded');
    }
  }); return result;
}
function read(doc: PDFDocument): PdfAnnotation[] {
  return entries(doc).map(({ ref, dict, pageIndex }) => {
    const r = numbers(dict.lookup(key('Rect'))); if (r.length !== 4) standardFail('unsupported-structure');
    const reply = dict.get(key('IRT')); if (reply && !(reply instanceof PDFRef)) standardFail('unsupported-structure');
    const ink = dict.lookup(key('InkList'));
    return { id: ref.toString(), pageIndex, subtype: text(dict, 'Subtype') as AnnotationKind, rect: [r[0], r[1], r[2] - r[0], r[3] - r[1]], contents: text(dict, 'Contents'), author: text(dict, 'T'), color: annotationColor(dict), quadPoints: dict.has(key('QuadPoints')) ? numbers(dict.lookup(key('QuadPoints'))) : undefined, inkPaths: ink instanceof PDFArray ? ink.asArray().map(p => numbers(doc.context.lookup(p))) : undefined, replyTo: reply?.toString(), resolved: text(dict, 'State') === 'Completed' };
  });
}
export async function readAnnotations(bytes: Uint8Array): Promise<PdfAnnotation[]> { return read(await loadStandardDocument(bytes)); }
function validateDraft(doc: PDFDocument, a: AnnotationDraft): void {
  validateRect(doc, a.pageIndex, a.rect);
  if (!supported.includes(a.subtype) || typeof a.contents !== 'string' || a.contents.length > 10000 || (a.author?.length ?? 0) > 200) standardFail('invalid-change');
  if (a.color && (a.color.length !== 3 || a.color.some(c => !Number.isFinite(c) || c < 0 || c > 1))) standardFail('invalid-change');
  const [x, y, w, h] = a.rect;
  const validPath = (path: number[]) => { if (path.length < 4 || path.length > 20000 || path.length % 2 || path.some((v, i) => !Number.isFinite(v) || v < (i % 2 ? y : x) || v > (i % 2 ? y + h : x + w))) standardFail('invalid-change'); };
  if (['Highlight', 'Underline', 'StrikeOut'].includes(a.subtype)) { if (!a.quadPoints?.length || a.quadPoints.length % 8) standardFail('invalid-change'); validPath(a.quadPoints); }
  if (a.subtype === 'Ink') { if (!a.inkPaths?.length || a.inkPaths.length > 100) standardFail('invalid-change'); a.inkPaths.forEach(validPath); }
  if (a.subtype === 'Stamp' && (!a.contents || a.contents.length > 60 || /[\p{Cc}\p{Cs}]/u.test(a.contents))) standardFail('invalid-change');
}
async function add(doc: PDFDocument, a: AnnotationDraft, signal?: AbortSignal): Promise<string> {
  if (a.subtype === 'Stamp') a = { ...a, contents: a.contents.normalize('NFC') };
  validateDraft(doc, a); const page = doc.getPage(a.pageIndex), [x, y, w, h] = a.rect, color = a.color ?? [1, 0.8, 0];
  const dict = doc.context.obj({ Type: 'Annot', Subtype: a.subtype, Rect: [x, y, x + w, y + h], P: page.ref, F: 4, Contents: PDFHexString.fromText(a.contents), T: PDFHexString.fromText(a.author ?? ''), C: color, NM: PDFString.of(crypto.randomUUID()) });
  if (a.replyTo) { const parent = entries(doc).find(e => e.ref.toString() === a.replyTo); if (!parent || parent.pageIndex !== a.pageIndex) standardFail('invalid-change'); dict.set(key('IRT'), parent.ref); dict.set(key('RT'), key('R')); }
  if (a.resolved) { dict.set(key('StateModel'), PDFString.of('Review')); dict.set(key('State'), PDFString.of('Completed')); }
  if (a.quadPoints) dict.set(key('QuadPoints'), doc.context.obj(a.quadPoints));
  if (a.inkPaths) dict.set(key('InkList'), doc.context.obj(a.inkPaths));
  let commands = `q ${color.join(' ')} RG ${color.join(' ')} rg 1 w\n`; let resources = doc.context.obj({});
  if (a.subtype === 'Text') commands += `0 0 ${w} ${h} re f 0 0 0 RG 2 2 m ${w - 2} ${h - 2} l S\n`;
  else if (a.subtype === 'Stamp') {
    let font;
    if (/^[\x20-\x7e]+$/.test(a.contents)) font = await doc.embedFont(StandardFonts.Helvetica);
    else {
      signal?.throwIfAborted();
      const response = await fetch('/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf', { signal });
      if (!response.ok) standardFail('font-unavailable');
      const data = new Uint8Array(await response.arrayBuffer());
      if (!data.length || data.length > 18 * 1024 * 1024) standardFail('font-unavailable');
      signal?.throwIfAborted();
      try { doc.registerFontkit(fontkit); font = await doc.embedFont(data, { subset: true }); }
      catch { standardFail('font-unavailable'); }
      const glyphs = new Set(font.getCharacterSet());
      if ([...a.contents].some(character => !glyphs.has(character.codePointAt(0)!))) standardFail('invalid-change');
    }
    resources = doc.context.obj({ Font: { F1: font.ref } });
    const size = Math.min(16, h * 0.6, (w - 8) / Math.max(1, font.widthOfTextAtSize(a.contents, 1))); if (size <= 0) standardFail('invalid-change');
    commands += `0 0 ${w} ${h} re S BT /F1 ${size} Tf 4 ${Math.max(2, (h - size) / 2)} Td ${font.encodeText(a.contents).toString()} Tj ET\n`;
  } else if (a.subtype === 'Ink') {
    for (const path of a.inkPaths!) { commands += `${path[0] - x} ${path[1] - y} m `; for (let i = 2; i < path.length; i += 2) commands += `${path[i] - x} ${path[i + 1] - y} l `; commands += 'S\n'; }
  } else {
    if (a.subtype === 'Highlight') { resources = doc.context.obj({ ExtGState: { GS1: { Type: 'ExtGState', ca: 0.35, BM: 'Multiply' } } }); commands += '/GS1 gs\n'; }
    for (let i = 0; i < a.quadPoints!.length; i += 8) {
      const p = a.quadPoints!.slice(i, i + 8).map((v, n) => v - (n % 2 ? y : x));
      if (a.subtype === 'Highlight') commands += `${p[0]} ${p[1]} m ${p[2]} ${p[3]} l ${p[6]} ${p[7]} l ${p[4]} ${p[5]} l h f\n`;
      else { const t = a.subtype === 'Underline' ? 1 : 0.5; commands += `${p[0] + (p[4] - p[0]) * t} ${p[1] + (p[5] - p[1]) * t} m ${p[2] + (p[6] - p[2]) * t} ${p[3] + (p[7] - p[3]) * t} l S\n`; }
    }
  }
  const appearance = doc.context.register(doc.context.flateStream(commands + 'Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: resources }));
  dict.set(key('AP'), doc.context.obj({ N: appearance })); if (a.subtype === 'Stamp') dict.set(key('Name'), key('Draft'));
  const ref = doc.context.register(dict); page.node.addAnnot(ref); return ref.toString();
}
export async function applyAnnotationChanges(bytes: Uint8Array, changes: readonly AnnotationChange[], signal?: AbortSignal): Promise<Uint8Array> {
  changes = structuredClone(changes);
  const doc = await loadStandardDocument(bytes); read(doc); if (changes.length > 1000) standardFail('limit-exceeded');
  const imported = new Map<string, string>();
  for (const change of changes) {
    signal?.throwIfAborted(); if (change.kind === 'add') {
      const a = change.annotation;
      if (a.importId && (a.importId.length > 200 || imported.has(a.importId))) standardFail('invalid-change');
      const id = await add(doc, { ...a, replyTo: a.replyTo ? imported.get(a.replyTo) ?? a.replyTo : undefined }, signal);
      if (a.importId) imported.set(a.importId, id); continue;
    }
    const target = entries(doc).find(e => e.ref.toString() === change.id); if (!target) standardFail('invalid-change');
    if (change.kind === 'comment') { if (typeof change.contents !== 'string' || change.contents.length > 10000) standardFail('invalid-change'); if (text(target.dict, 'Subtype') === 'Stamp') standardFail('unsupported-structure'); target.dict.set(key('Contents'), PDFHexString.fromText(change.contents)); }
    else if (change.kind === 'resolve') { target.dict.set(key('StateModel'), PDFString.of('Review')); target.dict.set(key('State'), PDFString.of(change.resolved ? 'Completed' : 'None')); }
    else if (change.kind === 'remove') {
      removeThread(doc,change.id);
    } else standardFail('invalid-change');
  }
  signal?.throwIfAborted(); return doc.save({ updateFieldAppearances: false });
}
function removeThread(doc:PDFDocument,id:string):void {
  const all:Array<{raw:unknown;dict:PDFDict;array:PDFArray}>=[];
  for(const page of doc.getPages()){
    const array=page.node.Annots();if(!array)continue;
    for(const raw of array.asArray()){const dict=doc.context.lookup(raw);if(!(dict instanceof PDFDict))standardFail('unsupported-structure');all.push({raw,dict,array});}
  }
  const removed=new Set([id]);let grew=true;
  while(grew){grew=false;
    for(const item of all){
      const subtype=text(item.dict,'Subtype'),ref=item.raw instanceof PDFRef?item.raw.toString():undefined;
      const reply=removed.has(item.dict.get(key('IRT'))?.toString()??''),popup=subtype==='Popup'&&removed.has(item.dict.get(key('Parent'))?.toString()??'');
      if(reply&&!supported.includes(subtype))standardFail('unsupported-structure');
      if(reply||popup){if(!ref)standardFail('unsupported-structure');if(!removed.has(ref)){removed.add(ref);grew=true;}}
      if(ref&&removed.has(ref)&&item.dict.has(key('Popup'))){
        const popupRef=item.dict.get(key('Popup'));const target=all.find(e=>e.raw instanceof PDFRef&&e.raw.toString()===popupRef?.toString());
        if(!(popupRef instanceof PDFRef)||!target||text(target.dict,'Subtype')!=='Popup'||target.dict.get(key('Parent'))?.toString()!==ref)standardFail('unsupported-structure');
        if(!removed.has(popupRef.toString())){removed.add(popupRef.toString());grew=true;}
      }
    }
  }
  // Complete the graph validation before detaching any annotation or popup.
  for(const item of all)if(item.raw instanceof PDFRef&&removed.has(item.raw.toString())){
    const index=item.array.asArray().findIndex(ref=>ref.toString()===item.raw!.toString());if(index>=0)item.array.remove(index);
  }
}
function escapeXml(value: string): string { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!); }
export function exportAnnotationsXfdf(annotations: readonly PdfAnnotation[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><annots>${annotations.map(a => {
    const [x, y, w, h] = a.rect; const subtype = a.subtype.toLowerCase();
    const coordinates = a.quadPoints ? ` coords="${a.quadPoints.join(',')}"` : '';
    const color = a.color ? ` color="#${a.color.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}"` : '';
    return `<${subtype} page="${a.pageIndex}" rect="${[x,y,x+w,y+h].join(',')}" name="${escapeXml(a.id)}" title="${escapeXml(a.author ?? '')}"${coordinates}${color}${a.replyTo ? ` inreplyto="${escapeXml(a.replyTo)}"` : ''}${a.resolved ? ' state="Completed" statemodel="Review"' : ''}><contents>${escapeXml(a.contents)}</contents>${a.inkPaths ? `<inklist>${a.inkPaths.map(p => `<gesture>${p.join(',')}</gesture>`).join('')}</inklist>` : ''}</${subtype}>`;
  }).join('')}</annots></xfdf>`;
}
export function importAnnotationsXfdf(xml: string): AnnotationChange[] {
  if (xml.length > 2 * 1024 * 1024) standardFail('limit-exceeded'); if (/<!DOCTYPE|<!ENTITY/i.test(xml)) standardFail('invalid-change');
  const dom = new DOMParser().parseFromString(xml, 'application/xml'); if (dom.querySelector('parsererror') || dom.documentElement.localName !== 'xfdf') standardFail('invalid-change');
  const annots = Array.from(dom.getElementsByTagNameNS('*', 'annots')); if (annots.length !== 1) standardFail('invalid-change');
  const children = Array.from(annots[0].children); if (children.length > 1000) standardFail('limit-exceeded');
  const pending = children.map(node => {
    const subtype = supported.find(s => s.toLowerCase() === node.localName); if (!subtype || (node.hasAttribute('state') && node.getAttribute('state') !== 'Completed')) standardFail('unsupported-structure');
    const parse = (s: string | null) => (s ?? '').split(',').map(Number); const r = parse(node.getAttribute('rect')); if (r.length !== 4 || !node.hasAttribute('page')) standardFail('invalid-change');
    const color = node.getAttribute('color'); if (color && !/^#[a-f\d]{6}$/i.test(color)) standardFail('invalid-change');
    return { kind: 'add' as const, annotation: { pageIndex: Number(node.getAttribute('page')), subtype: subtype as AnnotationKind, rect: [r[0], r[1], r[2]-r[0], r[3]-r[1]] as [number,number,number,number], contents: node.getElementsByTagNameNS('*', 'contents')[0]?.textContent ?? '', author: node.getAttribute('title') ?? '', color: color ? [parseInt(color.slice(1,3),16)/255,parseInt(color.slice(3,5),16)/255,parseInt(color.slice(5,7),16)/255] as [number,number,number] : undefined, quadPoints: node.hasAttribute('coords') ? parse(node.getAttribute('coords')) : undefined, inkPaths: subtype === 'Ink' ? Array.from(node.getElementsByTagNameNS('*', 'gesture')).map(g => parse(g.textContent)) : undefined, importId: node.getAttribute('name') ?? undefined, replyTo: node.getAttribute('inreplyto') ?? undefined, resolved: node.getAttribute('state') === 'Completed' } };
  });
  const byId = new Map<string, typeof pending[number]>();
  for (const item of pending) if (item.annotation.importId) { if (byId.has(item.annotation.importId)) standardFail('invalid-change'); byId.set(item.annotation.importId, item); }
  const ordered: AnnotationChange[] = [], visited = new Set<object>(), active = new Set<object>();
  const visit = (item: typeof pending[number], depth: number) => {
    if (visited.has(item)) return; if (active.has(item) || depth > 64) standardFail('invalid-change'); active.add(item);
    if (item.annotation.replyTo) { const parent = byId.get(item.annotation.replyTo); if (!parent) standardFail('invalid-change'); visit(parent, depth + 1); }
    active.delete(item); visited.add(item); ordered.push(item);
  };
  for (const item of pending) visit(item, 0); return ordered;
}
