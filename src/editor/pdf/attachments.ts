import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { PdfNavigationError } from './navigation';
import { loadBoundedObjectDocument as loadNavigationDocument, decodeObjectStream } from './bounded-objects';

export interface PdfAttachment { id: string; filename: string; mimeType: string; size: number }
export type AttachmentChange = { kind: 'import'; filename: string; bytes: Uint8Array; mimeType?: string } | { kind: 'remove'; id: string };
const key = PDFName.of, maxFile = 20 * 1024 * 1024, maxTotal = 50 * 1024 * 1024, maxCount = 100;
function fail(code: 'invalid-change' | 'unsupported-structure' | 'limit-exceeded'): never { throw new PdfNavigationError(code); }
function filenameSafe(name: string): boolean {
  return name.length > 0 && name.length <= 255 && !/[/\\:\u0000-\u001f\u007f]/.test(name) && !/^\.+$/.test(name) && !name.startsWith('.') && !/[. ]$/.test(name);
}
function text(value: PDFObject | undefined): string {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText();
  return fail('unsupported-structure');
}
function compareNameBytes(left: PDFString | PDFHexString, right: PDFString | PDFHexString): number {
  const a = left.asBytes(), b = right.asBytes();
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}
interface Entry { id: string; name: string; ref: PDFRef; spec: PDFDict; stream: PDFRawStream; mime: string; size: number }
function parse(doc: PDFDocument): { names?: PDFDict; tree?: PDFDict; pairs?: PDFArray; entries: Entry[]; af?: PDFArray } {
  const namesRaw = doc.catalog.get(key('Names'));
  const names = namesRaw && doc.context.lookup(namesRaw);
  if (namesRaw && !(names instanceof PDFDict)) fail('unsupported-structure');
  const treeRaw = names instanceof PDFDict ? names.get(key('EmbeddedFiles')) : undefined;
  const tree = treeRaw && doc.context.lookup(treeRaw);
  if (treeRaw && !(tree instanceof PDFDict)) fail('unsupported-structure');
  if (tree instanceof PDFDict && tree.keys().some(k => k.decodeText() !== 'Names')) fail('unsupported-structure');
  const pairsRaw = tree instanceof PDFDict ? tree.get(key('Names')) : undefined;
  const pairs = pairsRaw && doc.context.lookup(pairsRaw);
  if (pairsRaw && !(pairs instanceof PDFArray)) fail('unsupported-structure');
  if (pairs instanceof PDFArray && (pairs.size() % 2 || pairs.size() > maxCount * 2)) fail('unsupported-structure');
  const afRaw = doc.catalog.get(key('AF'));
  const af = afRaw && doc.context.lookup(afRaw);
  if (afRaw && !(af instanceof PDFArray)) fail('unsupported-structure');
  for (const page of doc.getPages()) {
    if (page.node.has(key('AF'))) fail('unsupported-structure');
    const annots = page.node.get(key('Annots'));
    if (!annots) continue;
    const array = doc.context.lookup(annots);
    if (!(array instanceof PDFArray)) fail('unsupported-structure');
    if (array.asArray().some(item => { const value = doc.context.lookup(item); return value instanceof PDFDict && value.get(key('Subtype')) === key('FileAttachment'); })) fail('unsupported-structure');
  }
  const entries: Entry[] = [], seen = new Set<string>(); let total = 0;
  if (pairs instanceof PDFArray) for (let index = 0; index < pairs.size(); index += 2) {
    const name = text(pairs.get(index)), ref = pairs.get(index + 1);
    if (!filenameSafe(name) || seen.has(name) || !(ref instanceof PDFRef)) fail('unsupported-structure');
    seen.add(name);
    const spec = doc.context.lookup(ref); if (!(spec instanceof PDFDict) || spec.get(key('Type')) !== key('Filespec')) fail('unsupported-structure');
    const embedded = spec.lookupMaybe(key('EF'), PDFDict); const streamRaw = embedded?.get(key('F'));
    const stream = streamRaw && doc.context.lookup(streamRaw);
    if (!(stream instanceof PDFRawStream) || stream.dict.get(key('Type')) !== key('EmbeddedFile')) fail('unsupported-structure');
    const declared = stream.dict.lookupMaybe(key('Params'), PDFDict)?.lookupMaybe(key('Size'), PDFNumber)?.asNumber();
    if (declared !== undefined && (!Number.isInteger(declared) || declared < 0 || declared > maxFile)) fail('limit-exceeded');
    if (stream.getContentsSize() > maxFile) fail('limit-exceeded');
    const mime = stream.dict.get(key('Subtype'));
    if (mime && !(mime instanceof PDFName)) fail('unsupported-structure');
    const size = declared ?? -1; total += Math.max(size, stream.getContentsSize()); if (total > maxTotal) fail('limit-exceeded');
    entries.push({ id: ref.toString(), name, ref, spec, stream, mime: mime instanceof PDFName ? mime.decodeText() : 'application/octet-stream', size });
  }
  if (af instanceof PDFArray && af.asArray().some(ref => !(ref instanceof PDFRef) || !entries.some(entry => entry.id === ref.toString()))) fail('unsupported-structure');
  return { names: names instanceof PDFDict ? names : undefined, tree: tree instanceof PDFDict ? tree : undefined, pairs: pairs instanceof PDFArray ? pairs : undefined, entries, af: af instanceof PDFArray ? af : undefined };
}
function decode(doc: PDFDocument, entry: Entry): Uint8Array {
  const bytes = decodeObjectStream(doc, entry.stream);
  if (bytes.length > maxFile || (entry.size >= 0 && entry.size !== bytes.length)) fail('limit-exceeded');
  return new Uint8Array(bytes);
}
export async function listAttachments(bytes: Uint8Array): Promise<PdfAttachment[]> {
  const doc = await loadNavigationDocument(bytes);
  return parse(doc).entries.map(entry => ({ id: entry.id, filename: entry.name, mimeType: entry.mime, size: entry.size }));
}
export async function exportAttachment(bytes: Uint8Array, id: string): Promise<{ filename: string; bytes: Uint8Array; mimeType: string }> {
  const doc = await loadNavigationDocument(bytes); const entry = parse(doc).entries.find(item => item.id === id);
  if (!entry) fail('invalid-change');
  return { filename: entry.name, bytes: decode(doc, entry), mimeType: entry.mime };
}
export async function editAttachments(bytes: Uint8Array, change: AttachmentChange): Promise<Uint8Array> {
  if (change.kind === 'import') {
    if (!ArrayBuffer.isView(change.bytes) || change.bytes.BYTES_PER_ELEMENT !== 1 || !change.bytes.length) fail('invalid-change');
    if (change.bytes.length > maxFile) fail('limit-exceeded');
    change = { ...change, bytes: new Uint8Array(change.bytes) };
  } else change = { ...change };
  bytes = bytes.slice();
  const doc = await loadNavigationDocument(bytes), parsed = parse(doc);
  if (change.kind === 'import') {
    if (!filenameSafe(change.filename) || !ArrayBuffer.isView(change.bytes) || change.bytes.BYTES_PER_ELEMENT !== 1 || !change.bytes.length || parsed.entries.some(entry => entry.name === change.filename)) fail('invalid-change');
    if (change.bytes.length > maxFile || parsed.entries.length >= maxCount || parsed.entries.reduce((sum, entry) => sum + Math.max(entry.size, entry.stream.getContentsSize()), 0) + change.bytes.length > maxTotal) fail('limit-exceeded');
    if (change.mimeType && (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(change.mimeType) || change.mimeType.length > 127)) fail('invalid-change');
    const data = new Uint8Array(change.bytes.length);
    data.set(change.bytes);
    const embedded = doc.context.register(doc.context.flateStream(data, { Type: 'EmbeddedFile', Subtype: change.mimeType ?? 'application/octet-stream', Params: { Size: data.length } }));
    const spec = doc.context.register(doc.context.obj({ Type: 'Filespec', F: PDFString.of(change.filename), UF: PDFHexString.fromText(change.filename), EF: { F: embedded }, AFRelationship: 'Unspecified' }));
    let names = parsed.names;
    if (!names) { names = doc.context.obj({}); doc.catalog.set(key('Names'), names); }
    let tree = parsed.tree;
    if (!tree) { tree = doc.context.obj({}); names.set(key('EmbeddedFiles'), tree); }
    let pairs = parsed.pairs;
    if (!pairs) { pairs = doc.context.obj([]); tree.set(key('Names'), pairs); }
    const items: Array<{ name: PDFString | PDFHexString; ref: PDFObject }> = [];
    for (let index = 0; index < pairs.size(); index += 2) {
      const name = pairs.get(index); if (!(name instanceof PDFString || name instanceof PDFHexString)) fail('unsupported-structure');
      items.push({ name, ref: pairs.get(index + 1) });
    }
    items.push({ name: PDFHexString.fromText(change.filename), ref: spec });
    items.sort((a, b) => compareNameBytes(a.name, b.name));
    while (pairs.size()) pairs.remove(pairs.size() - 1);
    for (const item of items) { pairs.push(item.name); pairs.push(item.ref); }
    let af = parsed.af;
    if (!af) { af = doc.context.obj([]); doc.catalog.set(key('AF'), af); }
    af.push(spec);
  } else if (change.kind === 'remove') {
    const index = parsed.entries.findIndex(entry => entry.id === change.id);
    if (index < 0 || !parsed.pairs) fail('invalid-change');
    const ref = parsed.entries[index].ref; parsed.pairs.remove(index * 2 + 1); parsed.pairs.remove(index * 2);
    if (parsed.af) { const at = parsed.af.asArray().findIndex(item => item.toString() === ref.toString()); if (at >= 0) parsed.af.remove(at); if (!parsed.af.size()) doc.catalog.delete(key('AF')); }
    if (!parsed.pairs.size()) { parsed.names?.delete(key('EmbeddedFiles')); if (parsed.names && !parsed.names.keys().length) doc.catalog.delete(key('Names')); }
  } else fail('invalid-change');
  return doc.save({ updateFieldAppearances: false });
}
