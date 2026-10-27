import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { mountAccessibilityPanel } from './accessibility-panel';
import { mountAdvancedObjectsPanel } from './advanced-objects-panel';
import { mountPrintPanel } from './print-panel';
import { readTagTree } from './tag-tree';
import type { StandardPdfToolsApi } from './standard-tools';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function button(body: HTMLElement, text: string) { return [...body.querySelectorAll('button')].find(b => b.textContent === text)!; }
function input(body: HTMLElement, text: string) { return [...body.querySelectorAll('label')].find(l => l.firstElementChild?.textContent === text)!.querySelector('input')!; }
async function fixture() {
  const doc = await PDFDocument.create(), page = doc.addPage();
  const root = doc.context.obj({ Type: 'StructTreeRoot' }), rootRef = doc.context.register(root), tag = doc.context.register(doc.context.obj({ Type: 'StructElem', S: 'Figure', P: rootRef, Pg: page.ref, K: 0 }));
  root.set(PDFName.of('K'), doc.context.obj([tag])); root.set(PDFName.of('ParentTree'), doc.context.obj({ Nums: [0, [tag]] })); page.node.set(PDFName.of('StructParents'), doc.context.obj(0));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/Figure <</MCID 0>> BDC EMC'))); doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  return doc.save();
}
describe('accessibility panel engine adapter', () => {
  it('edits a listed untagged form label and document language after auditing', async () => {
    const doc = await PDFDocument.create(); doc.addPage(); const field = doc.getForm().createTextField('name'); field.setText('Keep value');
    let bytes = await doc.save(), revision = 1;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes: bytes.slice(), revision }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: async (_label, prepare, expected, signal) => { expect(expected).toBe(revision); bytes = await prepare(bytes, signal!); revision++; } };
    const body = document.createElement('div'), dispose = mountAccessibilityPanel(body, api);
    const audit = async () => { button(body, 'Zkontrolovat přístupnost a načíst strom').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); };
    await audit(); button(body, `name (${field.ref.toString()}): `).click();
    input(body, 'Popisek formulářového pole').value = 'Full name'; button(body, 'Použít popisek pole').click();
    await vi.waitFor(() => expect(revision).toBe(2));
    await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    await audit(); input(body, 'Jazyk (např. cs-CZ)').value = 'cs-CZ'; button(body, 'Použít jazyk dokumentu').click();
    await vi.waitFor(() => expect(revision).toBe(3));
    const out = await PDFDocument.load(bytes);
    expect(out.getForm().getTextField('name').acroField.dict.get(PDFName.of('TU'))?.toString()).toContain('00460075006C006C0020006E0061006D0065');
    expect(out.getForm().getTextField('name').getText()).toBe('Keep value');
    expect(out.catalog.get(PDFName.of('Lang'))?.toString()).toContain('00630073002D0043005A'); dispose();
  });
  it('audits actual tags, edits alternative text through a revision checked operation and invalidates old report', async () => {
    let bytes = await fixture(), revision = 9;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes: bytes.slice(), revision }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn(async (_label, prepare, expected, signal) => { expect(expected).toBe(revision); signal!.throwIfAborted(); bytes = await prepare(bytes, signal!); revision++; }) };
    const body = document.createElement('div'), dispose = mountAccessibilityPanel(body, api); document.body.append(body);
    button(body, 'Zkontrolovat přístupnost a načíst strom').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(body.textContent).toContain('Chybí alternativní text'); expect(body.querySelector('ol')!.textContent).toContain('Figure');
    input(body, 'Alternativní text').value = 'Český popis obrázku'; button(body, 'Použít alternativní text').click(); await vi.waitFor(() => expect(api.runPdfOperation).toHaveBeenCalledTimes(1)); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect((await readTagTree(bytes)).nodes[0].alt).toBe('Český popis obrázku'); expect(body.querySelector('pre')!.textContent).toBe('');
    expect(body.textContent).toContain('nepotvrzuje PDF/UA'); dispose();
  });
  it('refuses editing tags from an older revision', async () => {
    const bytes = await fixture(); let revision = 1;
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn() };
    const body = document.createElement('div'), dispose = mountAccessibilityPanel(body, api);
    button(body, 'Zkontrolovat přístupnost a načíst strom').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull()); revision++;
    input(body, 'Alternativní text').value = 'Late'; button(body, 'Použít alternativní text').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    expect(api.runPdfOperation).not.toHaveBeenCalled(); dispose();
  });
  it('keeps field identifiers and author content out of translation', async () => {
    const bytes = await fixture(), seen: string[] = [], api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision: 1 }), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn(), t: s => { seen.push(s); return s; } };
    const body = document.createElement('div'), dispose = mountAccessibilityPanel(body, api); button(body, 'Zkontrolovat přístupnost a načíst strom').click(); await vi.waitFor(() => expect(body.getAttribute('aria-busy')).toBeNull());
    const id = (await readTagTree(bytes)).nodes[0].id; expect(seen).not.toContain(id); expect(seen).not.toContain('Figure'); dispose();
  });
});
describe.each([
  ['accessibility', mountAccessibilityPanel, 'Zkontrolovat přístupnost a načíst strom'],
  ['advanced objects', mountAdvancedObjectsPanel, 'Načíst vrstvy, portfolio a média'],
  ['print', mountPrintPanel, 'Zkontrolovat tiskové podklady'],
] as const)('%s panel lifecycle', (_name, mount, action) => {
  it.each(['cancel', 'dispose'] as const)('prevents pending snapshot work after %s and releases close guard', async kind => {
    let resolve!: (value: { bytes: Uint8Array; revision: number }) => void;
    const api: StandardPdfToolsApi = { readPdfSnapshot: vi.fn(() => new Promise<{ bytes: Uint8Array; revision: number }>(r => { resolve = r; })), registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(), runPdfOperation: vi.fn() };
    const dialog = document.createElement('dialog'), close = document.createElement('button'), body = document.createElement('div'); dialog.append(close, body); document.body.append(dialog);
    const dispose = mount(body, api); button(body, action).click(); expect(close.disabled).toBe(true);
    if (kind === 'cancel') button(body, 'Zrušit operaci').click(); else dispose();
    resolve({ bytes: new Uint8Array([0]), revision: 1 }); await vi.waitFor(() => expect(close.disabled).toBe(false)); expect(api.runPdfOperation).not.toHaveBeenCalled();
    expect(body.querySelector('pre')?.textContent ?? '').toBe(''); if (kind === 'cancel') dispose();
  });
});
