// @vitest-environment node
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { createBatchZip, runPdfBatch, safeBatchFilename, type BatchOutcome } from './batch';
async function fixture() { const doc = await PDFDocument.create(); doc.addPage([200, 300]).drawText('Source'); return doc.save(); }
describe('bounded sequential PDF batch', () => {
  it('isolates failure, keeps order and input bytes, and generates flat ZIP outputs', async () => {
    const source = await fixture(), copy = source.slice(), outcomes: BatchOutcome[] = [];
    for await (const outcome of runPdfBatch([{ name: '../first.pdf', bytes: source }, { name: 'private.pdf', bytes: new Uint8Array([0]) }, { name: 'C:\\x\\third.pdf', bytes: source }], [{ kind: 'rotate', indices: [0], angle: 90 }], new AbortController().signal)) outcomes.push(outcome);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['success', 'failed', 'success']); expect(source).toEqual(copy);
    for (const outcome of outcomes) if (outcome.status === 'success') expect((await PDFDocument.load(outcome.bytes)).getPage(0).getRotation().angle).toBe(90);
    const zip = await JSZip.loadAsync(await createBatchZip(outcomes, new AbortController().signal)); expect(Object.keys(zip.files)).toHaveLength(2); expect(Object.keys(zip.files).every(name => !/[\\/]/.test(name) && !name.includes('..'))).toBe(true);
  });
  it('stops before the next input when cancelled between sequential yields', async () => {
    const source = await fixture(), controller = new AbortController(), batch = runPdfBatch([{ name: 'a', bytes: source }, { name: 'b', bytes: source }, { name: 'c', bytes: source }], [{ kind: 'rotate', indices: [0], angle: 90 }], controller.signal);
    expect((await batch.next()).value).toMatchObject({ status: 'success', index: 0 }); controller.abort(); expect((await batch.next()).value).toMatchObject({ status: 'cancelled', index: 1 }); expect((await batch.next()).done).toBe(true);
  });
  it('bounds inputs and protects ZIP paths/device names/control text and collisions', async () => {
    const names = ['../../x.pdf', 'C:\\tmp\\x.pdf', 'CON', 'nul.pdf', '\u202e../x.pdf', '.', 'a/b.pdf']; const safe = names.map(safeBatchFilename); expect(new Set(safe).size).toBe(names.length); expect(safe.every(name => !/[\\/\u202e]/.test(name) && !name.includes('..'))).toBe(true);
    const source = await fixture(), batch = runPdfBatch(Array.from({ length: 21 }, () => ({ name: 'x', bytes: source })), [{ kind: 'rotate', indices: [0], angle: 90 }], new AbortController().signal); await expect(batch.next()).rejects.toMatchObject({ code: 'limit-exceeded' });
  });
});
