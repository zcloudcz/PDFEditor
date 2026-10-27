import { PDFName, rgb } from 'pdf-lib';
import { loadPrintDocument, PrintPdfError } from './preflight';
import { validateConformance, type ConformanceProfile } from './conformance';
export interface PrintSettings { profile: ConformanceProfile; trimInsetPt: number; bleedPt: number; cropMarks: boolean }
/** Insets retain existing artwork and page coordinates. Added marks are vectors inside MediaBox. */
export async function exportPrintPdf(bytes: Uint8Array, settings: PrintSettings, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted(); bytes = bytes.slice(); settings = { ...settings };
  if (!settings || typeof settings.cropMarks !== 'boolean' || !Number.isFinite(settings.trimInsetPt) || !Number.isFinite(settings.bleedPt) || settings.bleedPt < 0 || settings.trimInsetPt < settings.bleedPt || settings.trimInsetPt > 1000 || (settings.cropMarks && settings.trimInsetPt < settings.bleedPt + 8)) throw new PrintPdfError('invalid-settings');
  if ((await validateConformance(bytes, settings.profile)).status === 'unavailable') throw new PrintPdfError('conformance-unavailable');
  const doc = await loadPrintDocument(bytes, signal);
  for (const page of doc.getPages()) {
    signal?.throwIfAborted(); const box = page.getMediaBox(), inset = settings.trimInsetPt, bleed = settings.bleedPt;
    const crop = page.getCropBox();
    if (crop.x !== box.x || crop.y !== box.y || crop.width !== box.width || crop.height !== box.height) throw new PrintPdfError('unsupported-structure');
    const unit = page.node.lookup(PDFName.of('UserUnit'));
    if ((unit && unit.toString() !== '1') || page.getRotation().angle % 360 !== 0) throw new PrintPdfError('unsupported-structure');
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || Math.min(box.width, box.height) <= 2 * inset || Math.max(box.width, box.height) > 14400) throw new PrintPdfError('invalid-settings');
    page.setTrimBox(box.x + inset, box.y + inset, box.width - inset * 2, box.height - inset * 2);
    page.setBleedBox(box.x + inset - bleed, box.y + inset - bleed, box.width - 2 * (inset - bleed), box.height - 2 * (inset - bleed));
    page.setCropBox(box.x, box.y, box.width, box.height);
    if (settings.cropMarks) {
      const left = box.x + inset, right = box.x + box.width - inset, bottom = box.y + inset, top = box.y + box.height - inset;
      const line = (x1: number,y1: number,x2: number,y2: number) => page.drawLine({ start: { x:x1,y:y1 }, end: { x:x2,y:y2 }, thickness:.5, color:rgb(0,0,0) });
      for (const x of [left,right]) { line(x,bottom-bleed-7,x,bottom-bleed-2); line(x,top+bleed+2,x,top+bleed+7); }
      for (const y of [bottom,top]) { line(left-bleed-7,y,left-bleed-2,y); line(right+bleed+2,y,right+bleed+7,y); }
    }
  }
  signal?.throwIfAborted(); const result = await doc.save(); signal?.throwIfAborted(); return result;
}
