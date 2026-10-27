import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectCopier, PDFPage, PDFPageLeaf, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib';
import { loadStandardDocument } from './forms';
import { copyPdfMetadata } from './metadata';
import { PageOperationError } from './page-operations';

const key = PDFName.of;
function unsupported(): never { throw new PageOperationError('unsupported-structure'); }
const catalogKeys = new Set(['Type', 'Pages', 'Metadata', 'Version', 'Lang', 'PageLayout', 'PageMode', 'ViewerPreferences', 'AcroForm']);
const pageKeys = new Set(['Type', 'Parent', 'Resources', 'Contents', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'UserUnit', 'Annots', 'Tabs', 'Group', 'Metadata', 'LastModified']);
const fieldKeys = new Set(['Type', 'Subtype', 'FT', 'Parent', 'Kids', 'T', 'TU', 'TM', 'Ff', 'V', 'DV', 'DA', 'Q', 'MaxLen', 'Opt', 'TI', 'I', 'DS', 'RV', 'Rect', 'AP', 'AS', 'P', 'F', 'H', 'MK', 'BS', 'Border', 'C', 'NM', 'M', 'Contents']);
interface ValidatedForm { doc: PDFDocument; roots: PDFRef[]; acro?: PDFDict; fields: PDFDict[] }

/** This copying path accepts plain PDFs and ordinary AcroForms only. It never unlocks the generic structural guards. */
async function validate(bytes: Uint8Array): Promise<ValidatedForm> {
  const doc = await loadStandardDocument(bytes);
  if (doc.catalog.keys().some(name => !catalogKeys.has(name.decodeText()))) unsupported();
  // ObjectCopier silently produces dangling destination references for missing source objects.
  const visited = new Set<PDFObject>();
  const inspect = (object: PDFObject, depth: number): void => {
    if (visited.has(object)) return;
    if (depth > 64 || visited.size > 100000) throw new PageOperationError('limit-exceeded');
    visited.add(object);
    if (object instanceof PDFRef) { const value = doc.context.lookup(object); if (!value) unsupported(); inspect(value, depth + 1); }
    else if (object instanceof PDFStream) inspect(object.dict, depth + 1);
    else if (object instanceof PDFDict) for (const value of object.values()) inspect(value, depth + 1);
    else if (object instanceof PDFArray) for (const value of object.asArray()) inspect(value, depth + 1);
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) inspect(object, 0);
  const widgets = new Map<string, number>();
  doc.getPages().forEach((page, index) => {
    if (page.node.keys().some(name => !pageKeys.has(name.decodeText()))) unsupported();
    const raw = page.node.get(key('Annots')); if (!raw) return;
    const annots = doc.context.lookup(raw); if (!(annots instanceof PDFArray)) unsupported();
    for (const ref of annots.asArray()) {
      const dict = doc.context.lookup(ref);
      if (!(ref instanceof PDFRef) || !(dict instanceof PDFDict) || dict.get(key('Subtype')) !== key('Widget') || widgets.has(ref.toString())) unsupported();
      if (dict.has(key('P')) && dict.get(key('P'))?.toString() !== page.ref.toString()) unsupported();
      widgets.set(ref.toString(), index);
    }
  });
  const raw = doc.catalog.get(key('AcroForm'));
  if (!raw) { if (widgets.size) unsupported(); return { doc, roots: [], fields: [] }; }
  const acro = doc.context.lookup(raw); if (!(acro instanceof PDFDict)) unsupported();
  if (acro.keys().some(name => !['Fields', 'DR', 'DA', 'Q', 'NeedAppearances'].includes(name.decodeText())) || acro.get(key('NeedAppearances')) === PDFBool.True) unsupported();
  const roots = doc.context.lookup(acro.get(key('Fields'))); if (!(roots instanceof PDFArray)) unsupported();
  const fields: PDFDict[] = [], seen = new Set<string>(), names = new Set<string>();
  const walk = (ref: PDFObject, parent: PDFRef | undefined, inheritedType: PDFName | undefined, path: string, depth: number): void => {
    if (!(ref instanceof PDFRef) || seen.has(ref.toString()) || depth > 32) unsupported();
    seen.add(ref.toString()); if (seen.size > 10000) throw new PageOperationError('limit-exceeded');
    const dict = doc.context.lookup(ref); if (!(dict instanceof PDFDict) || dict.keys().some(name => !fieldKeys.has(name.decodeText()))) unsupported();
    if (dict.get(key('Parent'))?.toString() !== parent?.toString()) unsupported();
    fields.push(dict);
    const rawType = dict.get(key('FT')), type = rawType ?? inheritedType;
    if (type !== undefined && (!(type instanceof PDFName) || !['Tx', 'Btn', 'Ch'].includes(type.decodeText()))) unsupported();
    const flags = dict.lookupMaybe(key('Ff'), PDFNumber)?.asNumber() ?? 0;
    if (!Number.isSafeInteger(flags) || flags < 0 || (type === key('Btn') && (flags & 65536))) unsupported();
    const name = dict.get(key('T'));
    if (name !== undefined && !(name instanceof PDFString || name instanceof PDFHexString)) unsupported();
    const partial = name instanceof PDFString || name instanceof PDFHexString ? name.decodeText() : '';
    if (name && (!partial || partial.includes('.') || partial.length > 1000)) unsupported();
    const full = partial ? (path ? `${path}.${partial}` : partial) : path;
    if (partial) { if (names.has(full)) unsupported(); names.add(full); }
    if (dict.get(key('Subtype')) === key('Widget')) {
      if (!widgets.delete(ref.toString()) || !type || dict.has(key('Kids'))) unsupported();
    }
    const kidsRaw = dict.get(key('Kids'));
    if (kidsRaw) {
      const kids = doc.context.lookup(kidsRaw); if (!(kids instanceof PDFArray) || !kids.size()) unsupported();
      for (const child of kids.asArray()) walk(child, ref, type instanceof PDFName ? type : undefined, full, depth + 1);
    } else if (partial) {
      if (!type) unsupported();
    } else if (dict.get(key('Subtype')) !== key('Widget')) unsupported();
  };
  for (const ref of roots.asArray()) walk(ref, undefined, undefined, '', 0);
  if (widgets.size) unsupported();
  return { doc, acro, roots: roots.asArray().map(ref => { if (!(ref instanceof PDFRef)) return unsupported(); return ref; }), fields };
}

export async function assertFormMergeSupported(bytes: Uint8Array): Promise<void> { await validate(bytes.slice()); }

/** One copier per input preserves shared widgets/AP streams and their links to copied pages. */
export async function mergePdfForms(inputs: readonly Uint8Array[]): Promise<Uint8Array> {
  if (!inputs.length || inputs.some(bytes => !(bytes instanceof Uint8Array))) throw new PageOperationError('invalid-input');
  if (inputs.reduce((sum, bytes) => sum + bytes.byteLength, 0) > 100 * 1024 * 1024) throw new PageOperationError('limit-exceeded');
  const snapshots = inputs.map(bytes => bytes.slice()), sources: ValidatedForm[] = [];
  for (const bytes of snapshots) sources.push(await validate(bytes));
  if (sources.reduce((sum, source) => sum + source.doc.getPageCount(), 0) > 200) throw new PageOperationError('limit-exceeded');
  const output = await PDFDocument.create(), roots = output.context.obj([]), resources = output.context.obj({});
  for (const [index, source] of sources.entries()) {
    const copier = PDFObjectCopier.for(source.doc.context, output.context), prefix = `document_${index + 1}`;
    for (const page of source.doc.getPages()) {
      const ref = copier.copy(page.ref), copied = output.context.lookup(ref);
      if (!(copied instanceof PDFPageLeaf)) unsupported();
      output.addPage(PDFPage.of(copied, ref, output));
    }
    if (!source.acro || !source.roots.length) continue;
    const rename = new Map<string, string>(), drRaw = source.acro.get(key('DR'));
    if (drRaw) {
      const dr = source.doc.context.lookup(drRaw); if (!(dr instanceof PDFDict)) unsupported();
      for (const [category, raw] of dr.entries()) {
        const entries = source.doc.context.lookup(raw); if (!(entries instanceof PDFDict)) unsupported();
        let target = resources.lookupMaybe(category, PDFDict); if (!target) { target = output.context.obj({}); resources.set(category, target); }
        for (const [name, value] of entries.entries()) {
          const renamed = key(`${prefix}_${name.toString().slice(1)}`); rename.set(name.decodeText(), renamed.toString()); target.set(renamed, copier.copy(value));
        }
      }
    }
    const copyAppearance = (value: PDFObject): PDFObject => {
      if (!(value instanceof PDFString || value instanceof PDFHexString)) return unsupported();
      const contents = value.decodeText();
      // DA is a content fragment: names are tokens; never replace substrings within names.
      if (/[()[\]<>]/.test(contents) || contents.includes('%')) unsupported();
      return PDFString.of(contents.replace(/\/[^\s/()[\]<>{}%]+/g, token => {
        if (/#(?![\da-f]{2})/i.test(token)) return unsupported();
        const decoded = token.slice(1).replace(/#([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
        return rename.get(decoded) ?? token;
      }));
    };
    for (const field of source.fields) {
      const da = field.get(key('DA')); if (da) copier.copy(field).set(key('DA'), copyAppearance(da));
    }
    const wrapper = output.context.obj({ T: PDFHexString.fromText(prefix), Kids: source.roots.map(ref => copier.copy(ref)) }), wrapperRef = output.context.register(wrapper);
    const defaultAppearance = source.acro.get(key('DA')); if (defaultAppearance) wrapper.set(key('DA'), copyAppearance(defaultAppearance));
    const alignment = source.acro.get(key('Q')); if (alignment) wrapper.set(key('Q'), copier.copy(alignment));
    for (const ref of source.roots) output.context.lookup(copier.copy(ref), PDFDict).set(key('Parent'), wrapperRef);
    roots.push(wrapperRef);
  }
  if (roots.size()) output.catalog.set(key('AcroForm'), output.context.obj({ Fields: roots, DR: resources, NeedAppearances: false }));
  copyPdfMetadata(sources[0].doc, output);
  return output.save({ updateFieldAppearances: false });
}
