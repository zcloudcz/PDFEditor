import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';
import { mountUtilityPanel, setupPdfUtilities } from './utility-panel';
import type { StandardPdfToolsApi } from './standard-tools';
const mutations = vi.hoisted(() => ({
  apply: vi.fn<typeof import('./page-furniture').applyPageFurniture>(async bytes => bytes),
  remove: vi.fn<typeof import('./page-furniture').removePageFurniture>(async bytes => bytes),
}));
vi.mock('./page-furniture', async importOriginal => ({ ...await importOriginal<object>(), applyPageFurniture: mutations.apply, removePageFurniture: mutations.remove }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { resolve } = await import('node:path'), { pathToFileURL } = await import('node:url');
  return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});
const originalHex = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toHex'), originalMap = Object.getOwnPropertyDescriptor(Map.prototype, 'getOrInsertComputed');
beforeEach(() => {
  if (!originalHex) Object.defineProperty(Uint8Array.prototype, 'toHex', { configurable: true, value: function(this: Uint8Array) { return Buffer.from(this).toString('hex'); } });
  if (!originalMap) Object.defineProperty(Map.prototype, 'getOrInsertComputed', { configurable: true, value: function<K,V>(this: Map<K,V>, key: K, make: (key: K) => V) { if (!this.has(key)) this.set(key, make(key)); return this.get(key); } });
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); document.body.replaceChildren();
  if (!originalHex) Reflect.deleteProperty(Uint8Array.prototype, 'toHex');
  if (!originalMap) Reflect.deleteProperty(Map.prototype, 'getOrInsertComputed');
});
async function fixture() { const doc = await PDFDocument.create(); doc.addPage([200, 300]); return doc.save(); }
function button(body: HTMLElement, text: string): HTMLButtonElement { return [...body.querySelectorAll('button')].find(button => button.textContent === text)!; }
function repairFile(body: HTMLElement, file: Pick<File, 'size' | 'arrayBuffer'>): void {
  const fieldset = [...body.querySelectorAll('fieldset')].find(item => item.firstElementChild?.tagName === 'LEGEND' && item.firstElementChild.textContent === 'Opravit chybějící konec PDF')!;
  expect(fieldset.textContent).toContain('Vyberte soubory PDF');
  Object.defineProperty(fieldset.querySelector('input[type=file]')!, 'files', { configurable: true, value: [file] });
}
describe('shared Editor utility panel', () => {
  it('registers one document action and presents a meaningful editable name', () => {
    const api = { registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() } as unknown as StandardPdfToolsApi; setupPdfUtilities(api); expect(api.registerDocumentAction).toHaveBeenCalledTimes(1); expect(api.registerDocumentAction).toHaveBeenCalledWith('PDF nástroje', expect.any(Function));
    const body = document.createElement('div'), dispose = mountUtilityPanel(body, api); expect(body.textContent).toContain('Název položky'); expect(body.textContent).not.toContain('ID'); expect((body.querySelector('input') as HTMLInputElement).value).toBe('Číslování'); dispose();
  });
  it('presents explicit image recompression quality, comparison, and verified repair actions', () => {
    const api = { registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() } as unknown as StandardPdfToolsApi;
    const body = document.createElement('div'), dispose = mountUtilityPanel(body, api);
    expect(body.textContent).toContain('Ztrátová komprese obrázků (JPEG)');
    expect(button(body, 'Porovnat ztrátovou kompresi obrázků')).toBeDefined();
    expect(button(body, 'Opravit chybějící konec PDF')).toBeDefined();
    dispose();
  });
  it('uses stable names for replacement/removal and revision checked shared operations', async () => {
    vi.stubGlobal('crypto', webcrypto); const bytes = await fixture(), body = document.createElement('div'); document.body.append(body);
    const api: StandardPdfToolsApi = { readPdfSnapshot: vi.fn(async () => ({ bytes, revision: 7 })), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn<StandardPdfToolsApi['runPdfOperation']>(async (_label, prepare, revision, signal) => { expect(revision).toBe(7); await prepare(bytes, signal!); }) };
    const dispose = mountUtilityPanel(body, api); button(body, 'Použít položku').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(mutations.apply).toHaveBeenCalledTimes(1); const firstId = mutations.apply.mock.calls[0][1].id; expect(firstId).toMatch(/^named-[a-f0-9]{32}$/);
    button(body, 'Použít položku').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(mutations.apply.mock.calls[1][1].id).toBe(firstId);
    button(body, 'Odstranit položku podle názvu').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(mutations.remove.mock.calls[0][1]).toBe(firstId); dispose();
  });
  it('cancels snapshot preparation without starting a late mutation and unlocks the close button', async () => {
    const bytes = await fixture(); let resolve!: (value: { bytes: Uint8Array; revision: number }) => void;
    const api: StandardPdfToolsApi = { readPdfSnapshot: () => new Promise(r => { resolve = r; }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn() };
    const dialog = document.createElement('dialog'), close = document.createElement('button'), body = document.createElement('div'); dialog.append(close, body); document.body.append(dialog); const dispose = mountUtilityPanel(body, api);
    button(body, 'Použít položku').click(); expect(close.disabled).toBe(true); button(body, 'Zrušit operaci').click(); resolve({ bytes, revision: 1 }); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(api.runPdfOperation).not.toHaveBeenCalled(); expect(close.disabled).toBe(false); expect(body.textContent).toContain('Operace zrušena.'); dispose();
  });
  it('repairs the selected raw malformed file and downloads it without reading or mutating the current document', async () => {
    const doc = await PDFDocument.create(); doc.addPage([200, 200]);
    const complete = await doc.save({ useObjectStreams: false }), marker = Buffer.from(complete).toString('latin1').lastIndexOf('%%EOF'), raw = complete.slice(0, marker);
    const api = { readPdfSnapshot: vi.fn(), runPdfOperation: vi.fn(), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() } as unknown as StandardPdfToolsApi;
    const body = document.createElement('div'); document.body.append(body); const dispose = mountUtilityPanel(body, api);
    vi.stubGlobal('crypto', webcrypto);
    repairFile(body, { size: raw.length, arrayBuffer: async () => raw.slice().buffer as ArrayBuffer });
    const create = document.createElement.bind(document); vi.spyOn(document, 'createElement').mockImplementation((tag: string) => tag === 'canvas' ? createCanvas(1, 1) as unknown as HTMLCanvasElement : create(tag));
    const url = vi.fn(() => 'blob:test'); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: url }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    button(body, 'Opravit chybějící konec PDF').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(body.textContent).toContain('Opravený soubor ověřen.'); expect(url).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
    expect(api.readPdfSnapshot).not.toHaveBeenCalled(); expect(api.runPdfOperation).not.toHaveBeenCalled(); dispose();
  });
  it('shows distinct original and compressed page images before enabling lossy apply', async () => {
    const canvas = createCanvas(180, 120), context = canvas.getContext('2d');
    for (let y = 0; y < 120; y++) for (let x = 0; x < 180; x++) { context.fillStyle = `rgb(${(x * 13 + y * 7) % 256},${(x * 3 + y * 19) % 256},${(x * 23 + y * 11) % 256})`; context.fillRect(x, y, 1, 1); }
    const jpeg = canvas.toBuffer('image/jpeg', 100), iccAt = jpeg.indexOf(Buffer.from([0xff, 0xe2])), plain = iccAt < 0 ? jpeg : Buffer.concat([jpeg.subarray(0, iccAt), jpeg.subarray(iccAt + 2 + jpeg.readUInt16BE(iccAt + 2))]);
    const doc = await PDFDocument.create(), page = doc.addPage([240, 180]); page.drawText('Preserve text', { x: 20, y: 150 }); page.drawImage(await doc.embedJpg(Uint8Array.from(plain)), { x: 20, y: 20, width: 180, height: 120 });
    const bytes = await doc.save({ useObjectStreams: false }), api = { readPdfSnapshot: vi.fn(async () => ({ bytes, revision: 3 })), runPdfOperation: vi.fn(), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), getPageSurface: (): null => null } as unknown as StandardPdfToolsApi;
    const body = document.createElement('div'); document.body.append(body); const dispose = mountUtilityPanel(body, api);
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('ImageData', ImageData); vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      const data = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob); });
      return Object.assign(await loadImage(Buffer.from(data)), { close: (): void => {} });
    });
    const create = document.createElement.bind(document); vi.spyOn(document, 'createElement').mockImplementation((tag: string) => tag === 'canvas' ? createCanvas(1, 1) as unknown as HTMLCanvasElement : create(tag));
    button(body, 'Porovnat ztrátovou kompresi obrázků').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull(), { timeout: 10000 });
    expect(body.textContent).toContain('Text, vektory a anotace ověřeny; obraz se může změnit.');
    const previews = [...body.querySelectorAll('img')]; expect(previews).toHaveLength(2); expect(previews.map(img => img.alt)).toEqual(['Původní stránka', 'Nová stránka']); expect(previews[0].src).not.toBe(previews[1].src);
    expect(button(body, 'Použít ověřenou ztrátovou optimalizaci').disabled).toBe(false); expect(api.runPdfOperation).not.toHaveBeenCalled(); dispose();
  });
  it('rejects oversized raw repair files before reading bytes', async () => {
    const api = { readPdfSnapshot: vi.fn(), runPdfOperation: vi.fn(), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() } as unknown as StandardPdfToolsApi;
    const body = document.createElement('div'), dispose = mountUtilityPanel(body, api), read = vi.fn();
    repairFile(body, { size: 50 * 1024 * 1024 + 1, arrayBuffer: read }); button(body, 'Opravit chybějící konec PDF').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(read).not.toHaveBeenCalled(); expect(api.readPdfSnapshot).not.toHaveBeenCalled(); dispose();
  });
  it.each(['cancel', 'dispose'])('does not export a late raw repair after %s', async action => {
    const api = { readPdfSnapshot: vi.fn(), runPdfOperation: vi.fn(), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() } as unknown as StandardPdfToolsApi;
    const body = document.createElement('div'), dispose = mountUtilityPanel(body, api); let finish!: (bytes: ArrayBuffer) => void;
    repairFile(body, { size: 100, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
    const url = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: url });
    button(body, 'Opravit chybějící konec PDF').click(); await vi.waitFor(() => expect(finish).toBeDefined());
    if (action === 'cancel') button(body, 'Zrušit operaci').click(); else dispose();
    finish(new Uint8Array(100).buffer); if (action === 'cancel') await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); else await Promise.resolve();
    expect(url).not.toHaveBeenCalled(); expect(api.readPdfSnapshot).not.toHaveBeenCalled(); expect(api.runPdfOperation).not.toHaveBeenCalled(); if (action === 'cancel') dispose();
  });
});
