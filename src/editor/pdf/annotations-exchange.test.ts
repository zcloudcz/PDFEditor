// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyAnnotationChanges, exportAnnotationsXfdf, importAnnotationsXfdf, readAnnotations } from './annotations';
import type { AnnotationKind } from './annotation-types';

async function fixture() { const doc = await PDFDocument.create(); doc.addPage([400, 500]); return doc.save(); }
const kinds: AnnotationKind[] = ['Highlight', 'Underline', 'StrikeOut', 'Text', 'Ink', 'Stamp'];

describe('XFDF annotation exchange', () => {
  it('roundtrips all six annotation kinds, reply and resolve state with readable appearances', async () => {
    const font = await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) })));
    try {
    const original = await fixture(), copy = original.slice();
    const changes = kinds.map((subtype, index) => ({ kind: 'add' as const, annotation: {
      pageIndex: 0, subtype, rect: [20, 400 - index * 50, 120, 25] as [number, number, number, number],
      contents: subtype === 'Stamp' ? 'Schváleno – razítko' : `Český komentář ${index}`,
      quadPoints: ['Highlight', 'Underline', 'StrikeOut'].includes(subtype) ? [20, 425 - index * 50, 140, 425 - index * 50, 20, 400 - index * 50, 140, 400 - index * 50] : undefined,
      inkPaths: subtype === 'Ink' ? [[20, 200, 80, 220, 140, 200]] : undefined,
    } }));
    let source = await applyAnnotationChanges(original, changes);
    const note = (await readAnnotations(source)).find(annotation => annotation.subtype === 'Text')!;
    source = await applyAnnotationChanges(source, [
      { kind: 'resolve', id: note.id, resolved: true },
      { kind: 'add', annotation: { pageIndex: 0, subtype: 'Text', rect: [20, 60, 120, 25], contents: 'Odpověď', replyTo: note.id } },
    ]);
    const saved = await readAnnotations(source);
    const xfdf = exportAnnotationsXfdf(saved);
    const imported = await applyAnnotationChanges(original, importAnnotationsXfdf(xfdf));
    const result = await readAnnotations(imported);
    expect(result.map(annotation => annotation.subtype)).toEqual(saved.map(annotation => annotation.subtype));
    expect(result.map(annotation => annotation.contents)).toEqual(saved.map(annotation => annotation.contents));
    expect(result.find(annotation => annotation.contents === 'Český komentář 3')?.resolved).toBe(true);
    expect(result.find(annotation => annotation.contents === 'Odpověď')?.replyTo).toBe(result.find(annotation => annotation.contents === 'Český komentář 3')?.id);
    const reader = await getDocument({ data: imported.slice() }).promise;
    try { const annotations = await (await reader.getPage(1)).getAnnotations(); expect(annotations).toHaveLength(7); expect(annotations.every(annotation => annotation.hasAppearance)).toBe(true); }
    finally { await reader.destroy(); }
    expect(original).toEqual(copy);
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects malformed, oversized, out-of-bounds, cyclic and cancelled imports atomically', async () => {
    const original = await fixture(), copy = original.slice();
    expect(() => importAnnotationsXfdf('<!DOCTYPE xfdf><xfdf/>')).toThrow();
    expect(() => importAnnotationsXfdf('x'.repeat(2 * 1024 * 1024 + 1))).toThrow();
    expect(() => importAnnotationsXfdf('<xfdf><annots><text page="0" rect="1,2"/></annots></xfdf>')).toThrow();
    expect(() => importAnnotationsXfdf('<xfdf><annots><text name="a" inreplyto="b" page="0" rect="1,2,20,30"/><text name="b" inreplyto="a" page="0" rect="1,2,20,30"/></annots></xfdf>')).toThrow();
    const outOfBounds = importAnnotationsXfdf('<xfdf><annots><text page="0" rect="390,10,420,30"><contents>X</contents></text></annots></xfdf>');
    await expect(applyAnnotationChanges(original, outOfBounds)).rejects.toMatchObject({ code: 'invalid-change' });
    const abort = new AbortController(); abort.abort();
    await expect(applyAnnotationChanges(original, [{ kind: 'add', annotation: { pageIndex: 0, subtype: 'Text', rect: [20, 20, 20, 20], contents: 'X' } }], abort.signal)).rejects.toThrow();
    expect(original).toEqual(copy);
  });
});
