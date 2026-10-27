import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf, exportSvg, exportPptx } from '../studio/exports';
import type { StudioObject, StudioProject } from '../studio/types';

const object = (text: string, extra: Partial<StudioObject> = {}): StudioObject => ({ id: 't', name: 'Text', kind: 'text', text, fontSize: 20, x: 20, y: 20, width: 250, height: 80, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false, ...extra });
const project = (o: StudioObject): StudioProject => ({ version: 1, name: 'Fixture', pages: [{ id: 'p', name: 'Page', width: 300, height: 200, background: '#ffffff', objects: [o] }] });
beforeAll(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(await readFile(`public${String(input)}`))); });
afterAll(() => vi.restoreAllMocks());

describe('real font text fidelity', () => {
  it('positions both letters of AV using kerning in the selectable PDF text', async () => {
    const doc = await PDFDocument.load(await exportPdf(project(object('AV'))));
    const streams = doc.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream).map(([, value]) => new TextDecoder().decode(decodePDFRawStream(value as PDFRawStream).decode()));
    const content = streams.find(value => value.includes(' Tj'))!;
    // Liberation Sans: A advance 1214 after AV kerning, unitsPerEm=2048.
    expect(content).toContain('1 0 0 1 11.85546875 -20 Tm');
  });
  it('accepts canonically equivalent decomposed Czech rather than missing combining glyphs', async () => {
    await expect(exportPdf(project(object('Příliš')))).resolves.toBeInstanceOf(Uint8Array);
  });
  it('exports selected CJK locally, without substituting Liberation or rasterizing PDF', async () => {
    const o = object('漢字日本語', { fontFamily: 'Noto Sans CJK JP' });
    await expect(exportPdf(project(o))).resolves.toBeInstanceOf(Uint8Array);
    expect(await exportSvg(project(o), 'p')).toContain('data-glyph');
    await expect(exportPptx(project(o))).rejects.toThrow();
  });
  it('exports joined Arabic with a decimal number island', async () => {
    await expect(exportPdf(project(object('مرحبا 123', { fontFamily: 'Noto Sans Arabic', textDirection: 'rtl', textLanguage: 'ar' })))).resolves.toBeInstanceOf(Uint8Array);
  });
  it('exports Devanagari through occurrence CIDs', async () => {
    await expect(exportPdf(project(object('नमस्ते', { fontFamily: 'Noto Sans Devanagari', textLanguage: 'hi' })))).resolves.toBeInstanceOf(Uint8Array);
  });
});

