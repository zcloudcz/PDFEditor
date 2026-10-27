import { PDFArray, PDFContext, PDFDocument, PDFName, PDFNumber, PDFParser, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export class RedactionDecodeLimitError extends Error {
  readonly code = 'limit-exceeded';
  constructor() { super('limit-exceeded'); }
}

/** Per-operation decoder budget. Guard allocation itself, including a single
 * DEFLATE block that expands past the bound before getBytes() could return. */
export function createRedactionDecoder(perStream = 8 * 1024 * 1024, aggregate = 32 * 1024 * 1024): (stream: PDFRawStream) => Uint8Array {
  let allocated = 0;
  const cache = new WeakMap<PDFRawStream, Uint8Array>();
  return stream => {
    const cached = cache.get(stream); if (cached) return cached;
    const encoded = stream.getContents();
    if (encoded.length > perStream) throw new RedactionDecodeLimitError();
    const filter = stream.dict.get(PDFName.of('Filter'));
    if (filter !== undefined && filter !== PDFName.of('FlateDecode')) throw new Error('unsupported-structure');
    if (stream.dict.has(PDFName.of('DecodeParms'))) throw new Error('unsupported-structure');
    if (!filter) {
      if (allocated + encoded.length > aggregate) throw new RedactionDecodeLimitError();
      allocated += encoded.length; cache.set(stream, encoded); return encoded;
    }
    const decoder = decodePDFRawStream(stream) as unknown as {
      buffer: Uint8Array; ensureBuffer(size: number): Uint8Array; decode(): Uint8Array;
    };
    if (typeof decoder.ensureBuffer !== 'function') throw new Error('unsupported-structure');
    decoder.ensureBuffer = (size: number): Uint8Array => {
      if (!Number.isSafeInteger(size) || size < 0 || size > perStream) throw new RedactionDecodeLimitError();
      const old = decoder.buffer;
      if (old.length >= size) return old;
      const length = Math.min(perStream, Math.max(size, old.length * 2, 512));
      if (allocated + length - old.length > aggregate) throw new RedactionDecodeLimitError();
      allocated += length - old.length;
      const next = new Uint8Array(length); next.set(old); decoder.buffer = next; return next;
    };
    const decoded = decoder.decode(); cache.set(stream, decoded); return decoded;
  };
}


/** pdf-lib expands object/xref streams while loading, before profile validation.
 * An isolated parser instance supplies already bounded raw transport streams to
 * those internal parsers. No prototype or application-global decoder is changed.
 * The PDFDocument constructor adapter mirrors pdf-lib 1.17.1 load(context,true,false). */
export async function loadRedactionDocument(bytes: Uint8Array, decode: ReturnType<typeof createRedactionDecoder>): Promise<PDFDocument> {
  let decodeFailure: unknown; let transportObjects = 0;
  class BoundedParser extends PDFParser {
    override parseObject() {
      const object = super.parseObject();
      if (!(object instanceof PDFRawStream)) return object;
      const type = object.dict.lookup(PDFName.of('Type'));
      if (type !== PDFName.of('ObjStm') && type !== PDFName.of('XRef')) return object;
      try {
        const contents = decode(object), dict = object.dict.clone();
        const integer = (value: unknown, max = 100000): number => {
          if (!(value instanceof PDFNumber) || !Number.isSafeInteger(value.asNumber()) || value.asNumber() < 0 || value.asNumber() > max) throw new RedactionDecodeLimitError();
          return value.asNumber();
        };
        if (type === PDFName.of('ObjStm')) {
          transportObjects += integer(dict.get(PDFName.of('N')));
          integer(dict.get(PDFName.of('First')), contents.length);
        } else {
          const size = integer(dict.get(PDFName.of('Size'))), widths = dict.get(PDFName.of('W')), index = dict.get(PDFName.of('Index'));
          if (!(widths instanceof PDFArray) || widths.size() !== 3) throw new RedactionDecodeLimitError();
          const rowWidth = widths.asArray().reduce((total, value) => total + integer(value, 8), 0);
          if (rowWidth < 1) throw new RedactionDecodeLimitError();
          let count = size;
          if (index !== undefined) {
            if (!(index instanceof PDFArray) || index.size() % 2) throw new RedactionDecodeLimitError();
            count = 0;
            for (let i = 0; i < index.size(); i += 2) {
              const first = integer(index.get(i)), length = integer(index.get(i + 1));
              if (first + length > size) throw new RedactionDecodeLimitError(); count += length;
            }
          }
          if (count * rowWidth !== contents.length) throw new RedactionDecodeLimitError();
          transportObjects += count;
        }
        if (transportObjects > 100000) throw new RedactionDecodeLimitError();
        dict.delete(PDFName.of('Filter')); dict.delete(PDFName.of('DecodeParms'));
        dict.set(PDFName.of('Length'), PDFNumber.of(contents.length));
        return PDFRawStream.of(dict, contents);
      } catch (error) { decodeFailure = error; throw error; }
    }
  }
  const parser = new BoundedParser(bytes, 100, true);
  let context: PDFContext;
  try { context = await parser.parseDocument(); } catch (error) { throw decodeFailure ?? error; }
  const Document = PDFDocument as unknown as new (context: PDFContext, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument;
  return new Document(context, true, false);
}

