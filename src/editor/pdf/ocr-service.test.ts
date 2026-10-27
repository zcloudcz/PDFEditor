import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { PDFDocument } from 'pdf-lib';
import { recognizeOcrImage, recognizePages } from './ocr-service';

const hocr = '<div class="ocr_page" title="bbox 0 0 600 900"><span class="ocr_line" title="bbox 60 60 300 100; baseline 0 0"><span class="ocrx_word" title="bbox 60 60 300 100; x_wconf 95">Český</span></span></div>';
const rendering = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(), cleanup: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ OPS: {}, GlobalWorkerOptions: {}, getDocument: rendering.getDocument }));
class TestWorker {
  static instances: TestWorker[] = [];
  static hold = '';
  static onAction: ((action: string) => void) | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: Array<{ action: string; payload: Record<string, unknown>; jobId: string }> = [];
  terminate = vi.fn();
  constructor(public url: URL) { TestWorker.instances.push(this); }
  postMessage(message: typeof this.messages[number]): void {
    this.messages.push(message); TestWorker.onAction?.(message.action);
    if (message.action === TestWorker.hold) return;
    queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ...message, status: 'resolve', data: message.action === 'recognize' ? { hocr, text: 'Český', confidence: 95 } : {} } })));
  }
}
beforeEach(() => {
  TestWorker.instances = []; TestWorker.hold = ''; TestWorker.onAction = undefined;
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('pinned local OCR worker', () => {
  it('uses only explicit local paths and fixed LSTM languages, disables caches and document logging', async () => {
    const result = await recognizeOcrImage(new Uint8Array([1, 2]), ['ces', 'eng'], new AbortController().signal);
    expect(result).toEqual({ hocr, text: 'Český', confidence: 95 });
    const worker = TestWorker.instances[0];
    expect(worker.url.pathname).toContain('ocr.worker.ts');
    expect(worker.messages.map(m => m.action)).toEqual(['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize']);
    expect(worker.messages[0].payload).toEqual({ options: { lstmOnly: true, corePath: `${location.origin}/ocr/core`, logging: false } });
    expect(worker.messages[1].payload).toEqual({ langs: ['ces', 'eng'], options: { langPath: `${location.origin}/ocr/models`, gzip: false, cacheMethod: 'none', lstmOnly: true } });
    expect(worker.messages[2].payload).toMatchObject({ langs: 'ces+eng', oem: 1, config: { debug_file: '/dev/null' } });
    expect(worker.terminate).toHaveBeenCalled();
  });
  it.each(['load', 'loadLanguage', 'initialize', 'recognize'])('terminates immediately when aborted during %s', async action => {
    const abort = new AbortController(); TestWorker.hold = action;
    TestWorker.onAction = current => { if (current === action) queueMicrotask(() => abort.abort()); };
    await expect(recognizeOcrImage(new Uint8Array([1]), ['eng'], abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.instances[0].terminate).toHaveBeenCalled();
  });
  it('rejects unsupported and duplicate languages before spawning a worker', async () => {
    for (const langs of [[], ['fra'], ['eng', 'eng'], ['eng', '../ces']]) await expect(recognizeOcrImage(new Uint8Array([1]), langs, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(TestWorker.instances).toHaveLength(0);
  });
  it('bounds a stuck page and does not wait for a worker termination response', async () => {
    vi.useFakeTimers(); TestWorker.hold = 'load';
    const result = recognizeOcrImage(new Uint8Array([1]), ['eng'], new AbortController().signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(120000); await assertion;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalled();
  });
  it('reports worker errors without relaying arbitrary engine payloads', async () => {
    TestWorker.hold = 'load';
    const result = recognizeOcrImage(new Uint8Array([1]), ['eng'], new AbortController().signal);
    TestWorker.instances[0].onmessage?.(new MessageEvent('message', { data: { jobId: 'ocr-1', action: 'load', status: 'reject', data: 'private document text' } }));
    await expect(result).rejects.toMatchObject({ code: 'engine-failed', message: 'engine-failed' });
  });
});
describe('searchable PDF preparation', () => {
  async function fixture() { const doc = await PDFDocument.create(); for (let i = 0; i < 3; i++) doc.addPage([200, 300]); return doc.save(); }
  function browserRaster() {
    const view = { width: 600, height: 900, convertToPdfPoint: (x: number, y: number) => [x / 3, 300 - y / 3] };
    rendering.destroy.mockResolvedValue(undefined); rendering.cleanup.mockReset();
    rendering.getDocument.mockReturnValue({ promise: Promise.resolve({ getPage: vi.fn().mockResolvedValue({ getOperatorList: async () => ({fnArray:[] as number[],argsArray:[] as unknown[]}), getViewport: ({ scale }: { scale: number }) => scale === 1 ? { ...view, width: 200, height: 300 } : view, render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }), cleanup: rendering.cleanup }) }), destroy: rendering.destroy });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new NodeBlob([new Uint8Array([1])], { type: 'image/png' }) as Blob));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf').buffer.slice(0) }));
  }
  it('processes selected pages serially, releases raster/worker resources and leaves the input intact', async () => {
    browserRaster(); const before = await fixture(), clone = before.slice(), progress = vi.fn();
    const result = await recognizePages(before, { indices: [2, 0], languages: ['ces'], mode: 'searchable' }, new AbortController().signal, progress);
    expect(result.pages.map(p => p.pageIndex)).toEqual([2, 0]); expect(result.pages[0].blocks.lines[0].words[0].text).toBe('Český');
    expect((await PDFDocument.load(result.pdfBytes)).getPageCount()).toBe(3); expect(before).toEqual(clone);
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]); expect(TestWorker.instances).toHaveLength(2);
    expect(TestWorker.instances.every(worker => worker.terminate.mock.calls.length > 0)).toBe(true);
    expect(rendering.cleanup).toHaveBeenCalledTimes(2); expect(rendering.destroy).toHaveBeenCalled();
  });
  it('rejects invalid page selections before rendering', async () => {
    rendering.getDocument.mockClear(); const bytes = await fixture();
    for (const indices of [[], [3], [-1], [0, 0], [0.5]]) await expect(recognizePages(bytes, { indices, languages: ['ces'], mode: 'searchable' }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(rendering.getDocument).not.toHaveBeenCalled();
  });
  it('prepares editable correction blocks without changing the original PDF', async () => {
    browserRaster(); const bytes = await fixture();
    const result = await recognizePages(bytes, {indices:[0],languages:['ces'],mode:'editable'},new AbortController().signal);
    expect(result.pdfBytes).toEqual(bytes); expect(result.pages[0].toDisplay?.(60,90)).toEqual([20,30]);
  });
});
