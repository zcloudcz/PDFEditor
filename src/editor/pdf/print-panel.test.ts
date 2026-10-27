import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mountPrintPanel } from './print-panel';
import type { StandardPdfToolsApi } from './standard-tools';
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => { const { resolve } = await import('node:path'), { pathToFileURL } = await import('node:url'); return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href }; });
const originalHex = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toHex'), originalMap = Object.getOwnPropertyDescriptor(Map.prototype, 'getOrInsertComputed');
beforeEach(() => {
  if (!originalHex) Object.defineProperty(Uint8Array.prototype, 'toHex', { configurable: true, value: function(this: Uint8Array) { return Buffer.from(this).toString('hex'); } });
  if (!originalMap) Object.defineProperty(Map.prototype, 'getOrInsertComputed', { configurable: true, value: function<K,V>(this: Map<K,V>, key: K, make: (key: K) => V) { if (!this.has(key)) this.set(key, make(key)); return this.get(key); } });
});
afterEach(() => { if (!originalHex) Reflect.deleteProperty(Uint8Array.prototype, 'toHex'); if (!originalMap) Reflect.deleteProperty(Map.prototype, 'getOrInsertComputed'); document.body.replaceChildren(); vi.restoreAllMocks(); });
const button = (body: HTMLElement, text: string) => [...body.querySelectorAll('button')].find(b => b.textContent === text)!;
describe('print preparation panel', () => {
  it('audits actual PDF and applies actual trim/bleed boxes and vector marks with expected revision', async () => {
    const doc = await PDFDocument.create(); doc.addPage([300, 400]).drawText('Print text'); let bytes = await doc.save(), revision = 4;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn(async (_label, prepare, expected, signal) => { expect(expected).toBe(revision); bytes = await prepare(bytes, signal!); revision++; }) };
    const body = document.createElement('div'), dispose = mountPrintPanel(body, api); button(body, 'Zkontrolovat tiskové podklady').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(body.querySelector('pre')!.textContent).toContain('Nevložené písmo'); expect(body.textContent).toContain('PDF/A-2b a PDF/X-4 nejsou dostupné');
    button(body, 'Použít tiskové hranice a značky').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    const result = await PDFDocument.load(bytes), page = result.getPage(0); expect(page.getTrimBox()).toMatchObject({ x: 18, y: 18, width: 264, height: 364 }); expect(page.getBleedBox()).toMatchObject({ x: 9, y: 9, width: 282, height: 382 });
    expect(api.runPdfOperation).toHaveBeenCalledTimes(1); expect(body.querySelector('pre')!.textContent).toBe(''); dispose();
  });
  it('invalid print settings leave existing PDF unchanged', async () => {
    const doc = await PDFDocument.create(); doc.addPage([300, 400]); const bytes = await doc.save(), before = bytes.slice(); let committed = false;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision: 2 }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: async (_label, prepare, _expected, signal) => { await prepare(bytes, signal!); committed = true; } };
    const body = document.createElement('div'), dispose = mountPrintPanel(body, api); body.querySelector<HTMLInputElement>('input')!.value = '1'; button(body, 'Použít tiskové hranice a značky').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(committed).toBe(false); expect(bytes).toEqual(before); expect(body.textContent).toContain('Operace se nezdařila.'); dispose();
  });
});
