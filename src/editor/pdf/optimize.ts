import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { loadStandardDocument } from './forms';
import { utilityFail } from './page-furniture';
import { assertRenderedImages, PdfRenderValidationError } from './render-validation';

export type OptimizationOptions = { mode: 'lossless' } | { mode: 'lossy'; quality: number };
export interface OptimizationResult {
  bytes: Uint8Array;
  beforeBytes: number;
  candidateBytes: number;
  afterBytes: number;
  removedObjects: number;
  changed: boolean;
  verification: 'identical-render-text-annotations' | 'rendered-text-annotations-structures';
  recompressedImages?: number;
  estimatedImageSavings?: number;
}
export interface PageCandidate { pageIndex: number; kind: 'blank' | 'duplicate'; duplicateOf?: number }
interface PageEvidence { width: number; height: number; pixels: string; text: string; annotations: string; white: boolean }
const MAX_EVIDENCE_PIXELS = 120_000_000;

/** A bounded preview, never permission to delete a page. Identical raster is only a candidate. */
async function evidence(bytes: Uint8Array, signal: AbortSignal): Promise<PageEvidence[]> {
  signal.throwIfAborted(); const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useSystemFonts: false, stopAtErrors: true, standardFontDataUrl: '/pdfjs-viewer/standard_fonts/' });
  const abortLoading = () => { void loading.destroy().catch(() => {}); }; signal.addEventListener('abort', abortLoading, { once: true });
  try {
    const source = await loading.promise; if (source.numPages > 200) utilityFail('limit-exceeded'); const pages: PageEvidence[] = [];
    let plannedPixels = 0;
    for (let index = 1; index <= source.numPages; index++) {
      signal.throwIfAborted(); const viewport = (await source.getPage(index)).getViewport({ scale: 1 });
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height), pixels = width * height;
      if (!Number.isFinite(pixels) || width <= 0 || height <= 0 || pixels > 12_000_000 || Math.max(viewport.width, viewport.height) > 8192) utilityFail('limit-exceeded');
      plannedPixels += pixels; if (plannedPixels > MAX_EVIDENCE_PIXELS) utilityFail('limit-exceeded');
    }
    for (let index = 1; index <= source.numPages; index++) {
      signal.throwIfAborted(); const page = await source.getPage(index), viewport = page.getViewport({ scale: 1 });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0 || viewport.width * viewport.height > 12_000_000 || Math.max(viewport.width, viewport.height) > 8192) utilityFail('limit-exceeded');
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d'); if (!context) utilityFail('verification-failed');
      try {
        const render = page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' });
        const abortRender = () => render.cancel(); signal.addEventListener('abort', abortRender, { once: true });
        try { await render.promise; } finally { signal.removeEventListener('abort', abortRender); }
        signal.throwIfAborted(); await assertRenderedImages(page, signal); const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const pixels = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)))].map(v => v.toString(16).padStart(2, '0')).join('');
        const content = await page.getTextContent(), annotations = await page.getAnnotations();
        // PDF.js fontName embeds a per-loading-task ID, not document semantics.
        const text = content.items.map(item => 'str' in item ? { str: item.str, dir: item.dir, width: item.width, height: item.height, transform: item.transform, hasEOL: item.hasEOL } : item);
        pages.push({ width: viewport.width, height: viewport.height, pixels, white: data.every(v => v === 255), text: JSON.stringify(text), annotations: JSON.stringify(annotations) });
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
      // Give cancellation and the editor event loop an opportunity between pages.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return pages;
  } catch (error) { signal.throwIfAborted(); if (error instanceof PdfRenderValidationError) utilityFail('verification-failed'); throw error; }
  finally { signal.removeEventListener('abort', abortLoading); await loading.destroy(); }
}
export async function verifyPdfRender(bytes: Uint8Array, signal: AbortSignal): Promise<void> { await evidence(bytes, signal); }

/** Bounded in-memory preview of one page. Its PNG is never used as a PDF export. */
export async function renderOptimizationPreview(bytes: Uint8Array, pageIndex: number, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted(); if (!Number.isInteger(pageIndex) || pageIndex < 0) utilityFail('invalid-request');
  const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useSystemFonts: false, stopAtErrors: true, standardFontDataUrl: '/pdfjs-viewer/standard_fonts/' });
  const abortLoading = () => { void loading.destroy().catch(() => {}); }; signal.addEventListener('abort', abortLoading, { once: true });
  try {
    const source = await loading.promise; signal.throwIfAborted(); if (pageIndex >= source.numPages) utilityFail('invalid-request');
    const page = await source.getPage(pageIndex + 1), natural = page.getViewport({ scale: 1 });
    if (![natural.width, natural.height].every(value => Number.isFinite(value) && value > 0) || Math.max(natural.width, natural.height) > 8192) utilityFail('limit-exceeded');
    const viewport = page.getViewport({ scale: Math.min(1, 1024 / Math.max(natural.width, natural.height)) });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    if (canvas.width * canvas.height > 1_048_576) utilityFail('limit-exceeded');
    try {
      const context = canvas.getContext('2d'); if (!context) utilityFail('verification-failed');
      const render = page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' });
      const abortRender = () => render.cancel(); signal.addEventListener('abort', abortRender, { once: true });
      try { await render.promise; } finally { signal.removeEventListener('abort', abortRender); }
      signal.throwIfAborted(); await assertRenderedImages(page, signal);
      const url = canvas.toDataURL('image/png'); if (!url.startsWith('data:image/png;base64,')) utilityFail('verification-failed');
      return url;
    } finally { canvas.width = canvas.height = 0; page.cleanup(); }
  } catch (error) { signal.throwIfAborted(); if (error instanceof PdfRenderValidationError) utilityFail('verification-failed'); throw error; }
  finally { signal.removeEventListener('abort', abortLoading); await loading.destroy(); }
}
export async function findPageCandidates(bytes: Uint8Array, signal: AbortSignal): Promise<PageCandidate[]> {
  bytes = bytes.slice(); await loadStandardDocument(bytes); const pages = await evidence(bytes, signal), seen = new Map<string, number>(), candidates: PageCandidate[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    // Form/annotation appearances and invisible searchable text make white pages significant.
    if (page.white && page.text === '[]' && page.annotations === '[]') candidates.push({ pageIndex, kind: 'blank' });
    const signature = `${page.width}:${page.height}:${page.pixels}:${page.text}:${page.annotations}`;
    const first = seen.get(signature); if (first !== undefined) candidates.push({ pageIndex, kind: 'duplicate', duplicateOf: first }); else seen.set(signature, pageIndex);
  }
  return candidates;
}
/** Garbage collect unreachable objects and use PDF object streams; never re-encode images or flatten pages. */
export async function optimizePdf(bytes: Uint8Array, options: OptimizationOptions, signal: AbortSignal): Promise<OptimizationResult> {
  signal.throwIfAborted(); if (!options || !['lossless', 'lossy'].includes(options.mode) || (options.mode === 'lossy' && (!Number.isFinite(options.quality) || options.quality < 0.1 || options.quality > 0.9))) utilityFail('invalid-request'); bytes = bytes.slice();
  if (bytes.length > 50 * 1024 * 1024) utilityFail('limit-exceeded');
  if (options.mode === 'lossy') return optimizeImages(bytes, options.quality, signal);
  const doc = await loadStandardDocument(bytes), visited = new Set<PDFObject>(), reachable = new Set<string>();
  const visit = (value: PDFObject | undefined, depth: number): void => {
    signal.throwIfAborted(); if (!value) return; if (depth > 256 || visited.size > 100000) utilityFail('limit-exceeded');
    if (value instanceof PDFRef) { const id = value.toString(); if (reachable.has(id)) return; reachable.add(id); const resolved = doc.context.lookup(value); if (!resolved) utilityFail('unsupported-structure'); visit(resolved, depth + 1); return; }
    if (visited.has(value)) return; visited.add(value);
    const object = value instanceof PDFStream ? value.dict : value;
    if (object instanceof PDFDict) for (const [, child] of object.entries()) visit(child, depth + 1);
    else if (object instanceof PDFArray) for (const child of object.asArray()) visit(child, depth + 1);
  };
  for (const value of Object.values(doc.context.trailerInfo)) visit(value, 0);
  let removedObjects = 0; for (const [ref] of doc.context.enumerateIndirectObjects()) if (!reachable.has(ref.toString())) { doc.context.delete(ref); removedObjects++; }
  const candidate = await doc.save({ useObjectStreams: true, updateFieldAppearances: false }); signal.throwIfAborted();
  // Verify even when no reduction is possible; no unverified cleanup output reaches the document owner.
  const before = await evidence(bytes, signal), after = await evidence(candidate, signal);
  if (JSON.stringify(before) !== JSON.stringify(after)) utilityFail('verification-failed');
  const changed = candidate.length < bytes.length, output = changed ? candidate : bytes;
  return { bytes: output, beforeBytes: bytes.length, candidateBytes: candidate.length, afterBytes: output.length, removedObjects, changed, verification: 'identical-render-text-annotations' };
}

async function optimizeImages(bytes: Uint8Array, quality: number, signal: AbortSignal): Promise<OptimizationResult> {
  const doc = await loadStandardDocument(bytes), images: Array<[PDFRef, PDFStream, number, number]> = []; let plannedImagePixels = 0;
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    signal.throwIfAborted(); if (!(object instanceof PDFStream) || object.dict.lookup(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    const dict = object.dict, width = dict.lookup(PDFName.of('Width')), height = dict.lookup(PDFName.of('Height')), bpc = dict.lookup(PDFName.of('BitsPerComponent'));
    if (dict.lookup(PDFName.of('Filter'))?.toString() !== '/DCTDecode' || dict.lookup(PDFName.of('ColorSpace'))?.toString() !== '/DeviceRGB' || !(width instanceof PDFNumber) || !(height instanceof PDFNumber) || !(bpc instanceof PDFNumber) || bpc.asNumber() !== 8 || !Number.isSafeInteger(width.asNumber()) || !Number.isSafeInteger(height.asNumber()) || width.asNumber() < 1 || height.asNumber() < 1 || width.asNumber() * height.asNumber() > 16_000_000 || width.asNumber() > 8192 || height.asNumber() > 8192 || ['SMask', 'Mask', 'Decode', 'DecodeParms', 'Alternates', 'ImageMask'].some(name => dict.has(PDFName.of(name)))) utilityFail('unsupported-structure');
    plannedImagePixels += width.asNumber() * height.asNumber(); if (plannedImagePixels > 120_000_000) utilityFail('limit-exceeded');
    images.push([ref, object, width.asNumber(), height.asNumber()]);
  }
  if (!images.length || images.length > 100) utilityFail('unsupported-structure');
  // A decoder error can otherwise produce a blank-looking successful PDF.js render.
  const before = await evidence(bytes, signal);
  let estimatedImageSavings = 0, recompressedImages = 0;
  for (const [ref, object, width, height] of images) {
    signal.throwIfAborted(); const source = object.getContents(); if (source.length > 20 * 1024 * 1024) utilityFail('limit-exceeded');
    validateJpegMetadata(source);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(new Blob([source.slice().buffer as ArrayBuffer], { type: 'image/jpeg' })); }
    catch { utilityFail('verification-failed'); }
    try {
      if (bitmap.width !== width || bitmap.height !== height) utilityFail('verification-failed');
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      try {
        const context = canvas.getContext('2d'); if (!context) utilityFail('verification-failed'); context.drawImage(bitmap, 0, 0);
        const encoded = canvas.toDataURL('image/jpeg', quality), prefix = 'data:image/jpeg;base64,';
        if (!encoded.startsWith(prefix)) utilityFail('verification-failed');
        const binary = atob(encoded.slice(prefix.length)), replacement = Uint8Array.from(binary, char => char.charCodeAt(0));
        if (replacement.length >= source.length) continue;
        const updated = PDFRawStream.of(object.dict.clone(doc.context), replacement); doc.context.assign(ref, updated);
        recompressedImages++; estimatedImageSavings += source.length - replacement.length;
      } finally { canvas.width = canvas.height = 0; }
    } finally { bitmap.close(); }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (!recompressedImages) return { bytes, beforeBytes: bytes.length, candidateBytes: bytes.length, afterBytes: bytes.length, removedObjects: 0, changed: false, verification: 'rendered-text-annotations-structures', recompressedImages, estimatedImageSavings };
  const candidate = await doc.save({ useObjectStreams: false, updateFieldAppearances: false }); signal.throwIfAborted();
  const after = await evidence(candidate, signal);
  if (before.length !== after.length || before.some((page, index) => page.width !== after[index].width || page.height !== after[index].height || page.text !== after[index].text || page.annotations !== after[index].annotations)) utilityFail('verification-failed');
  await verifyStructures(bytes, candidate);
  const changed = candidate.length < bytes.length, output = changed ? candidate : bytes;
  return { bytes: output, beforeBytes: bytes.length, candidateBytes: candidate.length, afterBytes: output.length, removedObjects: 0, changed, verification: 'rendered-text-annotations-structures', recompressedImages: changed ? recompressedImages : 0, estimatedImageSavings };
}

/** Browser bitmap decoders may honor EXIF orientation or ICC/Adobe transforms that PDF decoders ignore. */
function validateJpegMetadata(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) utilityFail('unsupported-structure');
  let position = 2;
  while (position < bytes.length && position < 1_000_000) {
    if (bytes[position++] !== 0xff) utilityFail('unsupported-structure');
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xda) return;
    if (marker === 0xd9 || marker === undefined || marker === 0x00) utilityFail('unsupported-structure');
    if (marker >= 0xe1 && marker <= 0xef) utilityFail('unsupported-structure');
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (position + 2 > bytes.length) utilityFail('unsupported-structure');
    const length = (bytes[position] << 8) | bytes[position + 1];
    if (length < 2 || position + length > bytes.length) utilityFail('unsupported-structure');
    position += length;
  }
  utilityFail('unsupported-structure');
}

async function verifyStructures(before: Uint8Array, after: Uint8Array): Promise<void> {
  const a = await loadStandardDocument(before), b = await loadStandardDocument(after);
  const summary = (doc: PDFDocument) => JSON.stringify({ pages: doc.getPageCount(), fields: doc.catalog.has(PDFName.of('AcroForm')) ? doc.getForm().getFields().map(field => [field.getName(), field.constructor.name]).sort() : [], catalog: doc.catalog.entries().map(([key, value]) => [key.toString(), value.toString()]).sort(), pagesRaw: doc.getPages().map(page => page.node.entries().filter(([key]) => key.toString() !== '/Contents').map(([key, value]) => [key.toString(), value.toString()]).sort()) });
  if (summary(a) !== summary(b)) utilityFail('verification-failed');
}
