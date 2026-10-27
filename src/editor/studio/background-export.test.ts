import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPdf, exportSvg } from './exports';
import { editedImageDataUrl } from './image-effects';
import { createTemplate } from './templates';
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

describe('cutout export', () => {
  it('shares the same alpha pixels with SVG/PDF render and leaves source immutable', async () => {
    const source = createCanvas(20, 20), sourceContext = source.getContext('2d');
    sourceContext.fillStyle = '#ffffff'; sourceContext.fillRect(0, 0, 20, 20);
    sourceContext.fillStyle = '#cc0000'; sourceContext.fillRect(5, 5, 10, 10);
    installRealCanvas();
    const project = createTemplate('social'); project.pages[0].width = 20; project.pages[0].height = 20;
    project.pages[0].objects = [{ id: 'cutout', kind: 'image', name: 'Cutout', x: 0, y: 0, width: 20, height: 20,
      rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false,
      src: `data:image/png;base64,${source.toBuffer('image/png').toString('base64')}`,
      imageCutout: { version: 1, seed: { x: 0, y: 0, tolerance: .02 }, strokes: [] } }];
    const object = project.pages[0].objects[0], original = object.src;
    const preview = await editedImageDataUrl(object);
    const svg = await exportSvg(project, project.pages[0].id);
    const exported = /href="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(svg)?.[1];
    expect(exported).toBe(preview);
    const image = await loadImage(Buffer.from(preview.split(',')[1], 'base64'));
    const inspected = createCanvas(40, 40); inspected.getContext('2d').drawImage(image, 0, 0);
    const pixels = inspected.getContext('2d');
    expect(pixels.getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect(pixels.getImageData(20, 20, 1, 1).data[3]).toBe(255);
    const pdf = await getDocument({ data: (await exportPdf(project)).slice(), useSystemFonts: false }).promise;
    try {
      const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1 });
      const rendered = createCanvas(20, 20), context = rendered.getContext('2d');
      await page.render({ viewport, canvas: rendered as any, canvasContext: context as any }).promise;
      expect(context.getImageData(10, 10, 1, 1).data[0]).toBeGreaterThan(150);
      expect(context.getImageData(10, 10, 1, 1).data[1]).toBeLessThan(100);
    } finally { await pdf.destroy(); }
    expect(object.src).toBe(original);
  });
});
