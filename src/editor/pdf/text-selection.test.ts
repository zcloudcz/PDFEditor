import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist';
import { mapTextSelectionRects, pickPdfTextSelection, readTextSelection } from './text-selection';
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  TextLayer: class {
    constructor(readonly options: { container: HTMLElement }) {}
    async render() { const span = document.createElement('span'); span.textContent = 'Hello World'; this.options.container.append(span); }
    cancel() {}
  },
}));
const viewport = { width: 400, height: 600, rotation: 0, convertToPdfPoint: (x: number, y: number) => [10 + x / 2, 320 - y / 2] };
const bounds = { left: 50, top: 100, width: 400, height: 600 };
afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); });
function surface() { const container = document.createElement('div'); document.body.append(container); container.getBoundingClientRect = () => ({ ...bounds, x: 50, y: 100, right: 450, bottom: 700, toJSON: () => ({}) }); return { container, pageIndex: 0, width: 400, height: 600, zoom: 1 }; }
function mockDocument() { const destroy = vi.fn(async () => {}); vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ userUnit: 2, getViewport: () => viewport, getTextContent: async (): Promise<{items: unknown[]}> => ({ items: [] }) }) }), destroy } as unknown as ReturnType<typeof getDocument>); return destroy; }

describe('character text selection geometry', () => {
  it('maps only selected fragments through inverse crop/UserUnit coordinates', () => {
    expect(mapTextSelectionRects([{ left: 90, top: 220, width: 60, height: 20, rotation: 0 }, { left: 90, top: 260, width: 100, height: 20, rotation: 0 }], bounds, viewport, 2)).toEqual({ pageIndex: 2, rect: [30, 230, 50, 30], quadPoints: [30, 260, 60, 260, 30, 250, 60, 250, 30, 240, 80, 240, 30, 230, 80, 230] });
  });
  it.each([
    [0, [30, 260, 60, 260, 30, 250, 60, 250]],
    [90, [60, 260, 60, 250, 30, 260, 30, 250]],
    [180, [60, 250, 30, 250, 60, 260, 30, 260]],
    [270, [30, 250, 30, 260, 60, 250, 60, 260]],
  ])('preserves text edge order at display rotation %s', (rotation, expected) => {
    expect(mapTextSelectionRects([{ left: 90, top: 220, width: 60, height: 20, rotation: Number(rotation) }], bounds, viewport, 0)?.quadPoints).toEqual(expected);
  });
  it('gets a partial text-node DOM Range rather than the entire PDF text run', () => {
    const layer = document.createElement('div'), span = document.createElement('span'); span.textContent = 'Hello World'; layer.append(span); document.body.append(layer);
    const node = span.firstChild!; const range = document.createRange(); range.setStart(node, 1); range.setEnd(node, 4); window.getSelection()!.addRange(range);
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function(this: Range) { expect(this.startOffset).toBe(1); expect(this.endOffset).toBe(4); return [{ left: 90, top: 220, width: 30, height: 20 }]; } });
    expect(readTextSelection(layer, window.getSelection(), bounds, viewport, 0)).toEqual({ pageIndex: 0, rect: [30, 250, 15, 10], quadPoints: [30, 260, 45, 260, 30, 250, 45, 250] });
  });
  it('refuses a stale/outside range, an empty selection and unsupported slanted text', () => {
    const layer = document.createElement('div'); document.body.append(layer); const other = document.createElement('div'); other.textContent = 'Old document'; document.body.append(other); const range = document.createRange(); range.selectNodeContents(other); window.getSelection()!.addRange(range);
    expect(readTextSelection(layer, window.getSelection(), bounds, viewport, 0)).toBeNull();
    expect(mapTextSelectionRects([{ left: 90, top: 220, width: 30, height: 20, rotation: 45 }], bounds, viewport, 0)).toBeNull();
    expect(mapTextSelectionRects([], bounds, viewport, 0)).toBeNull();
  });
});

describe('temporary selector on the existing page surface', () => {
  it('requires a fresh in-layer user selection and Enter, then removes the layer/listeners', async () => {
    const s = surface(), destroy = mockDocument(), pending = pickPdfTextSelection(new Uint8Array([1]), () => s);
    await vi.waitFor(() => expect(s.container.querySelector('[data-selection-ready="true"]')).not.toBeNull());
    const span = s.container.querySelector('[data-pdf-text-selection] span')!; const range = document.createRange(); range.setStart(span.firstChild!, 1); range.setEnd(span.firstChild!, 4); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ left: 90, top: 220, width: 30, height: 20 }] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(await pending).toMatchObject({ pageIndex: 0, rect: [30, 250, 15, 10] }); expect(destroy).toHaveBeenCalled(); expect(s.container.querySelector('[data-pdf-text-selection]')).toBeNull();
  });
  it.each(['Escape', 'abort', 'changed', 'detach'])('cancels %s without a selection result', async kind => {
    const s = surface(), abort = new AbortController(); mockDocument(); const pending = pickPdfTextSelection(new Uint8Array([1]), () => s, abort.signal);
    await vi.waitFor(() => expect(s.container.querySelector('[data-pdf-text-selection]')).not.toBeNull());
    if (kind === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (kind === 'abort') abort.abort();
    if (kind === 'changed') window.dispatchEvent(new Event('editor:document-changed'));
    if (kind === 'detach') s.container.remove();
    expect(await pending).toBeNull(); expect(s.container.querySelector('[data-pdf-text-selection]')).toBeNull();
  });
});
