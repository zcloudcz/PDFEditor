import { degrees, PDFDocument, type PDFFont, type PDFPage, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { calculateWordTransform, parseHocrDocument } from '../../js/utils/hocr-transform';
import type { OcrPage } from '../../js/types/ocr-pdf-type';
import { loadNavigationDocument } from './navigation';
import { prepareScanCanvas, validateScanPreparation, type ScanPreparation } from './scan-processing';
import { assertRenderedImages } from './render-validation';

export interface OcrRequest { indices: readonly number[]; languages: readonly string[]; mode: 'searchable' | 'editable'; preparation?: ScanPreparation; preview?: (original: string, prepared: string) => void }
export interface OcrPageResult { pageIndex: number; text: string; confidence: number; blocks: OcrPage; width?: number; height?: number; toDisplay?: (x: number, y: number) => [number, number]; rotation?: number }
export interface OcrResult { pdfBytes: Uint8Array; pages: OcrPageResult[] }
export class OcrError extends Error {
  constructor(public readonly code: 'invalid-request' | 'editable-unavailable' | 'engine-failed' | 'timeout' | 'font-unavailable' | 'limit-exceeded') { super(code); this.name = 'OcrError'; }
}
const fail = (code: OcrError['code']): never => { throw new OcrError(code); };
export const OCR_MAX_PIXELS = 12_000_000;
const MAX_PAGE_TIME_MS = 120_000;

/** Protocol pinned to tesseract.js 7.0.0 createWorker/worker-script. No runtime defaults. */
export async function recognizeOcrImage(image: Uint8Array, languages: readonly string[], signal: AbortSignal): Promise<{ hocr: string; text: string; confidence: number }> {
  signal.throwIfAborted();
  if (!languages.length || languages.length > 2 || new Set(languages).size !== languages.length || languages.some(l => !['ces', 'eng'].includes(l))) fail('invalid-request');
  const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url));
  let sequence = 0;
  let pending: { id: string; action: string; resolve: (value: unknown) => void; reject: (error: unknown) => void } | undefined;
  const abort = () => { worker.terminate(); pending?.reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { worker.terminate(); pending?.reject(new OcrError('timeout')); }, MAX_PAGE_TIME_MS);
  worker.onerror = event => { event.preventDefault(); pending?.reject(new OcrError('engine-failed')); };
  worker.onmessageerror = () => pending?.reject(new OcrError('engine-failed'));
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (!value || typeof value !== 'object' || !('jobId' in value) || !('action' in value) || !('status' in value) || !pending || value.jobId !== pending.id || value.action !== pending.action) return;
    if (value.status === 'reject') pending.reject(new OcrError('engine-failed'));
    if (value.status === 'resolve') pending.resolve('data' in value ? value.data : undefined);
  };
  const job = (action: string, payload: object): Promise<unknown> => {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = `ocr-${++sequence}`; pending = { id, action, resolve, reject };
      worker.postMessage({ workerId: 'editor-ocr', jobId: id, action, payload });
    });
  };
  try {
    await job('load', { options: { lstmOnly: true, corePath: new URL('/ocr/core', location.origin).href, logging: false } });
    await job('loadLanguage', { langs: [...languages], options: { langPath: new URL('/ocr/models', location.origin).href, gzip: false, cacheMethod: 'none', lstmOnly: true } });
    await job('initialize', { langs: languages.join('+'), oem: 1, config: { debug_file: '/dev/null' } });
    await job('setParameters', { params: { tessedit_pageseg_mode: '3', user_defined_dpi: '216' } });
    const result = await job('recognize', { image, options: { rotateAuto: false }, output: { text: true, hocr: true, blocks: false, pdf: false, debug: false } });
    signal.throwIfAborted();
    if (!result || typeof result !== 'object' || !('hocr' in result) || typeof result.hocr !== 'string' || !('text' in result) || typeof result.text !== 'string' || !('confidence' in result) || typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)) return fail('engine-failed');
    if (result.hocr.length > 10_000_000 || result.text.length > 1_000_000) fail('limit-exceeded');
    return { hocr: result.hocr, text: result.text, confidence: result.confidence };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); pending = undefined; }
}

interface OcrViewport { width: number; height: number; convertToPdfPoint(x: number, y: number): number[] }
/** Add only invisible text. Original PDF streams, images, vectors and annotations remain. */
export function appendOcrTextLayer(page: PDFPage, blocks: OcrPage, font: PDFFont, viewport: OcrViewport): void {
  if (!Number.isFinite(blocks.width) || !Number.isFinite(blocks.height) || blocks.width <= 0 || blocks.height <= 0 || blocks.lines.length > 10000) fail('engine-failed');
  const pixelX = viewport.width / blocks.width, pixelY = viewport.height / blocks.height;
  const origin = viewport.convertToPdfPoint(0, viewport.height);
  const right = viewport.convertToPdfPoint(pixelX, viewport.height);
  const up = viewport.convertToPdfPoint(0, viewport.height - pixelY);
  const glyphs = new Set(font.getCharacterSet());
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(right[0] - origin[0], right[1] - origin[1], up[0] - origin[0], up[1] - origin[1], origin[0], origin[1]));
  let words = 0;
  for (const line of blocks.lines) for (const word of line.words) {
    if (++words > 100000) fail('limit-exceeded');
    const text = word.text.replace(/[\p{Cc}\p{Cf}]/gu, '');
    if (!text.trim()) continue;
    if (text.length > 1000 || Object.values(word.bbox).some(v => !Number.isFinite(v)) || word.bbox.x1 <= word.bbox.x0 || word.bbox.y1 <= word.bbox.y0) fail('engine-failed');
    // Refuse unsupported glyphs rather than silently dropping recognized text.
    for (const character of text) if (!glyphs.has(character.codePointAt(0)!)) fail('font-unavailable');
    const transform = calculateWordTransform({ ...word, text }, line, blocks.height, (value, size) => font.widthOfTextAtSize(value, size));
    const angle = transform.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(c * transform.horizontalScale, s * transform.horizontalScale, -s, c, transform.x, transform.y));
    page.drawText(text, { x: 0, y: 0, font, size: transform.fontSize, opacity: 0, rotate: degrees(0) });
    page.pushOperators(popGraphicsState());
  }
  page.pushOperators(popGraphicsState());
}

export async function recognizePages(bytes: Uint8Array, request: OcrRequest, signal: AbortSignal, progress: (done: number, total: number) => void = () => {}): Promise<OcrResult> {
  signal.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 50 * 1024 * 1024) fail('limit-exceeded');
  request = { ...request, indices: [...request.indices], languages: [...request.languages] }; bytes = bytes.slice();
  if (request.preparation) { request.preparation = { ...request.preparation }; validateScanPreparation(request.preparation); }
  if (!['searchable', 'editable'].includes(request.mode) || !request.indices.length || request.indices.length > 200 || new Set(request.indices).size !== request.indices.length || !request.languages.length || request.languages.length > 2 || new Set(request.languages).size !== request.languages.length || request.languages.some(l => !['ces', 'eng'].includes(l))) fail('invalid-request');
  const doc = await loadNavigationDocument(bytes);
  if (request.indices.some(i => !Number.isInteger(i) || i < 0 || i >= doc.getPageCount())) fail('invalid-request');
  signal.throwIfAborted();
  const response = await fetch('/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf', { signal });
  if (!response.ok) fail('font-unavailable');
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(new Uint8Array(await response.arrayBuffer()), { subset: true });
  const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useSystemFonts: false, stopAtErrors: true, standardFontDataUrl: '/pdfjs-viewer/standard_fonts/' });
  const abortLoading = () => { void loading.destroy().catch(() => {}); };
  signal.addEventListener('abort', abortLoading, { once: true });
  const pages: OcrPageResult[] = [];
  try {
    const source = await loading.promise;
    progress(0, request.indices.length);
    for (const index of request.indices) {
      signal.throwIfAborted(); const page = await source.getPage(index + 1), original = page.getViewport({ scale: 1 });
      if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width <= 0 || original.height <= 0) fail('engine-failed');
      const scale = Math.min(3, 8192 / Math.max(original.width, original.height), Math.sqrt((request.preparation ? OCR_MAX_PIXELS / 1.2 : OCR_MAX_PIXELS) / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d'); if (!context) fail('engine-failed');
      try {
        const render = page.render({ canvasContext: context, canvas, viewport, background: 'rgb(255,255,255)' });
        const abortRender = () => render.cancel(); signal.addEventListener('abort', abortRender, { once: true });
        try { await render.promise; } finally { signal.removeEventListener('abort', abortRender); }
        await assertRenderedImages(page, signal);
        signal.throwIfAborted();
        const prepared = request.preparation ? await prepareScanCanvas(canvas, request.preparation, signal) : undefined;
        try {
          const raster = prepared?.canvas ?? canvas;
          // Preview is deliberately bounded independently of recognition resolution.
          if (request.preview) {
            const thumbnail = (input: HTMLCanvasElement) => { const small = document.createElement('canvas'); const ratio = Math.min(1, 900 / Math.max(input.width, input.height)); small.width = Math.max(1, Math.round(input.width * ratio)); small.height = Math.max(1, Math.round(input.height * ratio)); const ctx = small.getContext('2d'); if (!ctx) fail('engine-failed'); ctx.drawImage(input, 0, 0, small.width, small.height); const url = small.toDataURL('image/png'); small.width = small.height = 0; return url; };
            request.preview(thumbnail(canvas), thumbnail(raster));
          }
          const blob = await new Promise<Blob>((resolve, reject) => raster.toBlob(value => value ? resolve(value) : reject(new OcrError('engine-failed')), 'image/png'));
          const result = await recognizeOcrImage(new Uint8Array(await blob.arrayBuffer()), request.languages, signal);
          const blocks = parseHocrDocument(result.hocr);
          const toSource = (x: number, y: number): [number, number] => prepared ? prepared.geometry.toOriginal(x, y) : [x, y];
          const mappedViewport = { width: raster.width, height: raster.height, convertToPdfPoint(x: number, y: number) { const point = toSource(x, y); return viewport.convertToPdfPoint(point[0], point[1]); } };
          if (request.mode === 'searchable') appendOcrTextLayer(doc.getPage(index), blocks, font, mappedViewport);
          // Retain numbers/functions only; release both raster buffers after this iteration.
          const factorX = original.width / canvas.width, factorY = original.height / canvas.height;
          pages.push({ pageIndex: index, text: result.text, confidence: result.confidence, blocks, width: original.width, height: original.height, toDisplay: (x, y) => { const point = toSource(x, y); return [point[0] * factorX, point[1] * factorY]; }, rotation: -(request.preparation ? request.preparation.orientation + request.preparation.deskew : 0) });
        } finally { if (prepared) prepared.canvas.width = prepared.canvas.height = 0; }
        signal.throwIfAborted(); progress(pages.length, request.indices.length);
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
    signal.throwIfAborted(); const pdfBytes = request.mode === 'editable' ? bytes.slice() : await doc.save({ updateFieldAppearances: false }); signal.throwIfAborted();
    if (pdfBytes.byteLength > 50 * 1024 * 1024) fail('limit-exceeded');
    return { pdfBytes, pages };
  } catch (error) { signal.throwIfAborted(); throw error; }
  finally { signal.removeEventListener('abort', abortLoading); await loading.destroy(); }
}
