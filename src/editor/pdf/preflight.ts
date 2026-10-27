import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, type PDFObject } from 'pdf-lib';
import { OPS, Util } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { decodeObjectStream, loadBoundedObjectDocument } from './bounded-objects';
import { validateConformance, type ConformanceProfile, type ConformanceResult } from './conformance';

export interface PreflightFinding { code: 'font-not-embedded' | 'image-low-dpi' | 'transparency' | 'invalid-boxes' | 'text-outside-trim' | 'image-placement-unchecked'; pageIndex: number; value?: number }
export interface PreflightReport { profile: ConformanceProfile; conformance: ConformanceResult['status']; findings: PreflightFinding[]; limitations: string[] }
export class PrintPdfError extends Error {
  constructor(public readonly code: 'invalid-settings' | 'limit-exceeded' | 'conformance-unavailable' | 'unsupported-structure') { super(code); this.name = 'PrintPdfError'; }
}
type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const name = PDFName.of;
/** First profile accepts only bounded raw/Flate streams without predictors; other filters refuse. */
export async function loadPrintDocument(bytes: Uint8Array, signal?: AbortSignal) {
  const doc = await loadBoundedObjectDocument(bytes), seen = new Set<PDFObject>(); let imagePixels = 0;
  const inspect = (object: PDFObject, depth: number): void => {
    signal?.throwIfAborted(); if (seen.has(object)) return;
    if (depth > 64 || seen.size > 100000) throw new PrintPdfError('limit-exceeded'); seen.add(object);
    const dict = object instanceof PDFStream ? object.dict : object;
    if (object instanceof PDFRawStream) decodeObjectStream(doc, object);
    if (dict instanceof PDFDict) {
      if (['XFA','JS','JavaScript','AA'].some(key => dict.has(name(key))) || ['JavaScript','Launch','SubmitForm','ImportData','Rendition'].includes(dict.get(name('S'))?.toString().slice(1) ?? '')) throw new PrintPdfError('unsupported-structure');
      if (dict.get(name('Subtype')) === name('Image')) {
        const width = dict.lookup(name('Width')), height = dict.lookup(name('Height'));
        const pixels = width instanceof PDFNumber && height instanceof PDFNumber ? width.asNumber()*height.asNumber() : NaN;
        if (!Number.isFinite(pixels) || pixels <= 0 || pixels > 16000000 || (imagePixels += pixels) > 48000000) throw new PrintPdfError('limit-exceeded');
      }
      for (const [,child] of dict.entries()) inspect(child,depth+1);
    } else if (dict instanceof PDFArray) for (const child of dict.asArray()) inspect(child,depth+1);
  };
  for (const [,object] of doc.context.enumerateIndirectObjects()) inspect(object,0);
  return doc;
}
export async function preflightPdf(bytes: Uint8Array, profile: ConformanceProfile = 'ordinary-pdf', options: { signal?: AbortSignal; minimumDpi?: number } = {}): Promise<PreflightReport> {
  options.signal?.throwIfAborted(); bytes = bytes.slice();
  const minimumDpi = options.minimumDpi ?? 300;
  if (!Number.isFinite(minimumDpi) || minimumDpi < 1 || minimumDpi > 2400) throw new PrintPdfError('invalid-settings');
  const doc = await loadPrintDocument(bytes, options.signal), conformance = await validateConformance(bytes, profile);
  const report: PreflightReport = { profile, conformance: conformance.status, findings: [], limitations: ['Only raw/Flate streams without predictors; JPEG/JPX and other filters currently refuse.', 'Resource font/transparency audit includes unused resources.', 'Overflow checks extracted text bounds only; clipping, vector/image overflow, annotations and glyph outlines are not certified.', 'No ICC, CMYK, overprint, separation or PDF/A/PDF/X conformance validation.'] };
  const add = (code: PreflightFinding['code'], pageIndex: number, value?: number) => { if (report.findings.length >= 10000) throw new PrintPdfError('limit-exceeded'); report.findings.push({ code, pageIndex, ...(value === undefined ? {} : { value }) }); };
  for (const [pageIndex, page] of doc.getPages().entries()) {
    options.signal?.throwIfAborted(); const seen = new Set<PDFObject>();
    const walk = (raw: PDFObject | undefined, depth: number): void => {
      if (!raw) return; const object = doc.context.lookup(raw); if (!object || seen.has(object)) return;
      if (depth > 40 || seen.size > 20000) throw new PrintPdfError('limit-exceeded'); seen.add(object);
      const dict = object instanceof PDFStream ? object.dict : object;
      if (dict instanceof PDFDict) {
        if (dict.get(name('Type')) === name('Font')) {
          const descendants = dict.lookupMaybe(name('DescendantFonts'), PDFArray), font = descendants?.lookup(0, PDFDict) ?? dict;
          const descriptor = font.lookupMaybe(name('FontDescriptor'), PDFDict);
          if (font.get(name('Subtype')) !== name('Type3') && (!descriptor || !['FontFile', 'FontFile2', 'FontFile3'].some(key => descriptor.lookup(name(key)) instanceof PDFStream))) add('font-not-embedded', pageIndex);
        }
        if (['ca', 'CA'].some(key => { const value = dict.lookup(name(key)); return value instanceof PDFNumber && value.asNumber() < 1; }) || (dict.has(name('SMask')) && dict.get(name('SMask')) !== name('None')) || (dict.has(name('BM')) && ![name('Normal'),name('Compatible')].includes(dict.get(name('BM')) as PDFName)) || (dict.get(name('S')) === name('Transparency'))) add('transparency', pageIndex);
        for (const [key, child] of dict.entries()) if (!['Parent', 'P'].includes(key.decodeText())) walk(child, depth + 1);
      } else if (dict instanceof PDFArray) for (const child of dict.asArray()) walk(child, depth + 1);
    };
    walk(page.node.Resources(), 0);
    const media = page.getMediaBox(), crop = page.getCropBox(), bleed = page.getBleedBox(), trim = page.getTrimBox();
    const inside = (a: typeof media, b: typeof media) => [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(Number.isFinite) && a.width > 0 && a.height > 0 && a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
    if (!inside(crop, media) || !inside(bleed, media) || !inside(trim, bleed)) add('invalid-boxes', pageIndex);
  }
  const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
  const abort = () => { void loading.destroy().catch(() => {}); }; options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    const source = await loading.promise;
    for (let index = 0; index < source.numPages; index++) {
      options.signal?.throwIfAborted(); const page = await source.getPage(index + 1), operators = await page.getOperatorList();
      if (operators.fnArray.length > 200000) throw new PrintPdfError('limit-exceeded');
      let matrix = identity(); const stack: Matrix[] = [];
      for (let i = 0; i < operators.fnArray.length; i++) {
        options.signal?.throwIfAborted();
        const op = operators.fnArray[i], args = operators.argsArray[i];
        if (op === OPS.save || op === OPS.paintFormXObjectBegin) { if (stack.length >= 64) throw new PrintPdfError('limit-exceeded'); stack.push([...matrix]); if (op === OPS.paintFormXObjectBegin && args[0]) matrix = Util.transform(matrix, args[0]) as Matrix; }
        else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? identity();
        else if (op === OPS.transform) matrix = Util.transform(matrix, args) as Matrix;
        else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
          const width = op === OPS.paintImageXObject ? args[1] : args[0]?.width, height = op === OPS.paintImageXObject ? args[2] : args[0]?.height;
          const dpi = Math.min(width * 72 / (Math.hypot(matrix[0], matrix[1]) * page.userUnit), height * 72 / (Math.hypot(matrix[2], matrix[3]) * page.userUnit));
          if (!Number.isFinite(dpi)) throw new PrintPdfError('unsupported-structure');
          if (dpi < minimumDpi) add('image-low-dpi', index, Math.round(dpi * 100) / 100);
        } else if ([OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup].includes(op)) add('image-placement-unchecked', index);
      }
      const trim = doc.getPage(index).getTrimBox(), text = await page.getTextContent();
      if (text.items.length > 100000) throw new PrintPdfError('limit-exceeded');
      if (text.items.some(item => { if (!('str' in item) || !item.str.trim()) return false; const [a, b, c, d, x, y] = item.transform, angle = Math.atan2(b, a), w = [item.width * Math.cos(angle), item.width * Math.sin(angle)], h = [-item.height * Math.sin(angle), item.height * Math.cos(angle)], corners = [[0, 0], w, h, [w[0]+h[0],w[1]+h[1]]]; return ![a,b,c,d,x,y].every(Number.isFinite) || corners.some(([dx,dy]) => x+dx < trim.x || x+dx > trim.x+trim.width || y+dy < trim.y || y+dy > trim.y+trim.height); })) add('text-outside-trim', index);
      page.cleanup();
    }
    options.signal?.throwIfAborted(); return report;
  } finally { options.signal?.removeEventListener('abort', abort); await loading.destroy(); }
}
