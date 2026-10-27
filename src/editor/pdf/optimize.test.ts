// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib';
import { findPageCandidates, optimizePdf, renderOptimizationPreview } from './optimize';
import { inspect, unchangedPixelsEqual } from '../../tests/helpers/editor-pdf-inspect';

// Vite's browser URL has a root-relative path; keep the real engine and worker in Node.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { resolve } = await import('node:path'), { pathToFileURL } = await import('node:url');
  return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});

beforeEach(() => { vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) }); vi.stubGlobal('createImageBitmap', async (blob: Blob) => { const image = await loadImage(Buffer.from(await blob.arrayBuffer())); return Object.assign(image, { close: () => {} }); }); });
afterEach(() => { vi.unstubAllGlobals(); });
async function structuredFixture() {
  const doc = await PDFDocument.create(), page = doc.addPage([300, 400]); page.drawText('Preserved text', { x: 40, y: 250 }); page.drawRectangle({ x: 40, y: 100, width: 80, height: 20, color: rgb(0, 0.2, 0.9) });
  doc.getForm().createCheckBox('retained').addToPage(page, { x: 20, y: 20, width: 15, height: 15 }); await doc.attach(new Uint8Array([7, 8]), 'retained.bin');
  const annotation = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [100, 100, 120, 120], Contents: PDFString.of('Keep comment'), P: page.ref })); page.node.addAnnot(annotation);
  doc.context.register(doc.context.flateStream(new Uint8Array(20000).fill(123))); return doc.save({ useObjectStreams: false });
}
async function brokenImage(filter: 'DCTDecode' | 'JPXDecode'): Promise<Uint8Array> {
  const doc = await PDFDocument.create(), page = doc.addPage([200, 200]);
  const image = doc.context.register(doc.context.stream(new Uint8Array([1, 2, 3, 4]), {
    Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, BitsPerComponent: 8,
    ColorSpace: 'DeviceRGB', Filter: filter,
  }));
  const name = page.node.newXObject('Image', image);
  page.node.addContentStream(doc.context.register(doc.context.flateStream(`q 100 0 0 100 20 20 cm ${name} Do Q`)));
  return doc.save();
}
describe('lossless PDF optimization and candidate preview', () => {
  it.each(['DCTDecode', 'JPXDecode'] as const)('refuses an undecodable %s image in previews and optimization', async filter => {
    const source = await brokenImage(filter);
    await expect(findPageCandidates(source, new AbortController().signal)).rejects.toMatchObject({ code: 'verification-failed' });
    await expect(optimizePdf(source, { mode: 'lossless' }, new AbortController().signal)).rejects.toMatchObject({ code: 'verification-failed' });
  });
  it('rejects cumulative render work before allocating canvases', async () => {
    const doc = await PDFDocument.create(); for (let index = 0; index < 121; index++) doc.addPage([1000, 1000]);
    const source = await doc.save(), canvas = vi.fn(() => { throw new Error('canvas allocated'); });
    vi.stubGlobal('document', { createElement: canvas });
    await expect(findPageCandidates(source, new AbortController().signal)).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(canvas).not.toHaveBeenCalled();
  });
  it('reduces an uncompressed structured PDF and independently preserves pixels, text, forms, attachment and comments', async () => {
    const source = await structuredFixture(), copy = source.slice(), result = await optimizePdf(source, { mode: 'lossless' }, new AbortController().signal);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes); expect(result.removedObjects).toBeGreaterThan(0); expect(source).toEqual(copy);
    const before = await inspect(source, true), after = await inspect(result.bytes, true); expect(unchangedPixelsEqual(before.pixels, after.pixels)).toBe(true); expect(after.text).toBe(before.text); expect(after.fields).toHaveProperty('retained'); expect(after.attachments).toHaveProperty('retained.bin'); expect(after.annotations.some((a: { contentsObj?: { str: string } }) => a.contentsObj?.str === 'Keep comment')).toBe(true);
    const parsed = await PDFDocument.load(result.bytes); expect(parsed.catalog.has(PDFName.of('AcroForm'))).toBe(true);
  });
  it('never guarantees a size reduction or returns a larger candidate', async () => {
    const doc = await PDFDocument.create(); doc.addPage([200, 200]); const source = await doc.save(), result = await optimizePdf(source, { mode: 'lossless' }, new AbortController().signal); expect(result.afterBytes).toBeLessThanOrEqual(source.length); if (!result.changed) expect(result.bytes).toEqual(source);
  });
  it('finds deterministic white/duplicate candidates and does not remove pages, forms or invisible text', async () => {
    const doc = await PDFDocument.create(); doc.addPage([200, 200]); doc.addPage([200, 200]); doc.addPage([200, 200]).drawText('Hidden but searchable', { x: 10, y: 50, opacity: 0 }); const fourth = doc.addPage([200, 200]); doc.getForm().createCheckBox('not-blank').addToPage(fourth, { x: 30, y: 40, width: 20, height: 20 });
    const source = await doc.save(), result = await findPageCandidates(source, new AbortController().signal); expect(result).toEqual([{ pageIndex: 0, kind: 'blank' }, { pageIndex: 1, kind: 'blank' }, { pageIndex: 1, kind: 'duplicate', duplicateOf: 0 }]); expect((await PDFDocument.load(source)).getPageCount()).toBe(4);
  });
  it('recompresses only an explicitly chosen JPEG and retains form, annotation, text and vector content', async () => {
    const canvas = createCanvas(240, 180), context = canvas.getContext('2d');
    for (let y = 0; y < 180; y++) for (let x = 0; x < 240; x++) { context.fillStyle = `rgb(${(x * 13 + y * 7) % 256},${(x * 3 + y * 19) % 256},${(x * 23 + y * 11) % 256})`; context.fillRect(x, y, 1, 1); }
    const jpeg = canvas.toBuffer('image/jpeg', 100), iccAt = jpeg.indexOf(Buffer.from([0xff, 0xe2]));
    const plainJpeg = iccAt < 0 ? jpeg : Buffer.concat([jpeg.subarray(0, iccAt), jpeg.subarray(iccAt + 2 + jpeg.readUInt16BE(iccAt + 2))]);
    const doc = await PDFDocument.load(await structuredFixture()); const image = await doc.embedJpg(Uint8Array.from(plainJpeg)); doc.getPage(0).drawImage(image, { x: 140, y: 80, width: 100, height: 75 });
    const source = await doc.save({ useObjectStreams: false }), result = await optimizePdf(source, { mode: 'lossy', quality: 0.35 }, new AbortController().signal);
    expect(result.changed).toBe(true); expect(result.recompressedImages).toBe(1); expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    const before = await inspect(source, true), after = await inspect(result.bytes, true); expect(after.text).toEqual(before.text); expect(after.fields).toEqual(before.fields); expect(after.attachments).toEqual(before.attachments); expect(after.annotations).toEqual(before.annotations); expect(unchangedPixelsEqual(before.pixels, after.pixels)).toBe(false);
    const previewBefore = await renderOptimizationPreview(source, 0, new AbortController().signal), previewAfter = await renderOptimizationPreview(result.bytes, 0, new AbortController().signal);
    expect(previewBefore).toMatch(/^data:image\/png;base64,/); expect(previewAfter).toMatch(/^data:image\/png;base64,/); expect(previewAfter).not.toBe(previewBefore);
  });
  it('refuses unsupported image profiles and cancellation without output', async () => {
    const source = await structuredFixture(); await expect(optimizePdf(source, { mode: 'lossy', quality: 0.5 }, new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' }); const abort = new AbortController(); abort.abort(); await expect(optimizePdf(source, { mode: 'lossless' }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const doc = await PDFDocument.load(source); doc.catalog.set(PDFName.of('Perms'), doc.context.obj({})); await expect(optimizePdf(await doc.save(), { mode: 'lossless' }, new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
  it('fails closed on a corrupt JPEG and on image masks', async () => {
    await expect(optimizePdf(await brokenImage('DCTDecode'), { mode: 'lossy', quality: 0.5 }, new AbortController().signal)).rejects.toMatchObject({ code: 'verification-failed' });
    const doc = await PDFDocument.create(), page = doc.addPage([200, 200]);
    const image = doc.context.register(doc.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode', Mask: [0, 1, 0, 1, 0, 1] }));
    const name = page.node.newXObject('Masked', image); page.node.addContentStream(doc.context.register(doc.context.flateStream(`q 10 0 0 10 10 10 cm ${name} Do Q`)));
    await expect(optimizePdf(await doc.save(), { mode: 'lossy', quality: 0.5 }, new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
  it('refuses an EXIF-oriented JPEG whose browser and PDF decoders can disagree', async () => {
    const canvas = createCanvas(240, 180), context = canvas.getContext('2d');
    context.fillStyle = 'red'; context.fillRect(0, 0, 120, 180); context.fillStyle = 'blue'; context.fillRect(120, 0, 120, 180);
    const jpeg = canvas.toBuffer('image/jpeg', 100), exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000300000000000000', 'hex');
    const oriented = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]), doc = await PDFDocument.create(), page = doc.addPage([240, 180]);
    page.drawImage(await doc.embedJpg(Uint8Array.from(oriented)), { x: 0, y: 0, width: 240, height: 180 });
    const source = await doc.save({ useObjectStreams: false }), rendered = (await inspect(source, true)).pixels;
    const left = (90 * rendered.width + 30) * 4, right = (90 * rendered.width + 210) * 4;
    expect(rendered.data[left]).toBeGreaterThan(rendered.data[left + 2]);
    expect(rendered.data[right + 2]).toBeGreaterThan(rendered.data[right]);
    await expect(optimizePdf(source, { mode: 'lossy', quality: 0.35 }, new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
});
