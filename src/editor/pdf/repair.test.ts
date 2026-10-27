// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { repairPdf } from './repair';
import { inspect } from '../../tests/helpers/editor-pdf-inspect';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { resolve } = await import('node:path'), { pathToFileURL } = await import('node:url');
  return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});
beforeEach(() => vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) }));
afterEach(() => vi.unstubAllGlobals());

describe('bounded PDF repair', () => {
  it('restores a missing final EOF marker and independently verifies rendered content and forms', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([200, 200]); page.drawText('Still here', { x: 20, y: 80 }); doc.getForm().createCheckBox('still-here').addToPage(page, { x: 10, y: 10, width: 15, height: 15 });
    const original = await doc.save({ useObjectStreams: false }), marker = new TextDecoder('latin1').decode(original).lastIndexOf('%%EOF'), truncated = original.slice(0, marker), result = await repairPdf(truncated, new AbortController().signal);
    expect(new TextDecoder().decode(result.bytes.slice(-6))).toContain('%%EOF'); expect(result.profile).toBe('missing-final-eof');
    const before = await inspect(original, true), after = await inspect(result.bytes, true); expect(after.text).toEqual(before.text); expect(after.fields).toEqual(before.fields); expect(after.pixels).toEqual(before.pixels);
  });
  it('refuses unreadable, already complete and cancelled inputs', async () => {
    const doc = await PDFDocument.create(); doc.addPage([200, 200]); const original = await doc.save({ useObjectStreams: false });
    await expect(repairPdf(original, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(repairPdf(new Uint8Array([1, 2, 3]), new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' });
    const aborted = new AbortController(); aborted.abort(); await expect(repairPdf(original.slice(0, new TextDecoder('latin1').decode(original).lastIndexOf('%%EOF')), aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('refuses an xref table with in-use offsets pointing to the wrong objects despite a plausible missing EOF', async () => {
    const doc = await PDFDocument.create(); doc.addPage([200, 200]).drawText('Recovery must be real', { x: 10, y: 50 });
    const source = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1'), marker = source.lastIndexOf('%%EOF');
    const damaged = source.slice(0, marker).replace(/(\d{10})( \d{5} n)/g, '0000000001$2');
    await expect(repairPdf(new Uint8Array(Buffer.from(damaged, 'latin1')), new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
  it('refuses a missing-EOF file whose trailer Root is absent from its valid xref table', async () => {
    const doc = await PDFDocument.create(); doc.addPage([200, 200]);
    const source = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    const damaged = source.slice(0, source.lastIndexOf('%%EOF')).trimEnd().replace(/\/Root\s+\d+\s+\d+\s+R/, '/Root 999 0 R');
    await expect(repairPdf(new Uint8Array(Buffer.from(damaged, 'latin1')), new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
});
