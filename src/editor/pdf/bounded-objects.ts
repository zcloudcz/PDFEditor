import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { PdfNavigationError } from './navigation';
import { createRedactionDecoder, loadRedactionDocument, RedactionDecodeLimitError } from './redaction-bounded-decode';
import { profileDocument } from './structure-profile';

const maxStream = 20 * 1024 * 1024, maxTotal = 50 * 1024 * 1024;
const decoders = new WeakMap<PDFDocument, ReturnType<typeof createRedactionDecoder>>();

/** One allocation budget includes load-time object/xref streams and later extraction. */
export async function loadBoundedObjectDocument(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new PdfNavigationError('invalid-input');
  if (bytes.length > maxTotal) throw new PdfNavigationError('limit-exceeded');
  const decode = createRedactionDecoder(maxStream, maxTotal);
  let doc: PDFDocument;
  try { doc = await loadRedactionDocument(bytes.slice(), decode); }
  catch (error) {
    if (error instanceof RedactionDecodeLimitError) throw new PdfNavigationError('limit-exceeded');
    throw new PdfNavigationError(error instanceof Error && error.message === 'unsupported-structure' ? 'unsupported-structure' : 'invalid-input');
  }
  let encodedTotal = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) if (object instanceof PDFRawStream) {
    encodedTotal += object.getContentsSize();
    if (encodedTotal > maxTotal) throw new PdfNavigationError('limit-exceeded');
  }
  const profile = profileDocument(doc);
  if (profile.encryption !== 'absent' || profile.signatures !== 'absent') throw new PdfNavigationError('unsupported-structure');
  if (profile.pageCount === null || profile.pageCount < 1) throw new PdfNavigationError('invalid-input');
  if (profile.pageCount > 200) throw new PdfNavigationError('limit-exceeded');
  decoders.set(doc, decode); return doc;
}

export function decodeObjectStream(doc: PDFDocument, stream: PDFRawStream): Uint8Array {
  const decode = decoders.get(doc);
  if (!decode) throw new PdfNavigationError('unsupported-structure');
  try { return decode(stream); }
  catch (error) {
    throw new PdfNavigationError(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'unsupported-structure');
  }
}
