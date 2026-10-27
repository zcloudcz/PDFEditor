// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage, DOMMatrix } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inspect } from '../../tests/helpers/editor-pdf-inspect';
import { exportPdf, exportSvg } from '../studio/exports';
import { createEngineModule } from '../../js/editcore/engine-loader.js';
import type { StudioObject, StudioProject } from '../studio/types';
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { resolve } = await import('node:path'), { pathToFileURL } = await import('node:url');
  return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});
beforeAll(() => { vi.stubGlobal('DOMMatrix', DOMMatrix); vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(await readFile(`public${String(input)}`))); });
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const fixture = (text: string, fontFamily = 'Liberation Sans'): StudioProject => ({ version: 1, name: 'Fixture', pages: [{ id: 'p', name: 'Page', width: 300, height: 200, background: '#ffffff', objects: [{ id: 't', name: 'Text', kind: 'text', text, fontFamily, fontSize: 24, x: 20, y: 30, width: 250, height: 80, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false } as StudioObject] }] });

describe('independent PDF.js Unicode and vector rendering', () => {
  it('refuses shadow-only PDF text instead of silently dropping the visible SVG shadow', async () => {
    const project = fixture('Shadow');
    Object.assign(project.pages[0].objects[0], { fill: 'none', textShadow: { x: 3, y: 4, color: '#ff0000', opacity: 1 } });
    expect(await exportSvg(project, 'p')).toContain('#ff0000');
    await expect(exportPdf(project)).rejects.toThrow('profil');
  });
  it.each([
    ['नमस्ते दुनिया क्षि', 'Noto Sans Devanagari'],
    ['हिन्दी भाषा शक्ति विद्यार्थी', 'Noto Sans Devanagari Bold'],
    ['कर्म धर्म अर्थ प्रार्थना श्रद्धा दृष्टि', 'Noto Sans Devanagari'],
    ['अ आ इ ई उ ऊ ऋ ए ऐ ओ औ क ख ग घ च छ ज झ ट ठ ड ढ त थ द ध न प फ ब भ म य र ल व श ष स ह १२३ 2026', 'Noto Sans Devanagari'],
  ])('retains exact Unicode in independent native PDFium: %s', async (text, family) => {
    const bytes = await exportPdf(fixture(text, family));
    const native = await createEngineModule(); native._PDFiumExt_Init();
    const ptr = native._malloc(bytes.length); native.HEAPU8.set(bytes, ptr);
    const doc = native._FPDF_LoadMemDocument64(ptr, bytes.length, 0);
    const page = native._FPDF_LoadPage(doc, 0), textPage = native._FPDFText_LoadPage(page);
    const count = native._FPDFText_CountChars(textPage), buffer = native._malloc((count + 1) * 2);
    try {
      native._FPDFText_GetText(textPage, 0, count, buffer);
      expect(new TextDecoder('utf-16le').decode(native.HEAPU8.slice(buffer, buffer + count * 2))).toBe(text.normalize('NFC'));
    } finally {
      native._free(buffer); native._FPDFText_ClosePage(textPage); native._FPDF_ClosePage(page); native._FPDF_CloseDocument(doc); native._free(ptr);
    }
  });
  it.each([
    { stroke: '#0000ff', strokeWidth: 0.6 },
    { textShadow: { x: 3, y: 4, color: '#ff0000', opacity: 0.5 } },
    { textGradient: { from: '#ff0000', to: '#0000ff' } },
    { textGradient: { from: '#ff0000', to: '#0000ff' }, stroke: '#00ff00', strokeWidth: 1, opacity: 0.5, textShadow: { x: 3, y: 3, color: '#000000', opacity: 0.4 } },
  ])('exports text effects as matching vectors without duplicating selectable text: %j', async effect => {
    const project = fixture('AV Příliš'); Object.assign(project.pages[0].objects[0], effect);
    const output = await inspect(await exportPdf(project), true);
    expect(output.text.replace(/\s+/g, ' ').trim()).toBe('AV Příliš');
    const image = await loadImage(Buffer.from(await exportSvg(project, 'p')));
    const canvas = createCanvas(300, 200), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, 300, 200).data;
    let error = 0;
    for (let i = 0; i < pixels.length; i += 4) error += Math.abs(pixels[i] - output.pixels!.data[i]);
    expect(error / (300 * 200)).toBeLessThan(2);
  });
  it('keeps curved text as explicit SVG vector artwork and refuses inaccurate selectable PDF', async () => {
    const project = fixture('AV Příliš'); project.pages[0].objects[0].textPath = { radius: 500 };
    const svg = await exportSvg(project, 'p');
    expect(svg).toContain('data-glyph'); expect(svg).toContain('rotate(-');
    expect(svg).not.toContain('<image');
    const image = await loadImage(Buffer.from(svg)); expect(image.width).toBe(300);
    await expect(exportPdf(project)).rejects.toThrow('profil');
  });
  it('keeps tracked rich text and paragraph spacing selectable and vector-matched', async () => {
    const project = fixture('AV Příliš\nDruhý');
    Object.assign(project.pages[0].objects[0], { tracking: 0.5, paragraphSpacing: 8,
      textRuns: [{ text: 'AV ', color: '#ff0000' }, { text: 'Příliš\nDruhý' }] });
    const output = await inspect(await exportPdf(project), true);
    expect(output.text.replace(/\s+/g, ' ').trim()).toBe('AV Příliš Druhý');
    const image = await loadImage(Buffer.from(await exportSvg(project, 'p')));
    const canvas = createCanvas(300, 200), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, 300, 200).data;
    let error = 0;
    for (let i = 0; i < pixels.length; i += 4) error += Math.abs(pixels[i] - output.pixels!.data[i]);
    expect(error / (300 * 200)).toBeLessThan(2);
  });
  it.each([
    ['AV Příliš', 'Liberation Sans'],
    ['Příliš', 'Liberation Sans'],
    ['漢字日本語', 'Noto Sans CJK JP'],
    ['مرحبا 123', 'Noto Sans Arabic'],
    ['مرحبا ١٢٣', 'Noto Sans Arabic'],
    ['السلام عليكم 2026', 'Noto Sans Arabic'],
    ['لا 123', 'Noto Sans Arabic Bold'],
    ['नमस्ते दुनिया क्षि', 'Noto Sans Devanagari'],
    ['हिन्दी भाषा शक्ति विद्यार्थी', 'Noto Sans Devanagari Bold'],
    ['कर्म धर्म अर्थ प्रार्थना श्रद्धा दृष्टि', 'Noto Sans Devanagari'],
  ])('retains Unicode %s (%s)', async (text, family) => {
    const bytes = await exportPdf(fixture(text, family));
    const output = await inspect(bytes, true);
    const document = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
    const content = await (await document.getPage(1)).getTextContent();
    const extracted = content.items.filter(item => 'str' in item).map(item => (item as { str: string }).str).join('');
    await document.destroy();
    expect(extracted.trim()).toBe(text.normalize('NFC'));
    expect(output.pixels!.data.some((value: number, index: number) => index % 4 !== 3 && value < 100)).toBe(true);
  });
  it.each([['AVATAR Příliš', 'Liberation Sans'], ['مرحبا 123', 'Noto Sans Arabic'], ['漢字日本語', 'Noto Sans CJK JP'], ['नमस्ते दुनिया क्षि', 'Noto Sans Devanagari'], ['हिन्दी भाषा शक्ति विद्यार्थी', 'Noto Sans Devanagari Bold']])('matches vector SVG and PDF glyph positions for %s at independent renderers', async (text, family) => {
    const project = fixture(text, family);
    const output = await inspect(await exportPdf(project), true);
    const image = await loadImage(Buffer.from(await exportSvg(project, 'p')));
    const canvas = createCanvas(300, 200), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, 300, 200).data;
    let error = 0;
    for (let i = 0; i < pixels.length; i += 4) error += Math.abs(pixels[i] - output.pixels!.data[i]);
    expect(error / (300 * 200)).toBeLessThan(2);
  });
  it.each([['نَمَسْتِ ١٢٣', 'Noto Sans Arabic']])('refuses known Unicode failures instead of shipping incorrect selectable text: %s', async (text, family) => {
    await expect(exportPdf(fixture(text, family))).rejects.toThrow('profil');
    const svg = await exportSvg(fixture(text, family), 'p');
    expect(svg).toContain('data-glyph'); expect(svg).not.toContain('<image');
    const image = await loadImage(Buffer.from(svg));
    const canvas = createCanvas(300, 200), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    expect(ctx.getImageData(0, 0, 300, 200).data.some((value, index) => index % 4 !== 3 && value < 100)).toBe(true);
  });
  it.each(['auto', 'rtl'] as const)('independently extracts Arabic with leading digits in %s', async textDirection => {
    const project = fixture('123 مرحبا', 'Noto Sans Arabic');
    project.pages[0].objects[0].textDirection = textDirection;
    project.pages[0].objects[0].textLanguage = 'ar';
    const output = await inspect(await exportPdf(project), true);
    expect(output.text).toBe('123 مرحبا');
  });
  it('refuses explicit LTR Arabic export where PDF.js loses paragraph direction', async () => {
    const project = fixture('123 مرحبا', 'Noto Sans Arabic');
    project.pages[0].objects[0].textDirection = 'ltr';
    await expect(exportPdf(project)).rejects.toThrow('profil');
  });
});

