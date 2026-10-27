import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mountAnnotationPanel } from './annotation-panel';
import { readAnnotations } from './annotations';
import { pickPdfTextSelection } from './text-selection';
import type { StandardPdfToolsApi } from './standard-tools';
vi.mock('./text-selection', () => ({ pickPdfTextSelection: vi.fn() }));

describe('text markup in the shared annotation panel', () => {
  it.each(['Highlight', 'Underline', 'StrikeOut'])('uses selected character quads for %s and revision-guards the document transaction', async subtype => {
    const pdf = await PDFDocument.create(); pdf.addPage([400, 500]); let bytes = await pdf.save();
    const body = document.createElement('div'); document.body.append(body); const close = vi.fn();
    const runPdfOperation = vi.fn<StandardPdfToolsApi['runPdfOperation']>(async (_label, prepare, revision) => { expect(revision).toBe(7); bytes = await prepare(bytes, new AbortController().signal); });
    const api: StandardPdfToolsApi = { readPdfSnapshot: async () => ({ bytes, revision: 7 }), runPdfOperation, getPageSurface: () => null, registerDocumentAction: vi.fn(), mountDocumentPanel: vi.fn() };
    const dispose = mountAnnotationPanel(body, api, close);
    await vi.waitFor(() => expect(body.querySelector('select')).not.toBeNull());
    const picker = vi.mocked(pickPdfTextSelection); picker.mockResolvedValue({ pageIndex: 0, rect: [30, 100, 28, 12], quadPoints: [30, 112, 58, 112, 30, 100, 58, 100] });
    body.querySelector('select')!.value = subtype;
    Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Vytvořit anotaci')!.click();
    await vi.waitFor(() => expect(runPdfOperation).toHaveBeenCalledOnce());
    expect(picker).toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
    const annotations = await readAnnotations(bytes); expect(annotations).toHaveLength(1); expect(annotations[0]).toMatchObject({ subtype, rect: [30, 100, 28, 12], quadPoints: [30, 112, 58, 112, 30, 100, 58, 100] });
    dispose(); body.remove(); picker.mockClear();
  });
});
