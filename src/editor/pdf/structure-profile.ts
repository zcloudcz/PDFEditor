import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from 'pdf-lib';

export type StructurePresence = 'present' | 'absent' | 'unknown';
export interface PdfStructureProfile {
  pageCount: number | null;
  forms: StructurePresence; annotations: StructurePresence; outlines: StructurePresence;
  destinations: StructurePresence; attachments: StructurePresence; tags: StructurePresence;
  encryption: StructurePresence; signatures: StructurePresence; optionalContent: StructurePresence;
  unknownCatalogKeys: string[];
  issues: string[];
}
const catalogKeys = new Set(['Type', 'Pages', 'Metadata', 'Version', 'Lang', 'PageLayout', 'PageMode', 'ViewerPreferences',
  'AcroForm', 'Outlines', 'Names', 'Dests', 'StructTreeRoot', 'MarkInfo', 'OCProperties', 'Perms', 'AF',
  'OpenAction', 'AA', 'PageLabels', 'OutputIntents', 'NeedsRendering', 'Collection', 'PieceInfo']);

export function profileDocument(doc: PDFDocument): PdfStructureProfile {
  const result: PdfStructureProfile = {
    pageCount: null, forms: 'unknown', annotations: 'unknown', outlines: 'unknown', destinations: 'unknown',
    attachments: 'unknown', tags: 'unknown', encryption: doc.isEncrypted ? 'present' : 'absent',
    signatures: 'unknown', optionalContent: 'unknown', unknownCatalogKeys: [], issues: [],
  };
  if (doc.isEncrypted) { result.issues.push('encrypted-content-not-inspected'); return result; }
  const dictPresence = (key: string): StructurePresence => {
    const value = doc.catalog.get(PDFName.of(key));
    if (value === undefined) return 'absent';
    try { return doc.context.lookup(value) instanceof PDFDict ? 'present' : 'unknown'; }
    catch { return 'unknown'; }
  };
  result.forms = dictPresence('AcroForm'); result.outlines = dictPresence('Outlines');
  result.tags = dictPresence('StructTreeRoot'); result.optionalContent = dictPresence('OCProperties');
  result.unknownCatalogKeys = doc.catalog.keys().map(key => key.decodeText()).filter(key => !catalogKeys.has(key));
  let names: PDFDict | undefined;
  try {
    const object = doc.catalog.get(PDFName.of('Names'));
    const resolved = object && doc.context.lookup(object);
    if (resolved instanceof PDFDict) names = resolved;
    else if (object) result.issues.push('malformed-names');
  } catch { result.issues.push('malformed-names'); }
  const typedPresence = (value: PDFObject | undefined, kind: 'dictionary' | 'array'): StructurePresence => {
    if (value === undefined) return 'absent';
    try { const resolved = doc.context.lookup(value); return (kind === 'dictionary' ? resolved instanceof PDFDict : resolved instanceof PDFArray) ? 'present' : 'unknown'; }
    catch { return 'unknown'; }
  };
  const combine = (...values: StructurePresence[]): StructurePresence => values.includes('unknown') ? 'unknown' : values.includes('present') ? 'present' : 'absent';
  const namesState = result.issues.includes('malformed-names') ? 'unknown' : 'absent';
  result.destinations = combine(typedPresence(names?.get(PDFName.of('Dests')), 'dictionary'), typedPresence(doc.catalog.get(PDFName.of('Dests')), 'dictionary'), namesState);
  result.attachments = combine(typedPresence(names?.get(PDFName.of('EmbeddedFiles')), 'dictionary'), typedPresence(doc.catalog.get(PDFName.of('AF')), 'array'), namesState);
  try {
    const pages = doc.getPages(); result.pageCount = pages.length; result.annotations = 'absent';
    for (const page of pages) {
      result.attachments = combine(result.attachments, typedPresence(page.node.get(PDFName.of('AF')), 'array'));
      if (page.node.has(PDFName.of('StructParents')) && result.tags === 'absent') result.tags = 'unknown';
      const raw = page.node.get(PDFName.of('Annots'));
      if (raw === undefined) continue;
      const array = doc.context.lookup(raw);
      if (!(array instanceof PDFArray)) { result.annotations = 'unknown'; result.issues.push('malformed-annotations'); break; }
      if (array.size() && result.annotations !== 'unknown') result.annotations = 'present';
      for (const item of array.asArray()) {
        const annotation = doc.context.lookup(item);
        if (!(annotation instanceof PDFDict)) { result.annotations = 'unknown'; result.issues.push('malformed-annotation'); break; }
        if (annotation.get(PDFName.of('Subtype')) === PDFName.of('FileAttachment')) result.attachments = 'present';
        if (annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget') && result.forms === 'absent') result.forms = 'unknown';
      }
    }
  } catch { result.issues.push('malformed-pages'); result.annotations = 'unknown'; }
  if (result.annotations === 'unknown') {
    if (result.forms === 'absent') result.forms = 'unknown';
    if (result.attachments === 'absent') result.attachments = 'unknown';
  }
  const stack: PDFObject[] = doc.context.enumerateIndirectObjects().map(([, object]) => object);
  const seen = new Set<PDFObject>();
  result.signatures = doc.catalog.has(PDFName.of('Perms')) ? 'present' : 'absent';
  while (stack.length) {
    const object = stack.pop(); if (!object || seen.has(object)) continue;
    if (seen.size >= 50000) { if (result.signatures !== 'present') result.signatures = 'unknown'; result.issues.push('inspection-limit'); break; }
    seen.add(object);
    const dict = object instanceof PDFStream ? object.dict : object;
    if (dict instanceof PDFDict) {
      if (dict.has(PDFName.of('ByteRange')) || dict.get(PDFName.of('Type')) === PDFName.of('Sig') || dict.get(PDFName.of('FT')) === PDFName.of('Sig')) result.signatures = 'present';
      stack.push(...dict.values());
    } else if (object instanceof PDFArray) stack.push(...object.asArray());
  }
  return result;
}

/** Unknown/malformed is explicit; failed inspection never masquerades as absence. */
export async function inspectPdfStructures(bytes: Uint8Array): Promise<PdfStructureProfile> {
  try {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('input-limit');
    return profileDocument(await PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: true }));
  } catch {
    return { pageCount: null, forms: 'unknown', annotations: 'unknown', outlines: 'unknown', destinations: 'unknown', attachments: 'unknown', tags: 'unknown', encryption: 'unknown', signatures: 'unknown', optionalContent: 'unknown', unknownCatalogKeys: [], issues: ['inspection-failed'] };
  }
}
