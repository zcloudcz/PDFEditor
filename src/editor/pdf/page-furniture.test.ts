// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { degrees, PDFDocument, PDFName, PDFNumber, PDFString, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyPageFurniture, removePageFurniture } from './page-furniture';
import { inspect, unchangedPixelsEqual } from '../../tests/helpers/editor-pdf-inspect';

const fontBytes = new Uint8Array(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'));
async function fixture(rotation = 0, unit = 1) {
  const doc = await PDFDocument.create(), page = doc.addPage([400, 500]); page.setCropBox(20, 30, 320, 420); page.setRotation(degrees(rotation)); page.node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
  page.drawText('Source vectors', { x: 70, y: 180, size: 12 }); page.drawRectangle({ x: 60, y: 130, width: 80, height: 10, color: rgb(0.4, 0.5, 0.8) });
  doc.getForm().createCheckBox('preserved').addToPage(page, { x: 70, y: 90, width: 20, height: 20 }); await doc.attach(new Uint8Array([1, 2, 3]), 'kept.bin');
  doc.addPage([300, 400]).drawText('Untouched second page'); return doc.save();
}
describe('managed PDF page furniture', () => {
  it.each([0, 90, 180, 270])('reopens, replaces and removes one owned stream at rotation %i while preserving forms and source vectors', async rotation => {
    const source = await fixture(rotation), clone = source.slice();
    const first = await applyPageFurniture(source, { id: 'header', kind: 'header', indices: [0], text: 'Příliš žluťoučký', margin: 20, fontSize: 12 }, { fontBytes });
    const updated = await applyPageFurniture(first, { id: 'header', kind: 'header', indices: [0], text: 'Nové záhlaví', margin: 20, fontSize: 12 }, { fontBytes });
    const inspected = await inspect(updated, true); expect(inspected.text).toContain('Nové záhlaví'); expect(inspected.text).not.toContain('Příliš'); expect(inspected.text.match(/Nové záhlaví/g)).toHaveLength(1);
    expect(inspected.text).toContain('Source vectors'); expect(inspected.fields).toHaveProperty('preserved'); expect(inspected.attachments).toHaveProperty('kept.bin');
    expect(unchangedPixelsEqual((await inspect(source, true, 2)).pixels, (await inspect(updated, true, 2)).pixels)).toBe(true);
    const removed = await removePageFurniture(updated, 'header'); expect(unchangedPixelsEqual((await inspect(source, true)).pixels, (await inspect(removed, true)).pixels)).toBe(true); expect(source).toEqual(clone);
  });
  it.each([0, 90, 180, 270])('positions header in physical visible points for CropBox and UserUnit at %i', async rotation => {
    const source = await fixture(rotation, 2), bytes = await applyPageFurniture(source, { id: 'x', kind: 'header', indices: [0], text: 'Header', margin: 24, fontSize: 12, align: 'left' }, { fontBytes });
    const doc = await getDocument({ data: bytes.slice() }).promise;
    try { const page = await doc.getPage(1), content = await page.getTextContent(), item = content.items.find(item => 'str' in item && item.str === 'Header'); expect(item && 'transform' in item).toBe(true);
      if (item && 'transform' in item) { const point = page.getViewport({ scale: 1 }).convertToViewportPoint(item.transform[4], item.transform[5]); expect(point[0]).toBeCloseTo(24, 2); expect(point[1]).toBeCloseTo(36, 2); }
    } finally { await doc.destroy(); }
  });
  it('uses stable range replacement and sequential Bates values across mixed sizes', async () => {
    const source = await fixture(), first = await applyPageFurniture(source, { id: 'bates', kind: 'bates', indices: [1, 0], prefix: 'CZ-', start: 98, padding: 5 }, { fontBytes });
    expect((await inspect(first, false, 2)).text).toContain('CZ-00098'); expect((await inspect(first)).text).toContain('CZ-00099');
    const replacement = await applyPageFurniture(first, { id: 'bates', kind: 'page-number', indices: [1], start: 1 }, { fontBytes }); expect((await inspect(replacement)).text).not.toContain('CZ-'); expect((await inspect(replacement, false, 2)).text).toContain('2 / 2');
  });
  it('embeds an image watermark and removes it without rasterizing the original', async () => {
    const source = await fixture(); const { createCanvas } = await import('@napi-rs/canvas'), canvas = createCanvas(20, 20), context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 20, 20);
    const bytes = await applyPageFurniture(source, { id: 'image', kind: 'image-watermark', indices: [0], angle: 25, opacity: 0.3, image: { bytes: new Uint8Array(canvas.toBuffer('image/png')), type: 'png', width: 100, height: 100 } });
    expect(unchangedPixelsEqual((await inspect(source, true)).pixels, (await inspect(bytes, true)).pixels)).toBe(false); expect((await inspect(bytes)).text).toContain('Source vectors');
    expect(unchangedPixelsEqual((await inspect(source, true)).pixels, (await inspect(await removePageFurniture(bytes, 'image'), true)).pixels)).toBe(true);
  });
  it('rejects signed, malformed, invalid requests and unsupported glyphs before changing the source', async () => {
    const source = await fixture(), spec = { id: 'test', kind: 'footer' as const, indices: [0], text: 'Valid' };
    for (const patch of [{ indices: [0, 0] }, { opacity: NaN }, { fontSize: -1 }, { text: '\u0000' }, { text: '漢' }]) await expect(applyPageFurniture(source, { ...spec, ...patch }, { fontBytes })).rejects.toBeDefined();
    const signed = await PDFDocument.load(source); signed.catalog.set(PDFName.of('Perms'), signed.context.obj({ DocMDP: signed.context.register(signed.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3], Contents: PDFString.of('signature') })) }));
    await expect(applyPageFurniture(await signed.save(), spec, { fontBytes })).rejects.toMatchObject({ code: 'unsupported-structure' }); await expect(applyPageFurniture(new Uint8Array([1, 2, 3]), spec, { fontBytes })).rejects.toBeDefined();
    const controller = new AbortController(); controller.abort(); await expect(applyPageFurniture(source, spec, { fontBytes, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
