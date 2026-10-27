import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FONT_FILES, loadedFont, prepareFont } from './fonts';
import { shapeText } from './shape';
import { layoutText, prepareTextFonts } from '../studio/text-layout';
import { parsePortableProject, serializePortableProject } from '../studio/project-io';
import { exportPdf } from '../studio/exports';
import type { StudioObject, StudioProject } from '../studio/types';

const requests: string[] = [];
vi.spyOn(globalThis, 'fetch').mockImplementation(async input => { requests.push(String(input)); return new Response(await readFile(`public${String(input)}`)); });
afterAll(() => vi.restoreAllMocks());
const object = (extra: Partial<StudioObject> = {}): StudioObject => ({ id: 't', name: 'Text', kind: 'text', text: 'A', fontSize: 20, x: 0, y: 0, width: 250, height: 80, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false, ...extra });
const project = (o: StudioObject): StudioProject => ({ version: 1, name: 'Fixture', pages: [{ id: 'p', name: 'Page', width: 300, height: 200, background: '#ffffff', objects: [o] }] });

describe('bounded local font registry', () => {
  it('applies tracking between glyphs, including style boundaries, never after the final glyph', async () => {
    await prepareTextFonts();
    const normal = shapeText('AV', 'Liberation Sans', 20);
    const tracked = shapeText('AV', 'Liberation Sans', 20, { tracking: 2 });
    expect(tracked.width - normal.width).toBeCloseTo(2);
    expect(tracked.segments[0].glyphs[1].x - normal.segments[0].glyphs[1].x).toBeCloseTo(2);
    const mixed = object({ text: 'AB', tracking: 2, textRuns: [{ text: 'A', color: '#ff0000' }, { text: 'B', color: '#0000ff' }] });
    const output = layoutText(mixed);
    expect(output.lines[0].runs[1].x).toBeCloseTo(output.lines[0].runs[0].width + 2);
  });
  it('loads only requested faces, never downloads CJK for the default editor', async () => {
    await prepareTextFonts();
    expect(requests).toHaveLength(4);
    expect(requests.every(url => url.includes('LiberationSans-'))).toBe(true);
    expect(loadedFont('Noto Sans CJK JP')).toBeUndefined();
    await prepareFont('Noto Sans Arabic');
    const count = requests.length;
    await Promise.all([prepareFont('Noto Sans Arabic'), prepareFont('Noto Sans Arabic')]);
    expect(requests).toHaveLength(count);
  });
  it('rejects arbitrary network and filesystem font references before a fetch', async () => {
    const count = requests.length;
    await expect(prepareFont('https://example.com/font.ttf')).rejects.toThrow();
    await expect(prepareFont('../font.ttf')).rejects.toThrow();
    expect(requests).toHaveLength(count);
  });
  it('matches every bundled Noto file to the pinned source hash', async () => {
    const manifest = JSON.parse(await readFile('docs/legal/fonts/noto-manifest.json', 'utf8')) as { file: string; sha256: string; bytes: number }[];
    for (const entry of manifest) {
      const bytes = await readFile(`public/fonts/noto/${entry.file}`);
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(Object.values(FONT_FILES)).toContain(`/fonts/noto/${entry.file}`);
    }
  });
  it('positions Arabic decimal islands in logical numeric order using Unicode bidi', async () => {
    const result = shapeText('مرحبا 123', 'Noto Sans Arabic', 20);
    expect(result.segments[0].glyphs.flatMap(item => item.glyph.codePoints)).toEqual([49, 50, 51]);
    expect(result.segments.at(-1)!.glyphs.map(item => item.glyph.id)).not.toEqual(loadedFont('Noto Sans Arabic')!.glyphsForString(' مرحبا').map(glyph => glyph.id));
  });
  it('loads the actual Devanagari shaping runtime for semantic export', async () => {
    await prepareFont('Noto Sans Devanagari');
    const shaped = shapeText('क्षि', 'Noto Sans Devanagari', 20);
    expect(shaped.segments[0].glyphs.map(item => item.glyph.id)).toEqual([610, 179]);
    await expect(exportPdf(project(object({ text: 'क्षि', fontFamily: 'Noto Sans Devanagari' })))).resolves.toBeInstanceOf(Uint8Array);
  });
  it('wraps by grapheme without detaching combining marks from Czech letters', () => {
    const result = layoutText(object({ text: 'a\u0301b', width: 1, wrapText: true }), text => [...text].length);
    expect(result.lines.map(line => line.runs.map(run => run.text).join(''))).toEqual(['a\u0301', 'b']);
  });
  it('roundtrips font, direction and language through the real portable v2 boundary', async () => {
    const input = project(object({ text: 'مرحبا', fontFamily: 'Noto Sans Arabic', textDirection: 'rtl', textLanguage: 'ar' }));
    const saved = await serializePortableProject(input);
    expect(JSON.parse(saved).version).toBe(2);
    expect(await parsePortableProject(saved)).toEqual(input);
  });
  it.each([
    { textDirection: 'sideways' }, { textLanguage: 'x-invalid' },
  ])('rejects unknown text metadata %j at the portable boundary', async extra => {
    await expect(serializePortableProject(project(object(extra as Partial<StudioObject>)))).rejects.toThrow();
  });
  it.each([
    { text: '漢字', fontFamily: 'Noto Sans CJK JP', textRuns: [{ text: '漢字', bold: true }] },
    { text: 'مرحبا', fontFamily: 'Noto Sans Arabic', textRuns: [{ text: 'مرحبا', italic: true }] },
    { text: 'Latin', textDirection: 'rtl' },
    { text: 'نَمَسْتِ', fontFamily: 'Noto Sans Arabic' },
    { text: 'नमस्ते', fontFamily: 'Noto Sans Devanagari', tracking: 0.5 },
    { text: 'नमस्ते 😀', fontFamily: 'Noto Sans Devanagari' },
    { text: 'A\u202eB' }, { text: 'A\u2000B' },
  ])('rejects unsupported profile %j without substitution', async extra => {
    await expect(exportPdf(project(object(extra as Partial<StudioObject>)))).rejects.toThrow();
  });
  it('uses explicit paragraph direction to move leading digit islands, not merely persist metadata', async () => {
    const rtl = shapeText('123 مرحبا', 'Noto Sans Arabic', 20, { textDirection: 'rtl', textLanguage: 'ar' });
    const ltr = shapeText('123 مرحبا', 'Noto Sans Arabic', 20, { textDirection: 'ltr', textLanguage: 'ar' });
    expect(ltr.segments[0].text).toBe('123 ');
    expect(rtl.segments.at(-1)!.text).toBe('123');
  });
  it.each(['auto', 'ltr', 'rtl'] as const)('rejects mixed Latin/Arabic with neutral punctuation in %s until fallback glyph runs exist', async textDirection => {
    await expect(exportPdf(project(object({ text: 'A (مرحبا) 123', fontFamily: 'Noto Sans Arabic', textDirection })))).rejects.toThrow();
  });
});

