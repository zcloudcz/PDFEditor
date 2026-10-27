// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { exportAttachment, listAttachments } from './attachments';
import { extractPortfolioItem } from './portfolio';
import { extractEmbeddedMedia } from './embedded-media';
import { decodeObjectStream, loadBoundedObjectDocument } from './bounded-objects';

const key = PDFName.of, cap = 20 * 1024 * 1024;
it.each(['media', 'attachment', 'portfolio', 'ObjStm', 'XRef'])('bounds %s allocation before a compressed block expands', async kind => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  // One small encoded PDF can request a much larger buffer inside a single DEFLATE block.
  const compressed = new Uint8Array(deflateSync(new Uint8Array(96 * 1024 * 1024)));
  const transport = kind === 'ObjStm' || kind === 'XRef';
  const stream = doc.context.register(PDFRawStream.of(doc.context.obj({
    Type: transport ? kind : kind === 'media' ? '3D' : 'EmbeddedFile',
    Filter: 'FlateDecode', Subtype: 'U3D', N: 0, First: 0, Size: 1, W: [1, 1, 1],
  }), compressed));
  let id = 'media:0:0';
  if (kind === 'media') page.node.set(key('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: '3D', Rect: [0,0,10,10], '3DD': stream }))]));
  else if (!transport) {
    const ref = doc.context.register(doc.context.obj({ Type: 'Filespec', F: PDFString.of('data.bin'), EF: { F: stream } })); id = ref.toString();
    doc.catalog.set(key('Names'), doc.context.obj({ EmbeddedFiles: { Names: [PDFString.of('data.bin'), ref] } }));
  }
  const bytes = await doc.save({ useObjectStreams: false });
  const NativeArray = Uint8Array; const allocations: number[] = [];
  vi.stubGlobal('Uint8Array', new Proxy(NativeArray, { construct(target, args) {
    if (typeof args[0] === 'number') allocations.push(args[0]); return Reflect.construct(target, args);
  } }));
  try {
    const result = transport ? listAttachments(bytes) : kind === 'media' ? extractEmbeddedMedia(bytes, id) : kind === 'portfolio' ? extractPortfolioItem(bytes, id) : exportAttachment(bytes, id);
    await expect(result).rejects.toMatchObject({ code: 'limit-exceeded' });
  } finally { vi.unstubAllGlobals(); }
  expect(Math.max(...allocations)).toBeLessThanOrEqual(cap);
});

it('shares aggregate decoded capacity between transport parsing and extraction', async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  // 17 MiB needs a capped 20 MiB buffer; two such allocations fit, the third does not.
  const compressed = new Uint8Array(deflateSync(new Uint8Array(17 * 1024 * 1024).fill(32)));
  doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'ObjStm', Filter: 'FlateDecode', N: 0, First: 0 }), compressed));
  const second = doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'EmbeddedFile', Filter: 'FlateDecode' }), compressed));
  const third = doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'EmbeddedFile', Filter: 'FlateDecode' }), compressed));
  const parsed = await loadBoundedObjectDocument(await doc.save({ useObjectStreams: false }));
  const stream = parsed.context.lookup(second) as PDFRawStream;
  expect(decodeObjectStream(parsed, stream)).toHaveLength(17 * 1024 * 1024);
  expect(decodeObjectStream(parsed, stream)).toHaveLength(17 * 1024 * 1024);
  expect(() => decodeObjectStream(parsed, parsed.context.lookup(third) as PDFRawStream)).toThrow('limit-exceeded');
});
