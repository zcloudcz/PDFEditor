import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPdf, exportSvg } from './exports';
import { createTemplate } from './templates';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function installRealCanvas() {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    if (tag !== 'canvas') return original(tag, options);
    const canvas = createCanvas(1, 1);
    (canvas as unknown as { toBlob: (callback: (blob: Blob) => void) => void }).toBlob = callback =>
      callback(new Blob([Uint8Array.from(canvas.toBuffer('image/png'))], { type: 'image/png' }));
    return canvas as unknown as HTMLCanvasElement;
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => Object.assign(await loadImage(Buffer.from(await blob.arrayBuffer())), { close() {} }));
}

describe('edited image export', () => {
  it('exports the same alpha mask into SVG and PDF while preserving the original project source', async () => {
    const source = createCanvas(20, 20); source.getContext('2d').fillRect(0, 0, 20, 20);
    installRealCanvas();
    const project = createTemplate('social');
    project.pages[0].objects = [{ id: 'image', kind: 'image', name: 'Asset', x: 0, y: 0, width: 20, height: 20,
      rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false,
      src: `data:image/png;base64,${source.toBuffer('image/png').toString('base64')}`,
      imageMask: { kind: 'circle' }, imageAdjustments: { brightness: 1.5, contrast: 1, saturation: 1, blur: 0 } }];
    project.pages[0].width = 20; project.pages[0].height = 20;
    const originalSrc = project.pages[0].objects[0].src;
    const svg = await exportSvg(project, project.pages[0].id);
    const encoded = /href="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(svg)?.[1];
    expect(encoded).toBeTruthy();
    const image = await loadImage(Buffer.from(encoded!.split(',')[1], 'base64'));
    const inspected = createCanvas(40, 40); inspected.getContext('2d').drawImage(image, 0, 0);
    expect(inspected.getContext('2d').getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect(inspected.getContext('2d').getImageData(20, 20, 1, 1).data[3]).toBe(255);
    const pdf = await PDFDocument.load(await exportPdf(project));
    expect(pdf.getPageCount()).toBe(1);
    expect(project.pages[0].objects[0].src).toBe(originalSrc);
  });

  it('normalizes a reset EXIF-6 JPEG into correctly rotated SVG and PDF pixels', async () => {
    installRealCanvas();
    const bytes = readFileSync(resolve('docs/validation/t12-exif6-qa.jpg'));
    const decoded = await loadImage(bytes);
    expect([decoded.width, decoded.height]).toEqual([200, 400]);
    const project = createTemplate('social');
    project.pages[0].width = 200; project.pages[0].height = 400;
    project.pages[0].objects = [{ id: 'jpeg', kind: 'image', name: 'Oriented', x: 0, y: 0, width: 200, height: 400,
      rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false,
      src: `data:image/jpeg;base64,${bytes.toString('base64')}` }];
    const svg = await exportSvg(project, project.pages[0].id);
    const data = /href="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(svg)?.[1];
    expect(data).toBeTruthy();
    const svgImage = await loadImage(Buffer.from(data!.split(',')[1], 'base64'));
    const svgCanvas = createCanvas(200, 400); svgCanvas.getContext('2d').drawImage(svgImage, 0, 0, 200, 400);
    const svgPixels = svgCanvas.getContext('2d');
    expect(svgPixels.getImageData(100, 50, 1, 1).data[0]).toBeGreaterThan(220);
    expect(svgPixels.getImageData(100, 350, 1, 1).data[2]).toBeGreaterThan(220);
    const pdfBytes = await exportPdf(project);
    const pdf = await getDocument({ data: pdfBytes.slice(), useSystemFonts: false }).promise;
    try {
      const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(200, 400), context = canvas.getContext('2d');
      await page.render({ viewport, canvas: canvas as any, canvasContext: context as any }).promise;
      expect(context.getImageData(100, 50, 1, 1).data[0]).toBeGreaterThan(220);
      expect(context.getImageData(100, 350, 1, 1).data[2]).toBeGreaterThan(220);
    } finally { await pdf.destroy(); }
  });
});
