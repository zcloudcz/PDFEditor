import { afterEach, describe, expect, it, vi } from 'vitest';
const render = vi.hoisted(() => ({ destroy: vi.fn(async () => {}), fillRect: vi.fn(), strokeRect: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ getDocument: () => ({ destroy: render.destroy, promise: Promise.resolve({ getPage: async () => ({ getViewport: () => ({ width: 100, height: 100, convertToViewportPoint: (x: number, y: number) => [x, 100 - y] }), render: () => ({ promise: Promise.resolve() }) }) }) }) }));
import { mountRedactionPreview, type RedactionToolsApi } from './redaction-panel';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function setup() {
  const body = document.createElement('div'); document.body.append(body);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: render.fillRect, strokeRect: render.strokeRect } as unknown as CanvasRenderingContext2D);
  const api = { applyRedactions: vi.fn(async () => {}), readPdfSnapshot: vi.fn(), mountDocumentPanel: vi.fn(), registerDocumentAction: vi.fn() } satisfies RedactionToolsApi;
  const close = vi.fn();
  const dispose = mountRedactionPreview(body, api, { bytes: new Uint8Array([1, 2]), revision: 7 }, { pageIndex: 0, rect: [10, 20, 30, 40] }, close);
  return { body, api, close, dispose, button: body.querySelector('button')!, checkbox: body.querySelector('input')! };
}
describe('redaction preview and explicit Apply', () => {
  it('previews a mark without mutating the document and requires confirmation', async () => {
    const test = setup();
    await vi.waitFor(() => expect(render.strokeRect).toHaveBeenCalledWith(10, 40, 30, 40));
    expect(test.button.disabled).toBe(true); expect(test.api.applyRedactions).not.toHaveBeenCalled();
    test.dispose(); expect(test.api.applyRedactions).not.toHaveBeenCalled();
  });
  it('destroys old preview bytes/pixels before applying a confirmed mark', async () => {
    const test = setup(); await vi.waitFor(() => expect(render.strokeRect).toHaveBeenCalled());
    test.checkbox.checked = true; test.checkbox.dispatchEvent(new Event('change')); test.button.click();
    await vi.waitFor(() => expect(test.api.applyRedactions).toHaveBeenCalledWith([{ pageIndex: 0, rect: [10, 20, 30, 40] }], 7, true, expect.any(AbortSignal)));
    expect(render.destroy).toHaveBeenCalled(); expect(test.body.querySelector('canvas')!.width).toBe(0);
    expect(test.close).toHaveBeenCalledOnce(); test.dispose();
  });
  it('never reports success on incomplete purge', async () => {
    const test = setup(); test.api.applyRedactions.mockRejectedValue(Object.assign(new Error(), { code: 'purge-incomplete' }));
    await vi.waitFor(() => expect(render.strokeRect).toHaveBeenCalled());
    test.checkbox.checked = true; test.checkbox.dispatchEvent(new Event('change')); test.button.click();
    await vi.waitFor(() => expect(test.body.textContent).toContain('není dokončeno'));
    expect(test.close).not.toHaveBeenCalled(); expect(test.button.disabled).toBe(true); test.dispose();
  });
});
