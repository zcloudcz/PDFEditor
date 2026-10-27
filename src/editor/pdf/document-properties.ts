import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { loadNavigationDocument, PdfNavigationError } from './navigation';

export interface PdfDocumentProperties {
  title: string; author: string; subject: string; keywords: string;
  creator: string; producer: string; xmp: string | null;
}
export type DocumentPropertiesChange = Partial<PdfDocumentProperties>;
const key = PDFName.of;
const limit = 1024 * 1024;
function invalid(): never { throw new PdfNavigationError('invalid-change'); }
function readXmp(doc: PDFDocument): string | null {
  const raw = doc.catalog.get(key('Metadata'));
  if (!raw) return null;
  const stream = doc.context.lookup(raw);
  if (!(stream instanceof PDFRawStream) || stream.dict.get(key('Type')) !== key('Metadata') || stream.dict.get(key('Subtype')) !== key('XML')) throw new PdfNavigationError('unsupported-structure');
  const data = decodePDFRawStream(stream).getBytes(limit + 1);
  if (data.length > limit) throw new PdfNavigationError('limit-exceeded');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new PdfNavigationError('unsupported-structure'); }
}
function properties(doc: PDFDocument): PdfDocumentProperties {
  return { title: doc.getTitle() ?? '', author: doc.getAuthor() ?? '', subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '', creator: doc.getCreator() ?? '', producer: doc.getProducer() ?? '', xmp: readXmp(doc) };
}
export async function readDocumentProperties(bytes: Uint8Array): Promise<PdfDocumentProperties> {
  return properties(await loadNavigationDocument(bytes));
}
function validateXml(xml: string): void {
  if (new TextEncoder().encode(xml).length > limit || /<!/i.test(xml)) invalid();
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror') || parsed.doctype || !parsed.documentElement || !/xmpmeta$/i.test(parsed.documentElement.localName)) invalid();
  for (const node of Array.from(parsed.childNodes)) {
    if (node.nodeType === 7 && node.nodeName !== 'xml' && node.nodeName !== 'xpacket') invalid();
  }
}
export async function editDocumentProperties(bytes: Uint8Array, changes: DocumentPropertiesChange): Promise<Uint8Array> {
  const doc = await loadNavigationDocument(bytes);
  properties(doc); // Reject malformed existing metadata before a rewrite.
  if (!changes || typeof changes !== 'object' || !Object.keys(changes).length || Object.keys(changes).some(field => !['title','author','subject','keywords','creator','producer','xmp'].includes(field))) invalid();
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'xmp') { if (value !== null && (typeof value !== 'string' || value.length === 0)) invalid(); if (typeof value === 'string') validateXml(value); }
    else if (typeof value !== 'string' || value.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid();
  }
  if (changes.title !== undefined) doc.setTitle(changes.title, { showInWindowTitleBar: false });
  if (changes.author !== undefined) doc.setAuthor(changes.author);
  if (changes.subject !== undefined) doc.setSubject(changes.subject);
  if (changes.keywords !== undefined) doc.setKeywords(changes.keywords.split(',').map(word => word.trim()).filter(Boolean));
  if (changes.creator !== undefined) doc.setCreator(changes.creator);
  if (changes.producer !== undefined) doc.setProducer(changes.producer);
  if (changes.xmp === null) doc.catalog.delete(key('Metadata'));
  else if (changes.xmp !== undefined) {
    const data = new TextEncoder().encode(changes.xmp);
    const dict = doc.context.obj({ Type: 'Metadata', Subtype: 'XML', Length: data.length });
    doc.catalog.set(key('Metadata'), doc.context.register(PDFRawStream.of(dict, data)));
  }
  return doc.save({ updateFieldAppearances: false });
}
