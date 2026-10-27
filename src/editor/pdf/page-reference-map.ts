import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, type PDFObject } from 'pdf-lib';
import { profileDocument } from './structure-profile';
import { destinationEntries, loadNavigationDocument, navigationTarget, outlineNodes, PdfNavigationError, readDocumentNavigation, resolveDestination, type OutlineNode } from './navigation';

export interface PageReferenceMapping { oldIndex: number; newIndices: readonly number[] }
const key = PDFName.of;
function fail(code: 'invalid-change' | 'unsupported-structure' | 'limit-exceeded'): never { throw new PdfNavigationError(code); }

/**
 * Reorders pages and rewrites the verified navigation subset in the same PDF context.
 * Multiple copies of a target resolve to its first new position; removed targets lose
 * their link/action, while bookmark labels/children remain. Not a sanitization API.
 */
export async function remapPageReferences(bytes: Uint8Array, mapping: readonly PageReferenceMapping[]): Promise<Uint8Array> {
  const doc = await loadNavigationDocument(bytes), profile = profileDocument(doc);
  if ((['forms', 'attachments', 'tags', 'optionalContent'] as const).some(field => profile[field] !== 'absent') || profile.issues.length || profile.unknownCatalogKeys.length) fail('unsupported-structure');
  const allowedCatalog = new Set(['Type', 'Pages', 'Metadata', 'Version', 'Lang', 'PageLayout', 'PageMode', 'ViewerPreferences', 'Outlines', 'Names', 'Dests']);
  if (doc.catalog.keys().some(name => !allowedCatalog.has(name.decodeText()))) fail('unsupported-structure');
  const namesRaw = doc.catalog.get(key('Names'));
  const names = namesRaw && doc.context.lookup(namesRaw);
  if (names && (!(names instanceof PDFDict) || names.keys().some(name => name.decodeText() !== 'Dests'))) fail('unsupported-structure');
  const originalPages = doc.getPages();
  const order: number[] = [], oldSeen = new Set<number>(), positions = new Set<number>();
  for (const entry of mapping) {
    if (!Number.isInteger(entry.oldIndex) || entry.oldIndex < 0 || entry.oldIndex >= originalPages.length || oldSeen.has(entry.oldIndex) || !Array.isArray(entry.newIndices)) fail('invalid-change');
    oldSeen.add(entry.oldIndex);
    for (const index of entry.newIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= 200 || positions.has(index)) fail('invalid-change');
      positions.add(index); order[index] = entry.oldIndex;
    }
  }
  if (!positions.size || order.length !== positions.size) fail('invalid-change');
  readDocumentNavigation(doc); // Validate complete supported trees, cycles and destinations before mutating.
  const named = destinationEntries(doc);
  const arrays = new Map<PDFObject, PDFArray>();
  for (const value of named.values()) arrays.set(value, resolveDestination(doc, value, named));
  const outlines = outlineNodes(doc), flat: OutlineNode[] = [];
  const collect = (nodes: OutlineNode[]) => nodes.forEach(node => { flat.push(node); collect(node.children); }); collect(outlines);
  const targets = new Map<PDFDict, PDFArray>();
  for (const node of flat) {
    const target = navigationTarget(doc, node.dict);
    if (target.destination) targets.set(node.dict, resolveDestination(doc, target.destination, named));
  }
  const allowedAnnotation = new Set(['Type', 'Subtype', 'Rect', 'Border', 'BS', 'C', 'H', 'F', 'Contents', 'NM', 'M', 'P', 'Dest', 'A', 'QuadPoints']);
  const allowedPage = new Set(['Type', 'Parent', 'Resources', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'Contents', 'Annots', 'UserUnit', 'Metadata', 'Thumb']);
  const links = originalPages.map(page => {
    // Unknown page entries may contain page references that copyPages cannot remap.
    if (page.node.keys().some(name => !allowedPage.has(name.decodeText()))) fail('unsupported-structure');
    const raw = page.node.get(key('Annots')); if (!raw) return [];
    const array = doc.context.lookup(raw); if (!(array instanceof PDFArray)) fail('unsupported-structure');
    return array.asArray().map(ref => {
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict) || dict.get(key('Subtype')) !== key('Link') || dict.keys().some(name => !allowedAnnotation.has(name.decodeText()))) fail('unsupported-structure');
      const target = navigationTarget(doc, dict);
      if (target.destination) targets.set(dict, resolveDestination(doc, target.destination, named));
      return dict;
    });
  });
  // Capture old indices before the page tree changes, including integer destinations.
  const oldRefs = new Map(originalPages.map((page, index) => [page.ref.toString(), index]));
  const oldTarget = (array: PDFArray): number => {
    const raw = array.get(0);
    if (raw instanceof PDFNumber) return raw.asNumber();
    if (raw instanceof PDFRef) return oldRefs.get(raw.toString()) ?? -1;
    return -1;
  };
  const copiedPages = await doc.copyPages(doc, order);
  while (doc.getPageCount()) doc.removePage(doc.getPageCount() - 1);
  copiedPages.forEach(page => doc.addPage(page));
  const firstTarget = new Map<number, PDFRef>();
  order.forEach((oldIndex, index) => { if (!firstTarget.has(oldIndex)) firstTarget.set(oldIndex, copiedPages[index].ref); });
  const remap = (array: PDFArray): PDFArray | undefined => {
    const ref = firstTarget.get(oldTarget(array)); if (!ref) return undefined;
    const result = array.clone(doc.context); result.set(0, ref); return result;
  };
  for (const node of flat) {
    const target = targets.get(node.dict); if (!target) continue;
    node.dict.delete(key('A'));
    const destination = remap(target);
    if (destination) node.dict.set(key('Dest'), destination); else node.dict.delete(key('Dest'));
  }
  const namedPairs: PDFObject[] = [];
  for (const [name, value] of [...named.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const array = arrays.get(value); const destination = array && remap(array);
    if (destination) namedPairs.push(PDFHexString.fromText(name), destination);
  }
  doc.catalog.delete(key('Dests'));
  if (namedPairs.length) doc.catalog.set(key('Names'), doc.context.obj({ Dests: doc.context.obj({ Names: namedPairs }) }));
  else doc.catalog.delete(key('Names'));
  copiedPages.forEach((page, index) => {
    const annotations: PDFRef[] = [];
    for (const original of links[order[index]]) {
      const target = targets.get(original);
      const destination = target ? remap(target) : undefined;
      if (target && !destination) continue;
      const annotation = original.clone(doc.context); annotation.set(key('P'), page.ref);
      if (destination) { annotation.delete(key('A')); annotation.set(key('Dest'), destination); }
      annotations.push(doc.context.register(annotation));
    }
    if (annotations.length) page.node.set(key('Annots'), doc.context.obj(annotations)); else page.node.delete(key('Annots'));
  });
  readDocumentNavigation(doc);
  return doc.save();
}
