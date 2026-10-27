import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export async function inspect(bytes, render = false, pageNumber = 1, editBounds) {
  const doc = await getDocument({
    data: bytes.slice(), useSystemFonts: false,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
    cMapUrl: `${resolve('node_modules/pdfjs-dist/cmaps')}/`, cMapPacked: true,
  }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const text = (await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
    const annotations = await page.getAnnotations();
    let pixels;
    if (render) {
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ viewport, canvas, canvasContext: context }).promise;
      pixels = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data, png: canvas.toBuffer('image/png'), editRect: editBounds && viewport.convertToViewportRectangle(editBounds) };
    }
    return { text, annotations, pages: doc.numPages, fields: await doc.getFieldObjects(), metadata: await doc.getMetadata(), attachments: await doc.getAttachments(), pixels };
  } finally { await doc.destroy(); }
}

export function unchangedPixelsEqual(before, after) {
  if (before.width !== after.width || before.height !== after.height) return false;
  const rect = before.editRect;
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      if (rect && x >= Math.floor(Math.min(rect[0], rect[2])) && x <= Math.ceil(Math.max(rect[0], rect[2])) && y >= Math.floor(Math.min(rect[1], rect[3])) && y <= Math.ceil(Math.max(rect[1], rect[3]))) continue;
      const offset = (y * before.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        if (before.data[offset + channel] !== after.data[offset + channel]) return false;
      }
    }
  }
  return true;
}

