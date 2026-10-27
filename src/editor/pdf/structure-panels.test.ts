import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mountDocumentPropertiesPanel } from './document-properties-panel';
import { mountAttachmentsPanel } from './attachments-panel';
import type { StandardPdfToolsApi } from './standard-tools';

async function setup(): Promise<{ body: HTMLElement; api: StandardPdfToolsApi; output: () => Uint8Array }> {
  const doc = await PDFDocument.create(); doc.addPage(); let bytes = await doc.save();
  const body = document.createElement('div');
  const api: StandardPdfToolsApi = {
    readPdfSnapshot: async () => ({ bytes, revision: 3 }),
    runPdfOperation: vi.fn(async (_label, prepare, revision) => { expect(revision).toBe(3); bytes = await prepare(bytes, new AbortController().signal); }),
    registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn(),
  };
  return { body, api, output: () => bytes };
}
describe('PDF structure panels', () => {
  it('saves edited properties through one revision checked operation', async () => {
    const fixture = await setup(); mountDocumentPropertiesPanel(fixture.body, fixture.api);
    await vi.waitFor(() => expect(fixture.body.querySelector('input')).not.toBeNull());
    fixture.body.querySelector<HTMLInputElement>('input')!.value = 'New title';
    fixture.body.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(fixture.api.runPdfOperation).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fixture.body.querySelector<HTMLInputElement>('input')!.value).toBe('New title'));
  });
  it('shows attachment filenames as inert text and removes only on explicit action', async () => {
    const fixture = await setup();
    const { editAttachments } = await import('./attachments');
    const bytes = await editAttachments(fixture.output(), { kind: 'import', filename: 'note.txt', bytes: new Uint8Array([1]) });
    fixture.api.readPdfSnapshot = async () => ({ bytes, revision: 3 });
    mountAttachmentsPanel(fixture.body, fixture.api);
    await vi.waitFor(() => expect(fixture.body.textContent).toContain('note.txt'));
    expect(fixture.body.querySelector('a')).toBeNull();
    expect(fixture.api.runPdfOperation).not.toHaveBeenCalled();
    fixture.body.querySelector<HTMLButtonElement>('button:last-child')!.click();
    await vi.waitFor(() => expect(fixture.api.runPdfOperation).toHaveBeenCalledTimes(1));
  });
  it('does not import a file whose read finishes after the panel closes', async () => {
    const fixture = await setup(); const dispose = mountAttachmentsPanel(fixture.body, fixture.api);
    await vi.waitFor(() => expect(fixture.body.querySelector('input[type=file]')).not.toBeNull());
    let finish!: (bytes: ArrayBuffer) => void;
    const file = { name: 'delayed.txt', size: 2, type: 'text/plain', arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) } as File;
    const input = fixture.body.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(input.disabled).toBe(true);
    dispose(); finish(new Uint8Array([1, 2]).buffer);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fixture.api.runPdfOperation).not.toHaveBeenCalled();
  });
});
