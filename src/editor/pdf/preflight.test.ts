// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, degrees, rgb } from 'pdf-lib';
import { createCanvas, Path2D, DOMMatrix, ImageData } from '@napi-rs/canvas';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { preflightPdf } from './preflight';
import { exportPrintPdf } from './print-export';
import { validateConformance } from './conformance';
const originalHex = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toHex'), originalMap = Object.getOwnPropertyDescriptor(Map.prototype, 'getOrInsertComputed');
beforeEach(() => {
  vi.stubGlobal('Path2D', Path2D); vi.stubGlobal('DOMMatrix', DOMMatrix); vi.stubGlobal('ImageData', ImageData);
  if (!originalHex) Object.defineProperty(Uint8Array.prototype, 'toHex', { configurable: true, value: function(this: Uint8Array) { return Buffer.from(this).toString('hex'); } });
  if (!originalMap) Object.defineProperty(Map.prototype, 'getOrInsertComputed', { configurable: true, value: function<K,V>(this: Map<K,V>, key: K, make: (key: K) => V) { if (!this.has(key)) this.set(key, make(key)); return this.get(key); } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (!originalHex) Reflect.deleteProperty(Uint8Array.prototype, 'toHex');
  if (!originalMap) Reflect.deleteProperty(Map.prototype, 'getOrInsertComputed');
});
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { resolve } = await import('node:path'), { pathToFileURL } = await import('node:url');
  return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});
async function fixture(embedded = false) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = embedded ? await doc.embedFont(await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf')) : undefined;
  const page = doc.addPage([300, 400]); page.drawText('Printable', { x: 40, y: 300, size: 12, font });
  return doc;
}
describe('bounded print preflight and ordinary vector export', () => {
  it('detects unembedded fonts and accepts a real embedded font', async () => {
    expect((await preflightPdf(await (await fixture()).save())).findings.some(f => f.code === 'font-not-embedded')).toBe(true);
    expect((await preflightPdf(await (await fixture(true)).save())).findings.some(f => f.code === 'font-not-embedded')).toBe(false);
  });
  it('measures placed image DPI, reports transparency and text outside the trim box', async () => {
    const doc = await fixture(true), page = doc.getPage(0), canvas = createCanvas(100, 100);
    canvas.getContext('2d').fillRect(0, 0, 100, 100);
    const image = await doc.embedPng(canvas.toBuffer('image/png'));
    page.drawImage(image, { x: 30, y: 40, width: 144, height: 72 });
    page.drawRectangle({ x: 40, y: 80, width: 20, height: 30, color: rgb(1, 0, 0), opacity: .5 });
    page.setTrimBox(50, 50, 200, 300);
    const report = await preflightPdf(await doc.save());
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'image-low-dpi', value: 50 }), expect.objectContaining({ code: 'transparency' }), expect.objectContaining({ code: 'text-outside-trim' })]));
  });
  it('exports boxes and crop marks without changing text or rasterizing', async () => {
    const source = await (await fixture(true)).save(), copy = source.slice();
    const bytes = await exportPrintPdf(source, { profile: 'ordinary-pdf', trimInsetPt: 20, bleedPt: 5, cropMarks: true });
    expect(source).toEqual(copy);
    const doc = await PDFDocument.load(bytes), page = doc.getPage(0);
    expect(page.getTrimBox()).toEqual({ x: 20, y: 20, width: 260, height: 360 });
    expect(page.getBleedBox()).toEqual({ x: 15, y: 15, width: 270, height: 370 });
    const { getDocument } = await import('pdfjs-dist'); const loading = getDocument({ data: bytes.slice(), isEvalSupported: false });
    try { const pdf = await loading.promise, p = await pdf.getPage(1); expect((await p.getTextContent()).items.map(i => 'str' in i ? i.str : '').join('')).toBe('Printable');
      const viewport = p.getViewport({ scale: 1 }), canvas = createCanvas(300, 400), context = canvas.getContext('2d');
      await p.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      expect(context.getImageData(20, 8, 1, 1).data[0]).toBeLessThan(200);
      expect(context.getImageData(25, 25, 1, 1).data[0]).toBe(255);
      const original = getDocument({ data: source.slice(), isEvalSupported: false });
      try {
        const originalPage = await (await original.promise).getPage(1), before = createCanvas(300,400), beforeContext = before.getContext('2d');
        await originalPage.render({ canvas: before as never, canvasContext: beforeContext as never, viewport: originalPage.getViewport({scale:1}) }).promise;
        expect(context.getImageData(30,30,240,340).data).toEqual(beforeContext.getImageData(30,30,240,340).data);
        const { OPS } = await import('pdfjs-dist');
        expect((await p.getOperatorList()).fnArray).not.toContain(OPS.paintImageXObject);
      } finally { await original.destroy(); }
    } finally { await loading.destroy(); }
  });
  it('refuses unproven archival/press profiles and invalid settings without mutating input', async () => {
    const source = await (await fixture()).save();
    expect(await validateConformance(source, 'pdfa-2b')).toMatchObject({ status: 'unavailable', reason: 'independent-validator-unavailable' });
    await expect(exportPrintPdf(source, { profile: 'pdfx-4', trimInsetPt: 20, bleedPt: 5, cropMarks: true })).rejects.toMatchObject({ code: 'conformance-unavailable' });
    for (const trimInsetPt of [NaN, -1, 160, 2]) await expect(exportPrintPdf(source, { profile: 'ordinary-pdf', trimInsetPt, bleedPt: 5, cropMarks: true })).rejects.toMatchObject({ code: 'invalid-settings' });
    const abort = new AbortController(); abort.abort(); await expect(preflightPdf(source, 'ordinary-pdf', { signal: abort.signal })).rejects.toThrow();
  });
  it('refuses cropping expansion, rotated pages and nondefault physical units', async () => {
    for (const variant of ['crop', 'rotation', 'unit']) {
      const doc = await fixture(), page = doc.getPage(0);
      if (variant === 'crop') page.setCropBox(10, 10, 280, 380);
      if (variant === 'rotation') page.setRotation(degrees(90));
      if (variant === 'unit') page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
      await expect(exportPrintPdf(await doc.save(), { profile: 'ordinary-pdf', trimInsetPt: 20, bleedPt: 5, cropMarks: true })).rejects.toMatchObject({ code: 'unsupported-structure' });
    }
  });
  it('does not warn about a high resolution image and reports malformed boxes', async () => {
    const doc = await fixture(true), page = doc.getPage(0), image = await doc.embedPng(createCanvas(100, 100).toBuffer('image/png'));
    page.drawImage(image, { x: 80, y: 80, width: 10, height: 10 }); page.setTrimBox(-1, 0, 300, 400);
    const report = await preflightPdf(await doc.save());
    expect(report.findings.some(f => f.code === 'image-low-dpi')).toBe(false);
    expect(report.findings.some(f => f.code === 'invalid-boxes')).toBe(true);
  });
  it('refuses over-budget compressed streams before PDF.js inspection', async () => {
    const doc = await fixture(); doc.context.register(doc.context.flateStream(new Uint8Array(21 * 1024 * 1024)));
    await expect(preflightPdf(await doc.save())).rejects.toMatchObject({ code: 'limit-exceeded' });
  });
});
