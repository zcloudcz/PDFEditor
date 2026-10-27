// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { inspect, unchangedPixelsEqual } from './helpers/editor-pdf-inspect';
import { PDFDocument, rgb } from 'pdf-lib';
import { createEngine, modelOf, paragraphText, runsFrom } from './helpers/editcore-harness';
import { buildEditorCorpus, UNCHANGED } from './helpers/editor-corpus';
import { PdfEngine } from '../js/editcore/core.js';

const cases = await buildEditorCorpus();
const evidence = resolve('.superpowers/sdd/2026-10-25-online-pdf-editor/corpus');
const results = [];

describe('P01 native edit corpus, independently read by PDF.js', () => {
  let engine;
  beforeAll(async () => {
    mkdirSync(evidence, { recursive: true });
    PdfEngine.fallbackFonts.set('Liberation Sans', new Uint8Array(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf')));
    engine = await createEngine();
    writeFileSync(resolve(evidence, 'manifest.json'), JSON.stringify(cases.map(c => ({ id: c.id, sha256: createHash('sha256').update(c.bytes).digest('hex'), bytes: c.bytes.length, origin: 'Synthetic fixture: src/tests/helpers/editor-corpus.js', license: 'AGPL-3.0-only; embedded Liberation font SIL OFL-1.1' })), null, 2));
  });
  afterAll(() => {
    engine?.close();
    PdfEngine.fallbackFonts.clear();
    writeFileSync(resolve(evidence, 'results.json'), JSON.stringify(results, null, 2));
  });
  for (const entry of cases) {
    it(`${entry.id}: preserves content through native edit and export`, async () => {
      const start = performance.now();
      const row = { id: entry.id, status: 'failed' };
      results.push(row);
      writeFileSync(resolve(evidence, `${entry.id}-before.pdf`), entry.bytes);
      const before = await inspect(entry.bytes, true, 1, entry.editBounds);
      const model = modelOf(engine, entry.bytes);
      if (entry.spec.scan && !entry.spec.textLayer) {
        expect(model).toHaveLength(0);
        expect(before.text.trim()).toBe('');
        row.status = 'passed-image-only-detected';
        row.ms = Math.round(performance.now() - start);
        return;
      }
      const target = model.find(p => paragraphText(p).includes(entry.original));
      expect(target, 'Original text must be located').toBeDefined();
      expect(target.editable, 'Target should be explicitly editable').toBe(true);
      const committed = engine.commitParagraph(target.id, runsFrom(target, entry.replacement), target.format);
      expect(committed, 'Native edit must return a result').toBeTruthy();
      const saved = await engine.saveSpliced();
      expect(saved?.length).toBeGreaterThan(0);
      writeFileSync(resolve(evidence, `${entry.id}-after.pdf`), saved);
      const after = await inspect(saved, true);
      expect(after.text).toContain(entry.replacement);
      expect(after.text).not.toContain(entry.original);
      expect(after.text).toContain(UNCHANGED);
      expect(after.pages).toBe(before.pages);
      expect(after.fields).toEqual(before.fields);
      expect(after.annotations).toEqual(before.annotations);
      if (entry.spec.metadata) {
        expect(after.metadata.info.Title).toBe('Keep title');
        expect(after.metadata.info.Author).toBe('Synthetic author');
      }
      if (entry.spec.attachment) expect(after.attachments).toEqual(before.attachments);
      expect(unchangedPixelsEqual(before.pixels, after.pixels), 'Every pixel outside the edit area must remain identical').toBe(true);
      if (entry.spec.columns) expect(after.text).toContain('Right column must survive.');
      for (let pageNumber = 2; pageNumber <= before.pages; pageNumber++) {
        const originalPage = await inspect(entry.bytes, true, pageNumber);
        const exportedPage = await inspect(saved, true, pageNumber);
        expect(exportedPage.text, `Text on untouched page ${pageNumber}`).toBe(originalPage.text);
        expect(exportedPage.annotations).toEqual(originalPage.annotations);
        expect(unchangedPixelsEqual(originalPage.pixels, exportedPage.pixels), `Untouched page ${pageNumber} must remain pixel-identical`).toBe(true);
      }
      if (entry.id === 'czech-full' || entry.id === 'colored-background') {
        writeFileSync(resolve(evidence, `${entry.id}-before.png`), before.pixels.png);
        writeFileSync(resolve(evidence, `${entry.id}-after.png`), after.pixels.png);
      }
      row.status = 'passed'; row.ms = Math.round(performance.now() - start);
    }, 60000);
  }
});

// Control experiment: the same renderer and mask used above must catch damage.
describe('P01 pixel comparison negative controls', () => {
  it.each(['Helvetica-0', 'Helvetica-90', 'cropbox-offset'])('%s catches an alteration outside the transformed edit mask', async (id) => {
    const entry = cases.find(c => c.id === id);
    const before = await inspect(entry.bytes, true, 1, entry.editBounds);
    const altered = await PDFDocument.load(entry.bytes);
    altered.getPage(0).drawRectangle({ x: 80, y: 440, width: 40, height: 20, color: rgb(1, 0, 0) });
    const after = await inspect(await altered.save(), true);
    expect(unchangedPixelsEqual(before.pixels, before.pixels)).toBe(true);
    expect(unchangedPixelsEqual(before.pixels, after.pixels)).toBe(false);
  });
});
