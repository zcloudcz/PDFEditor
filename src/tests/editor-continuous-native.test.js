// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { createEngine, modelOf, paragraphText, runsFrom } from './helpers/editcore-harness';
import { renderPreview, withPreviewPage } from '../js/editcore/continuous-pages';
import { inspect } from './helpers/editor-pdf-inspect';

let engine, bytes;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([300, 400]);
  first.drawText('Original text', { x: 20, y: 300, size: 12 });
  doc.getForm().createTextField('retained').addToPage(first, { x: 20, y: 100, width: 100, height: 20 });
  doc.getForm().getTextField('retained').setText('Keep field');
  doc.addPage([300, 400]).setRotation(degrees(90));
  bytes = await doc.save();
  engine = await createEngine();
});
afterAll(() => engine?.close());

describe('native continuous previews and append snapshots', () => {
  it('previews another rotated page without switching page, losing edits or altering history', () => {
    const model = modelOf(engine, bytes);
    const target = model.find(p => paragraphText(p) === 'Original text');
    engine.historyBeginStep('edit');
    expect(engine.commitParagraph(target.id, runsFrom(target, 'Updated text'), target.format)).toBeTruthy();
    engine.historyEndStep();
    const page = engine.page;
    const history = engine.historyDepth();
    const dims = withPreviewPage(engine, 1, (_, w, h) => [w, h]);
    expect(dims).toEqual([400, 300]);
    const preview = renderPreview(engine, 1, 1);
    expect([preview.width, preview.height]).toEqual([400, 300]);
    expect(engine.page).toBe(page);
    expect(engine.pageIndex).toBe(0);
    expect(engine.historyDepth()).toEqual(history);
    expect(engine.buildModel().map(paragraphText).join(' ')).toContain('Updated text');
    expect(engine.historyUndo()).toBeTruthy();
    expect(engine.buildModel().map(paragraphText).join(' ')).toContain('Original text');
  });
  it('appends custom dimensions and snapshot undo/redo preserves edited text and fields', async () => {
    const model = modelOf(engine, bytes);
    const target = model.find(p => paragraphText(p) === 'Original text');
    engine.commitParagraph(target.id, runsFrom(target, 'Updated text'), target.format);
    const before = await engine.saveSpliced();
    expect(engine.appendBlankPage(500, 250)).toBe(2);
    expect(engine.pageCount).toBe(3);
    const after = await engine.saveSpliced();
    const originalInfo = await inspect(before);
    const appendedInfo = await inspect(after);
    expect(appendedInfo.text).toContain('Updated text');
    expect(appendedInfo.fields).toEqual(originalInfo.fields);
    expect(appendedInfo.annotations).toEqual(originalInfo.annotations);
    engine.reopen(before, 0);
    expect(engine.pageCount).toBe(2);
    expect(engine.buildModel().map(paragraphText).join(' ')).toContain('Updated text');
    engine.reopen(after, 2);
    expect(engine.pageCount).toBe(3);
    expect([engine.pageWidth, engine.pageHeight]).toEqual([500, 250]);
    expect(engine.buildModel()).toHaveLength(0);
  });
  it('validates dimensions and rolls back a failed blank-page initialization', () => {
    modelOf(engine, bytes);
    expect(() => engine.appendBlankPage(NaN, 200)).toThrow('dimensions');
    expect(engine.pageCount).toBe(2);
    const generate = vi.spyOn(engine.M, '_FPDFPage_GenerateContent').mockReturnValue(0);
    expect(() => engine.appendBlankPage(300, 300)).toThrow('initialized');
    generate.mockRestore();
    expect(engine.M._FPDF_GetPageCount(engine.doc)).toBe(2);
    expect(engine.buildModel().map(paragraphText).join(' ')).toContain('Original text');
  });
});
