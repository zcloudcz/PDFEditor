import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { profileDocument } from './structure-profile';

export class PdfNavigationError extends Error {
  constructor(public readonly code: 'invalid-input' | 'unsupported-structure' | 'invalid-navigation' | 'limit-exceeded' | 'invalid-change') { super(code); this.name = 'PdfNavigationError'; }
}
export interface NavigationDestination { pageIndex: number; view: string }
export interface PdfBookmark { id: string; title: string; destination: NavigationDestination | null; uri?: string; children: PdfBookmark[] }
export interface PdfLink { id: string; pageIndex: number; rect: [number, number, number, number]; destination: NavigationDestination | null; uri?: string }
export interface PdfNavigation { bookmarks: PdfBookmark[]; links: PdfLink[]; destinations: Array<{ name: string; destination: NavigationDestination | null }> }
export type NavigationChange =
  | { kind: 'rename-bookmark'; id: string; title: string }
  | { kind: 'add-bookmark'; title: string; pageIndex: number; parentId?: string }
  | { kind: 'remove-bookmark'; id: string }
  | { kind: 'set-link-destination'; id: string; pageIndex: number }
  | { kind: 'remove-link'; id: string };
export interface OutlineNode { id: string; ref: PDFRef; dict: PDFDict; children: OutlineNode[] }
function fail(code: ConstructorParameters<typeof PdfNavigationError>[0]): never { throw new PdfNavigationError(code); }
const key = PDFName.of;
export function pdfText(object: PDFObject | undefined): string {
  if (object instanceof PDFString || object instanceof PDFHexString || object instanceof PDFName) return object.decodeText();
  return fail('invalid-navigation');
}
export async function loadNavigationDocument(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail('invalid-input');
  if (bytes.length > 50 * 1024 * 1024) fail('limit-exceeded');
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: true }); }
  catch { return fail('invalid-input'); }
  const profile = profileDocument(doc);
  if (profile.encryption !== 'absent' || profile.signatures !== 'absent') fail('unsupported-structure');
  if (profile.pageCount === null || profile.pageCount < 1) fail('invalid-input');
  if (profile.pageCount > 200) fail('limit-exceeded');
  return doc;
}
export function destinationEntries(doc: PDFDocument): Map<string, PDFObject> {
  const entries = new Map<string, PDFObject>();
  const add = (name: string, value: PDFObject) => {
    if (entries.has(name)) fail('invalid-navigation');
    if (entries.size >= 5000 || name.length > 10000) fail('limit-exceeded');
    entries.set(name, value);
  };
  const legacy = doc.catalog.get(key('Dests'));
  if (legacy) {
    const dict = doc.context.lookup(legacy); if (!(dict instanceof PDFDict)) fail('invalid-navigation');
    for (const [name, value] of dict.entries()) add(name.decodeText(), value);
  }
  const namesRaw = doc.catalog.get(key('Names'));
  if (!namesRaw) return entries;
  const names = doc.context.lookup(namesRaw); if (!(names instanceof PDFDict)) fail('invalid-navigation');
  const root = names.get(key('Dests')); if (!root) return entries;
  const seen = new Set<PDFObject>();
  const walk = (object: PDFObject, depth: number) => {
    if (depth > 32 || seen.size > 5000) fail('limit-exceeded');
    const dict = doc.context.lookup(object); if (!(dict instanceof PDFDict) || seen.has(dict)) fail('invalid-navigation');
    seen.add(dict);
    if (dict.keys().some(name => !['Names', 'Kids', 'Limits'].includes(name.decodeText()))) fail('unsupported-structure');
    const rawPairs = dict.get(key('Names')), rawKids = dict.get(key('Kids'));
    if (rawPairs && rawKids) fail('invalid-navigation');
    if (rawPairs) {
      const pairs = doc.context.lookup(rawPairs); if (!(pairs instanceof PDFArray) || pairs.size() % 2) fail('invalid-navigation');
      for (let index = 0; index < pairs.size(); index += 2) add(pdfText(pairs.get(index)), pairs.get(index + 1));
    } else if (rawKids) {
      const kids = doc.context.lookup(rawKids); if (!(kids instanceof PDFArray)) fail('invalid-navigation');
      for (const child of kids.asArray()) walk(child, depth + 1);
    } else fail('invalid-navigation');
  };
  walk(root, 0); return entries;
}
export function resolveDestination(doc: PDFDocument, value: PDFObject, named = destinationEntries(doc), seen = new Set<string>()): PDFArray {
  const object = doc.context.lookup(value);
  if (object instanceof PDFName || object instanceof PDFString || object instanceof PDFHexString) {
    const name = pdfText(object); if (seen.has(name) || seen.size > 32) fail('invalid-navigation');
    seen.add(name); const target = named.get(name); if (!target) fail('invalid-navigation');
    return resolveDestination(doc, target, named, seen);
  }
  if (object instanceof PDFDict) {
    if (object.keys().some(name => name.decodeText() !== 'D')) fail('unsupported-structure');
    const target = object.get(key('D')); if (!target) fail('invalid-navigation');
    // A destination dictionary cannot form an unbounded cycle.
    const token = String(object); if (seen.has(token) || seen.size > 32) fail('invalid-navigation'); seen.add(token);
    return resolveDestination(doc, target, named, seen);
  }
  if (!(object instanceof PDFArray) || object.size() < 2 || object.size() > 6) fail('invalid-navigation');
  const view = object.get(1); if (!(view instanceof PDFName) || !['XYZ', 'Fit', 'FitH', 'FitV', 'FitR', 'FitB', 'FitBH', 'FitBV'].includes(view.decodeText())) fail('invalid-navigation');
  const viewName = view.decodeText();
  const length = viewName === 'XYZ' ? 5 : viewName === 'FitR' ? 6 : ['Fit', 'FitB'].includes(viewName) ? 2 : 3;
  if (object.size() !== length) fail('invalid-navigation');
  for (let coordinate = 2; coordinate < length; coordinate++) {
    const value = doc.context.lookup(object.get(coordinate));
    if (value === PDFNull && viewName !== 'FitR') continue;
    if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber())) fail('invalid-navigation');
  }
  const page = object.get(0);
  if (!(page instanceof PDFRef || page instanceof PDFNumber)) fail('invalid-navigation');
  const index = page instanceof PDFRef ? doc.getPages().findIndex(p => p.ref.toString() === page.toString()) : page.asNumber();
  if (!Number.isInteger(index) || index < 0 || index >= doc.getPageCount()) fail('invalid-navigation');
  return object;
}
export function describeDestination(doc: PDFDocument, value: PDFObject, named: Map<string, PDFObject>): NavigationDestination {
  const array = resolveDestination(doc, value, named), target = array.get(0), view = array.get(1);
  const pageIndex = target instanceof PDFNumber ? target.asNumber() : doc.getPages().findIndex(page => page.ref.toString() === target.toString());
  return { pageIndex, view: view instanceof PDFName ? view.decodeText() : '' };
}
export function outlineNodes(doc: PDFDocument): OutlineNode[] {
  const raw = doc.catalog.get(key('Outlines')); if (!raw) return [];
  const root = doc.context.lookup(raw); if (!(root instanceof PDFDict)) fail('invalid-navigation');
  const seen = new Set<string>();
  const siblings = (parent: PDFDict, depth: number): OutlineNode[] => {
    if (depth > 32) fail('limit-exceeded');
    const nodes: OutlineNode[] = [];
    let next = parent.get(key('First'));
    while (next) {
      if (!(next instanceof PDFRef) || seen.has(next.toString())) fail('invalid-navigation');
      if (seen.size >= 1000) fail('limit-exceeded');
      seen.add(next.toString());
      const dict = doc.context.lookup(next); if (!(dict instanceof PDFDict)) fail('invalid-navigation');
      const parentRaw = dict.get(key('Parent')), previous = dict.get(key('Prev'));
      if (!parentRaw || doc.context.lookup(parentRaw) !== parent) fail('invalid-navigation');
      if (nodes.length ? !(previous instanceof PDFRef) || previous.toString() !== nodes[nodes.length - 1].ref.toString() : previous !== undefined) fail('invalid-navigation');
      pdfText(dict.get(key('Title')));
      const node: OutlineNode = { id: next.toString(), ref: next, dict, children: siblings(dict, depth + 1) };
      nodes.push(node); next = dict.get(key('Next'));
    }
    const last = parent.get(key('Last'));
    if (nodes.length ? !(last instanceof PDFRef) || last.toString() !== nodes[nodes.length - 1].ref.toString() : last !== undefined) fail('invalid-navigation');
    return nodes;
  };
  return siblings(root, 0);
}
export function navigationTarget(doc: PDFDocument, dict: PDFDict): { destination?: PDFObject; uri?: string } {
  const direct = dict.get(key('Dest')); const actionRaw = dict.get(key('A'));
  if (direct && actionRaw) fail('invalid-navigation');
  if (dict.has(key('AA'))) fail('unsupported-structure');
  if (direct) return { destination: direct };
  if (!actionRaw) return {};
  const action = doc.context.lookup(actionRaw); if (!(action instanceof PDFDict) || action.has(key('Next'))) fail('unsupported-structure');
  const type = action.get(key('S'));
  const allowedKeys = type === key('GoTo') ? ['Type', 'S', 'D'] : ['Type', 'S', 'URI', 'IsMap'];
  if (action.keys().some(name => !allowedKeys.includes(name.decodeText()))) fail('unsupported-structure');
  if (type === key('GoTo')) { const target = action.get(key('D')); if (!target) fail('invalid-navigation'); return { destination: target }; }
  if (type === key('URI')) {
    const uri = pdfText(action.get(key('URI')));
    if (!/^(https?:|mailto:)/i.test(uri) || /[\u0000-\u001f]/.test(uri)) fail('unsupported-structure');
    return { uri };
  }
  return fail('unsupported-structure');
}
export function readDocumentNavigation(doc: PDFDocument): PdfNavigation {
  const named = destinationEntries(doc);
  const toBookmark = (node: OutlineNode): PdfBookmark => {
    const target = navigationTarget(doc, node.dict);
    // External bookmark actions are retained but not followed or converted to page targets.
    return { id: node.id, title: pdfText(node.dict.get(key('Title'))), destination: target.destination ? describeDestination(doc, target.destination, named) : null, ...(target.uri ? { uri: target.uri } : {}), children: node.children.map(toBookmark) };
  };
  const links: PdfLink[] = [];
  doc.getPages().forEach((page, pageIndex) => {
    const raw = page.node.get(key('Annots')); if (!raw) return;
    const array = doc.context.lookup(raw); if (!(array instanceof PDFArray)) fail('invalid-navigation');
    for (const ref of array.asArray()) {
      const dict = doc.context.lookup(ref); if (!(dict instanceof PDFDict)) fail('invalid-navigation');
      if (dict.get(key('Subtype')) !== key('Link')) continue;
      if (!(ref instanceof PDFRef)) fail('invalid-navigation');
      const rect = dict.lookupMaybe(key('Rect'), PDFArray); if (!rect || rect.size() !== 4) fail('invalid-navigation');
      const coords = rect.asArray().map(value => value instanceof PDFNumber ? value.asNumber() : Number.NaN);
      if (!coords.every(Number.isFinite)) fail('invalid-navigation');
      const target = navigationTarget(doc, dict);
      links.push({ id: ref.toString(), pageIndex, rect: [coords[0], coords[1], coords[2], coords[3]], destination: target.destination ? describeDestination(doc, target.destination, named) : null, ...(target.uri ? { uri: target.uri } : {}) });
      if (links.length > 5000) fail('limit-exceeded');
    }
  });
  return { bookmarks: outlineNodes(doc).map(toBookmark), links, destinations: [...named].map(([name, value]) => ({ name, destination: describeDestination(doc, value, named) })) };
}
export async function readNavigation(bytes: Uint8Array): Promise<PdfNavigation> { return readDocumentNavigation(await loadNavigationDocument(bytes)); }

function writeOutlineTree(doc: PDFDocument, nodes: OutlineNode[]) {
  let rootRaw = doc.catalog.get(key('Outlines'));
  let root = rootRaw ? doc.context.lookup(rootRaw) : undefined;
  if (!(root instanceof PDFDict)) { root = doc.context.obj({ Type: 'Outlines' }); rootRaw = doc.context.register(root); doc.catalog.set(key('Outlines'), rootRaw); }
  if (!(rootRaw instanceof PDFRef)) { rootRaw = doc.context.register(root); doc.catalog.set(key('Outlines'), rootRaw); }
  const write = (siblings: OutlineNode[], parent: PDFRef, dict: PDFDict): number => {
    if (siblings.length) { dict.set(key('First'), siblings[0].ref); dict.set(key('Last'), siblings[siblings.length - 1].ref); }
    else { dict.delete(key('First')); dict.delete(key('Last')); }
    let descendants = 0;
    siblings.forEach((node, index) => {
      node.dict.set(key('Parent'), parent);
      if (index) node.dict.set(key('Prev'), siblings[index - 1].ref); else node.dict.delete(key('Prev'));
      if (index + 1 < siblings.length) node.dict.set(key('Next'), siblings[index + 1].ref); else node.dict.delete(key('Next'));
      const children = write(node.children, node.ref, node.dict);
      const expanded = (node.dict.lookupMaybe(key('Count'), PDFNumber)?.asNumber() ?? 0) >= 0;
      descendants += 1 + (expanded ? children : 0);
    });
    const old = dict.lookupMaybe(key('Count'), PDFNumber)?.asNumber() ?? 0;
    if (siblings.length) dict.set(key('Count'), PDFNumber.of(old < 0 ? -descendants : descendants)); else dict.delete(key('Count'));
    return descendants;
  };
  if (!(rootRaw instanceof PDFRef) || !(root instanceof PDFDict)) fail('invalid-navigation');
  write(nodes, rootRaw, root);
}
export async function editNavigation(bytes: Uint8Array, change: NavigationChange): Promise<Uint8Array> {
  const doc = await loadNavigationDocument(bytes); readDocumentNavigation(doc);
  const nodes = outlineNodes(doc);
  const flat: OutlineNode[] = []; const visit = (list: OutlineNode[]) => list.forEach(node => { flat.push(node); visit(node.children); }); visit(nodes);
  const pageTarget = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= doc.getPageCount()) fail('invalid-change');
    return doc.context.obj([doc.getPage(index).ref, 'Fit']);
  };
  const title = (value: string) => { if (typeof value !== 'string' || !value.trim() || value.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('invalid-change'); return PDFHexString.fromText(value); };
  if (change.kind === 'rename-bookmark') {
    const node = flat.find(node => node.id === change.id); if (!node) fail('invalid-change'); node.dict.set(key('Title'), title(change.title));
  } else if (change.kind === 'add-bookmark') {
    if (flat.length >= 1000) fail('limit-exceeded');
    const parent = change.parentId ? flat.find(node => node.id === change.parentId) : undefined;
    if (change.parentId && !parent) fail('invalid-change');
    const dict = doc.context.obj({ Title: title(change.title), Dest: pageTarget(change.pageIndex) }); const ref = doc.context.register(dict);
    (parent?.children ?? nodes).push({ id: ref.toString(), ref, dict, children: [] }); writeOutlineTree(doc, nodes);
  } else if (change.kind === 'remove-bookmark') {
    if (!flat.some(node => node.id === change.id)) fail('invalid-change');
    const remove = (list: OutlineNode[]) => { const index = list.findIndex(node => node.id === change.id); if (index >= 0) list.splice(index, 1); else list.forEach(node => remove(node.children)); };
    remove(nodes); writeOutlineTree(doc, nodes);
  } else {
    let found = false;
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(key('Annots'), PDFArray); if (!annots) continue;
      for (let index = 0; index < annots.size(); index++) {
        const ref = annots.get(index); if (ref.toString() !== change.id) continue;
        const dict = doc.context.lookup(ref); if (!(dict instanceof PDFDict) || dict.get(key('Subtype')) !== key('Link')) fail('invalid-change');
        if (change.kind === 'remove-link') annots.remove(index);
        else { dict.delete(key('A')); dict.set(key('Dest'), pageTarget(change.pageIndex)); }
        found = true; break;
      }
    }
    if (!found) fail('invalid-change');
  }
  readDocumentNavigation(doc);
  return doc.save();
}
