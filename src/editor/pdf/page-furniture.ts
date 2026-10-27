import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { loadStandardDocument } from './forms';

export type FurnitureKind = 'header' | 'footer' | 'page-number' | 'bates' | 'text-watermark' | 'image-watermark';
export interface FurnitureSpec {
  /** Stable local identifier: applying it again replaces that item's complete range. */
  id: string;
  kind: FurnitureKind;
  indices: readonly number[];
  text?: string;
  start?: number;
  prefix?: string;
  padding?: number;
  fontSize?: number;
  margin?: number;
  align?: 'left' | 'center' | 'right';
  opacity?: number;
  angle?: number;
  color?: readonly [number, number, number];
  image?: { bytes: Uint8Array; type: 'png' | 'jpeg'; width: number; height: number };
}
export class PdfUtilityError extends Error {
  constructor(public readonly code: 'invalid-request' | 'unsupported-structure' | 'font-unavailable' | 'limit-exceeded' | 'verification-failed') { super(code); this.name = 'PdfUtilityError'; }
}
export function utilityFail(code: PdfUtilityError['code']): never { throw new PdfUtilityError(code); }
const key = PDFName.of;
const managedKey = key('ZPDFManagedFurniture');

/** Physical visible page coordinates (points, origin at visible bottom left). */
export function furniturePageGeometry(page: PDFPage): { width: number; height: number; matrix: number[] } {
  const crop = page.getCropBox(), media = page.getMediaBox(), angle = ((page.getRotation().angle % 360) + 360) % 360;
  const rawUnit = page.node.lookup(key('UserUnit')), unit = rawUnit === undefined ? 1 : rawUnit instanceof PDFNumber ? rawUnit.asNumber() : NaN;
  if (![crop.x, crop.y, crop.width, crop.height, media.x, media.y, media.width, media.height, unit].every(Number.isFinite) || unit <= 0 || unit > 75000 || crop.width <= 0 || crop.height <= 0 || ![0, 90, 180, 270].includes(angle) || crop.x < media.x || crop.y < media.y || crop.x + crop.width > media.x + media.width || crop.y + crop.height > media.y + media.height) utilityFail('unsupported-structure');
  const u = 1 / unit, x = crop.x, y = crop.y, w = crop.width, h = crop.height;
  const matrix = angle === 0 ? [u, 0, 0, u, x, y] : angle === 90 ? [0, u, -u, 0, x + w, y] : angle === 180 ? [-u, 0, 0, -u, x + w, y + h] : [0, -u, u, 0, x, y + h];
  return { width: (angle % 180 ? h : w) * unit, height: (angle % 180 ? w : h) * unit, matrix };
}
function validate(spec: FurnitureSpec, count: number): void {
  if (!spec || !/^[A-Za-z0-9_-]{1,64}$/.test(spec.id) || !['header', 'footer', 'page-number', 'bates', 'text-watermark', 'image-watermark'].includes(spec.kind) || !Array.isArray(spec.indices) || !spec.indices.length || spec.indices.length > 200 || new Set(spec.indices).size !== spec.indices.length || spec.indices.some(i => !Number.isInteger(i) || i < 0 || i >= count)) utilityFail('invalid-request');
  if (spec.text !== undefined && (typeof spec.text !== 'string' || spec.text.length > 2000 || /[\p{Cc}\p{Cf}]/u.test(spec.text))) utilityFail('invalid-request');
  if (spec.prefix !== undefined && (typeof spec.prefix !== 'string' || spec.prefix.length > 100 || /[\p{Cc}\p{Cf}]/u.test(spec.prefix))) utilityFail('invalid-request');
  for (const [value, min, max] of [[spec.fontSize ?? 12, 4, 300], [spec.margin ?? 24, 0, 2000], [spec.opacity ?? 1, 0, 1], [spec.angle ?? 0, -360, 360]]) if (!Number.isFinite(value) || value < min || value > max) utilityFail('invalid-request');
  if (!Number.isSafeInteger(spec.start ?? 1) || (spec.start ?? 1) < 0 || !Number.isInteger(spec.padding ?? 6) || (spec.padding ?? 6) < 1 || (spec.padding ?? 6) > 16 || !['left', 'center', 'right'].includes(spec.align ?? 'center')) utilityFail('invalid-request');
  if (spec.color && (spec.color.length !== 3 || spec.color.some(v => !Number.isFinite(v) || v < 0 || v > 1))) utilityFail('invalid-request');
  if (spec.kind === 'image-watermark') {
    const image = spec.image;
    if (!image || !(image.bytes instanceof Uint8Array) || !image.bytes.length || image.bytes.length > 10 * 1024 * 1024 || !['png', 'jpeg'].includes(image.type) || ![image.width, image.height].every(v => Number.isFinite(v) && v > 0 && v <= 10000)) utilityFail('invalid-request');
  } else if (!['page-number', 'bates'].includes(spec.kind) && !spec.text?.trim()) utilityFail('invalid-request');
}
function remove(doc: PDFDocument, id: string): void {
  for (const page of doc.getPages()) {
    const raw = page.node.get(key('Contents')); if (!raw) continue;
    const resolved = doc.context.lookup(raw), contents = resolved instanceof PDFArray ? resolved.asArray() : [raw];
    if (contents.some(value => !(doc.context.lookup(value) instanceof PDFStream))) utilityFail('unsupported-structure');
    const kept = contents.filter(value => {
      const stream = doc.context.lookup(value) as PDFStream, marker = stream.dict.lookup(managedKey);
      if (marker === undefined) return true;
      if (!(marker instanceof PDFString)) utilityFail('unsupported-structure');
      return marker.decodeText() !== id;
    });
    // Copy the array: Contents arrays may be shared by multiple pages.
    if (kept.length !== contents.length) page.node.set(key('Contents'), doc.context.obj(kept));
  }
}
export async function removePageFurniture(bytes: Uint8Array, id: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) utilityFail('invalid-request');
  signal?.throwIfAborted(); const doc = await loadStandardDocument(bytes); remove(doc, id); signal?.throwIfAborted();
  return doc.save({ updateFieldAppearances: false });
}
/** Append isolated vector/text/image forms; existing content streams and document structures stay intact. */
export async function applyPageFurniture(bytes: Uint8Array, input: FurnitureSpec, options: { fontBytes?: Uint8Array; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const signal = options.signal; signal?.throwIfAborted();
  const spec = structuredClone(input), suppliedFont = options.fontBytes?.slice();
  const doc = await loadStandardDocument(bytes); validate(spec, doc.getPageCount());
  const geometries = spec.indices.map(index => furniturePageGeometry(doc.getPage(index)));
  let font, image;
  if (spec.kind === 'image-watermark') {
    // Read PNG IHDR before pdf-lib inflates pixels, including for malicious tiny files.
    if (spec.image!.type === 'png') {
      const data = spec.image!.bytes;
      if (data.length < 33 || data[0] !== 137 || data[1] !== 80 || data[2] !== 78 || data[3] !== 71 || data[12] !== 73 || data[13] !== 72 || data[14] !== 68 || data[15] !== 82) utilityFail('invalid-request');
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength), width = view.getUint32(16), height = view.getUint32(20);
      if (!width || !height || width * height > 40_000_000 || width > 16384 || height > 16384) utilityFail('limit-exceeded');
    }
    try { image = spec.image!.type === 'png' ? await doc.embedPng(spec.image!.bytes) : await doc.embedJpg(spec.image!.bytes); }
    catch { return utilityFail('invalid-request'); }
    if (image.width * image.height > 40_000_000 || image.width > 16384 || image.height > 16384) utilityFail('limit-exceeded');
  } else {
    let data = suppliedFont;
    if (!data) { const response = await fetch('/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf', { signal }); if (!response.ok) utilityFail('font-unavailable'); data = new Uint8Array(await response.arrayBuffer()); }
    try { doc.registerFontkit(fontkit); font = await doc.embedFont(data, { subset: true }); } catch { return utilityFail('font-unavailable'); }
  }
  remove(doc, spec.id);
  for (const [ordinal, index] of spec.indices.entries()) {
    signal?.throwIfAborted(); const page = doc.getPage(index), geometry = geometries[ordinal], size = spec.fontSize ?? 12, margin = spec.margin ?? 24;
    const color = spec.color ?? [0, 0, 0], resources = doc.context.obj({ ExtGState: { G: { Type: 'ExtGState', ca: spec.opacity ?? 1, CA: spec.opacity ?? 1 } } });
    let commands = `q ${geometry.matrix.join(' ')} cm /G gs ${color.join(' ')} rg\n`;
    const watermark = spec.kind.endsWith('watermark'), angle = (spec.angle ?? (watermark ? 30 : 0)) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (image) {
      const { width, height } = spec.image!; if (width > geometry.width || height > geometry.height) utilityFail('invalid-request');
      resources.set(key('XObject'), doc.context.obj({ I: image.ref }));
      commands += `${c} ${s} ${-s} ${c} ${geometry.width / 2} ${geometry.height / 2} cm ${width} 0 0 ${height} ${-width / 2} ${-height / 2} cm /I Do\n`;
    } else {
      const number = (spec.start ?? 1) + (spec.kind === 'bates' ? ordinal : index);
      const bates = (spec.prefix ?? '') + String(number).padStart(spec.padding ?? 6, '0');
      const template = spec.kind === 'page-number' ? spec.text ?? '{page} / {pages}' : spec.kind === 'bates' ? '{bates}' : spec.text!;
      const text = template.replace(/\{page\}/g, String((spec.start ?? 1) + index)).replace(/\{pages\}/g, String(doc.getPageCount())).replace(/\{bates\}/g, bates);
      const glyphs = new Set(font!.getCharacterSet()); if ([...text].some(character => !glyphs.has(character.codePointAt(0)!))) utilityFail('font-unavailable');
      const width = font!.widthOfTextAtSize(text, size);
      if (width > geometry.width - 2 * margin || size + 2 * margin > geometry.height) utilityFail('invalid-request');
      resources.set(key('Font'), doc.context.obj({ F: font!.ref }));
      const x = watermark ? geometry.width / 2 : spec.align === 'left' ? margin : spec.align === 'right' ? geometry.width - margin - width : (geometry.width - width) / 2;
      const y = watermark ? geometry.height / 2 : spec.kind === 'header' ? geometry.height - margin - size : margin;
      commands += `${c} ${s} ${-s} ${c} ${x} ${y} cm BT /F ${size} Tf 1 0 0 1 ${watermark ? -width / 2 : 0} ${watermark ? -size / 2 : 0} Tm ${font!.encodeText(text)} Tj ET\n`;
    }
    commands += 'Q';
    const form = doc.context.register(doc.context.flateStream(commands, { Type: 'XObject', Subtype: 'Form', BBox: [page.getMediaBox().x, page.getMediaBox().y, page.getMediaBox().x + page.getMediaBox().width, page.getMediaBox().y + page.getMediaBox().height], Resources: resources }));
    const name = page.node.newXObject('ZPDF_Furniture', form);
    const stream = doc.context.register(doc.context.flateStream(`q ${name} Do Q`, { ZPDFManagedFurniture: PDFString.of(spec.id) }));
    // Isolate furniture from unbalanced source graphics state, just as pdf-lib's normal append path does.
    page.node.normalize(); page.node.addContentStream(stream);
  }
  signal?.throwIfAborted(); const result = await doc.save({ updateFieldAppearances: false }); signal?.throwIfAborted(); return result;
}
