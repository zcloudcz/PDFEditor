import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { mountAdvancedObjectsPanel } from './advanced-objects-panel';
import { inspectOptionalContent } from './layers';
import { listPortfolio, extractPortfolioItem } from './portfolio';
import type { StandardPdfToolsApi } from './standard-tools';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (body: HTMLElement, text: string) => [...body.querySelectorAll('button')].find(b => b.textContent === text)!;
async function fixture() {
  const doc = await PDFDocument.create(); doc.addPage(); const group = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Author layer') }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [group], D: { Order: [group] } })); return doc.save();
}
describe('advanced objects panel', () => {
  it('applies name, visibility and export state to actual OCG data through shared operation', async () => {
    let bytes = await fixture(), revision = 2;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn(async (_label, prepare, expected, signal) => { expect(expected).toBe(revision); bytes = await prepare(bytes, signal!); revision++; }) };
    const body = document.createElement('div'), dispose = mountAdvancedObjectsPanel(body, api); button(body, 'Načíst vrstvy, portfolio a média').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    const name = [...body.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === 'Název vrstvy')!.querySelector('input')!;
    name.value = 'Česká vrstva'; body.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked = false; body.querySelector('select')!.value = 'OFF';
    button(body, 'Použít vrstvu').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect((await inspectOptionalContent(bytes))[0]).toMatchObject({ name: 'Česká vrstva', visible: false, exportState: 'OFF' }); dispose();
  });
  it('imports and removes real local bytes without translating their filename', async () => {
    let bytes = await fixture(), revision = 1; const translated: string[] = [];
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), t: s => { translated.push(s); return s; }, runPdfOperation: vi.fn(async (_label, prepare, expected, signal) => { expect(expected).toBe(revision); bytes = await prepare(bytes, signal!); revision++; }) };
    const body = document.createElement('div'), dispose = mountAdvancedObjectsPanel(body, api);
    Object.defineProperty(body.querySelector('input[type=file]')!, 'files', { value: [{ name: 'Autorův soubor.txt', type: 'text/plain', size: 2, arrayBuffer: async () => new Uint8Array([7, 8]).buffer }] });
    button(body, 'Importovat soubor do portfolia').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    const files = await listPortfolio(bytes); expect(files[0].filename).toBe('Autorův soubor.txt'); expect((await extractPortfolioItem(bytes, files[0].id)).bytes).toEqual(new Uint8Array([7, 8]));
    button(body, 'Načíst vrstvy, portfolio a média').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(translated).not.toContain('Autorův soubor.txt'); button(body, 'Odstranit soubor z portfolia').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(await listPortfolio(bytes)).toEqual([]); dispose();
  });
  it('rejects oversize import before reading it', async () => {
    const read = vi.fn(), api = { readPdfSnapshot: vi.fn(), runPdfOperation: vi.fn() } as unknown as StandardPdfToolsApi;
    const body = document.createElement('div'), dispose = mountAdvancedObjectsPanel(body, api); Object.defineProperty(body.querySelector('input[type=file]')!, 'files', { value: [{ size: 21 * 1024 * 1024, arrayBuffer: read }] });
    button(body, 'Importovat soubor do portfolia').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(read).not.toHaveBeenCalled(); expect(api.runPdfOperation).not.toHaveBeenCalled(); dispose();
  });
  it('inventories active media without running it, then explicitly downloads only the selected raw stream', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage(), sound = doc.context.register(doc.context.flateStream(new Uint8Array([7, 8]), { Type: 'Sound', R: 44100 }));
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Sound', Rect: [0,0,10,10], Sound: sound })), doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'RichMedia', Rect: [10,10,20,20] }))]));
    const bytes = await doc.save(), downloads: Blob[] = [], urls = vi.fn((blob: Blob) => { downloads.push(blob); return 'blob:test'; }); vi.stubGlobal('URL', class extends URL { static createObjectURL = urls; static revokeObjectURL = vi.fn(); });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}), api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision: 1 }), runPdfOperation: vi.fn(), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() };
    const body = document.createElement('div'), dispose = mountAdvancedObjectsPanel(body, api); button(body, 'Načíst vrstvy, portfolio a média').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(body.textContent).toContain('RichMedia'); expect(body.textContent).toContain('Pouze inventář; extrakce není podporována'); expect(urls).not.toHaveBeenCalled(); expect(body.querySelector('iframe,video,audio,object,embed')).toBeNull();
    button(body, 'Stáhnout vložené médium').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(click).toHaveBeenCalledTimes(1); expect(downloads[0].type).toBe('application/octet-stream');
    const result = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(downloads[0]); });
    expect(new Uint8Array(result)).toEqual(new Uint8Array([7, 8])); expect(api.runPdfOperation).not.toHaveBeenCalled(); dispose();
  });
  it('prevents an extracted media download when cancelled during the final revision check', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage(), stream = doc.context.register(doc.context.flateStream(new Uint8Array([7,8]), { Type: 'Sound', R: 44100 }));
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Sound', Rect: [0,0,10,10], Sound: stream }))]));
    const bytes = await doc.save(), download = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = download; static revokeObjectURL = vi.fn(); });
    let calls = 0, finish!: (value: { bytes: Uint8Array; revision: number }) => void;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => { if (++calls === 4) return new Promise(resolve => { finish = resolve; }); return { bytes, revision: 1 }; }, runPdfOperation: vi.fn(), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() };
    const body = document.createElement('div'), dispose = mountAdvancedObjectsPanel(body, api); button(body, 'Načíst vrstvy, portfolio a média').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    button(body, 'Stáhnout vložené médium').click(); await vi.waitFor(() => expect(calls).toBe(4)); button(body, 'Zrušit operaci').click(); finish({ bytes, revision: 1 });
    await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); expect(download).not.toHaveBeenCalled(); dispose();
  });
});
