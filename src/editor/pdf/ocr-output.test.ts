// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { degrees, PDFDocument, PDFName, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { appendOcrTextLayer } from './ocr-service';
import { inspect, unchangedPixelsEqual } from '../../tests/helpers/editor-pdf-inspect';
import type { OcrPage } from '../../js/types/ocr-pdf-type';
import { scanGeometry, DEFAULT_SCAN_PREPARATION } from './scan-processing';

describe('independent OCR PDF output verification', () => {
  it.each([0, 90, 180, 270] as const)('inverts OCR preprocessing %i degrees plus deskew without changing background pixels', async orientation => {
    const initial=await PDFDocument.create();initial.addPage([300,400]).drawText('Source remains',{x:30,y:350});const before=await initial.save();const doc=await PDFDocument.load(before);
    const source=await getDocument({data:before.slice()}).promise,sourcePage=await source.getPage(1),viewport=sourcePage.getViewport({scale:3});
    const g=scanGeometry(900,1200,{...DEFAULT_SCAN_PREPARATION,orientation,deskew:3});
    const blocks:OcrPage={width:g.width,height:g.height,dpi:216,lines:[{bbox:{x0:100,y0:100,x1:300,y1:140},baseline:{slope:0,intercept:0},textangle:0,direction:'ltr',injectWordBreaks:true,words:[{text:'Recognized',confidence:90,bbox:{x0:100,y0:100,x1:300,y1:140}}]}]};
    doc.registerFontkit(fontkit);const font=await doc.embedFont(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'),{subset:true});
    appendOcrTextLayer(doc.getPage(0),blocks,font,{width:g.width,height:g.height,convertToPdfPoint(x,y){const p=g.toOriginal(x,y);return viewport.convertToPdfPoint(...p);}});
    const output=await doc.save(),a=await inspect(before,true),b=await inspect(output,true);expect(unchangedPixelsEqual(a.pixels,b.pixels)).toBe(true);
    const parsed=await getDocument({data:output.slice()}).promise,page=await parsed.getPage(1),content=await page.getTextContent();const item=content.items.find(item=>'str'in item&&item.str==='Recognized');expect(content.items.filter(i=>'str'in i).map(i=>'str'in i?i.str:'').join('|')).toContain('Recognized'); expect(item&&'transform'in item).toBe(true);
    if(item&&'transform'in item){const point=page.getViewport({scale:3}).convertToViewportPoint(item.transform[4],item.transform[5]),expected=g.toOriginal(100,140);expect(point[0]).toBeCloseTo(expected[0],2);expect(point[1]).toBeCloseTo(expected[1],2);}
    await parsed.destroy();await source.destroy();
  });
  it.each([0, 90, 180, 270])('preserves every background pixel, structure and selectable Czech text at rotation %i and CropBox offset', async rotation => {
    const doc = await PDFDocument.create(), page = doc.addPage([400, 500]);
    page.setCropBox(20, 30, 320, 420); page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 20, y: 30, width: 320, height: 420, color: rgb(0.85, 0.9, 1) });
    page.drawText('Original vector text', { x: 50, y: 350 });
    const second = doc.addPage([200, 300]); second.drawText('Untouched page');
    doc.getForm().createCheckBox('preserved').addToPage(page, { x: 70, y: 100, width: 20, height: 20 });
    await doc.attach(new Uint8Array([1, 2, 3]), 'kept.bin');
    const before = await doc.save();
    const source = await getDocument({ data: before.slice() }).promise;
    const viewport = (await source.getPage(1)).getViewport({ scale: 3 });
    const blocks: OcrPage = { width: viewport.width, height: viewport.height, dpi: 216, lines: [{ bbox: { x0: 90, y0: 100, x1: 330, y1: 140 }, baseline: { slope: 0, intercept: 0 }, textangle: 0, direction: 'ltr', injectWordBreaks: true, words: [{ text: 'Příliš', confidence: 97, bbox: { x0: 90, y0: 100, x1: 210, y1: 140 } }, { text: 'žluťoučký', confidence: 95, bbox: { x0: 225, y0: 100, x1: 390, y1: 140 } }] }] };
    const edited = await PDFDocument.load(before);
    edited.registerFontkit(fontkit); const font = await edited.embedFont(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'), { subset: true });
    appendOcrTextLayer(edited.getPage(0), blocks, font, viewport); await source.destroy();
    const output = await edited.save({ updateFieldAppearances: false });
    const a = await inspect(before, true), b = await inspect(output, true);
    expect(unchangedPixelsEqual(a.pixels, b.pixels)).toBe(true);
    expect(b.text).toContain('Příliš'); expect(b.text).toContain('žluťoučký'); expect(b.text).toContain('Original vector text');
    expect(b.fields).toHaveProperty('preserved'); expect(b.attachments).toHaveProperty('kept.bin');
    expect((await inspect(output, true, 2)).text).toBe('Untouched page');
    const parsed = await getDocument({ data: output.slice() }).promise;
    const textPage = await parsed.getPage(1), content = await textPage.getTextContent(), recognized = content.items.find(item => 'str' in item && item.str === 'Příliš');
    expect(recognized && 'transform' in recognized).toBe(true);
    if (recognized && 'transform' in recognized) {
      const topLeft = textPage.getViewport({ scale: 3 }).convertToViewportPoint(recognized.transform[4], recognized.transform[5]);
      expect(topLeft[0]).toBeCloseTo(90, 2); expect(topLeft[1]).toBeCloseTo(140, 2);
    }
    await parsed.destroy(); expect((await PDFDocument.load(output)).getPage(0).node.has(PDFName.of('CropBox'))).toBe(true);
  });
});
