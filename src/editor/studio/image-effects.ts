import type { StudioObject } from './types';
import { clipImageMask } from './image-masks';
import type { ImageCutout } from './image-masks';
import { MAX_CUTOUT_EDGE, segmentBackground } from './background-segmentation';
import { base64Bytes, bytesBase64 } from './project-validation';

export type ImageEdits = {
  crop?: NonNullable<StudioObject['crop']>;
  fit?: NonNullable<StudioObject['imageFit']>;
  mask?: NonNullable<StudioObject['imageMask']>;
  adjustments?: NonNullable<StudioObject['imageAdjustments']>;
  cutout?: ImageCutout;
};
export interface EmbeddedImageAsset { blob: Blob; boxWidth: number; boxHeight: number }
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_EDGE = 8192;
const whole = { x: 0, y: 0, width: 1, height: 1 };
const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const u32be = (bytes: Uint8Array, offset: number) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
export function encodedImageDimensions(mime: string, bytes: Uint8Array): { width: number; height: number } {
  if (mime === 'image/png' && bytes.length >= 24 && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR')
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  if (mime === 'image/jpeg') {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at] !== 0xff) break;
      const marker = bytes[at + 1], length = u16be(bytes, at + 2);
      if (length < 2 || at + 2 + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))
        return { width: u16be(bytes, at + 7), height: u16be(bytes, at + 5) };
      at += 2 + length;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return { width: (bytes[26] | bytes[27] << 8) & 0x3fff, height: (bytes[28] | bytes[29] << 8) & 0x3fff };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)) };
  }
  throw new Error('Unsupported image dimensions.');
}
export function assertImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) throw new Error('Image dimensions exceed limit.');
}

export function fitCropToBox(sourceWidth: number, sourceHeight: number, boxWidth: number, boxHeight: number, fit: 'stretch' | 'contain' | 'cover') {
  if (![sourceWidth, sourceHeight, boxWidth, boxHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid image dimensions.');
  if (fit !== 'cover') return { ...whole };
  const sourceRatio = sourceWidth / sourceHeight, boxRatio = boxWidth / boxHeight;
  if (sourceRatio > boxRatio) { const width = boxRatio / sourceRatio; return { x: (1 - width) / 2, y: 0, width, height: 1 }; }
  const height = sourceRatio / boxRatio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function replaceImagePreservingBox<T extends { src?: string; imageCutout?: unknown }>(object: T, source: string): T {
  const next = { ...structuredClone(object), src: source };
  delete next.imageCutout;
  return next;
}
export function resetImageEdits<T extends { crop?: unknown; imageFit?: unknown; imageMask?: unknown; imageAdjustments?: unknown; imageCutout?: unknown }>(object: T): T {
  const next = structuredClone(object);
  delete next.crop; delete next.imageFit; delete next.imageMask; delete next.imageAdjustments; delete next.imageCutout;
  return next;
}

/** Source is never changed. Draw into a separate canvas using normalized crop coordinates. */
export function drawEditedImage(
  ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number,
  edits: ImageEdits, boxWidth: number, boxHeight: number,
): void {
  if (![sourceWidth, sourceHeight, boxWidth, boxHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid image dimensions.');
  const crop = edits.crop ?? whole;
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 ||
      crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) throw new Error('Invalid image crop.');
  const fit = edits.fit ?? 'stretch';
  const selection = fitCropToBox(sourceWidth * crop.width, sourceHeight * crop.height, boxWidth, boxHeight, fit);
  const sx = (crop.x + crop.width * selection.x) * sourceWidth;
  const sy = (crop.y + crop.height * selection.y) * sourceHeight;
  const sw = crop.width * selection.width * sourceWidth;
  const sh = crop.height * selection.height * sourceHeight;
  const ratio = Math.min(boxWidth / sw, boxHeight / sh);
  const dw = fit === 'contain' ? sw * ratio : boxWidth;
  const dh = fit === 'contain' ? sh * ratio : boxHeight;
  ctx.save();
  try {
    clipImageMask(ctx, boxWidth, boxHeight, edits.mask);
    const fx = edits.adjustments;
    if (fx) ctx.filter = `brightness(${fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation}) blur(${fx.blur}px)`;
    ctx.drawImage(source, sx, sy, sw, sh, (boxWidth - dw) / 2, (boxHeight - dh) / 2, dw, dh);
  } finally { ctx.restore(); }
}

/** Browser decoders apply the JPEG EXIF orientation; inspect it for provenance/tests. */
export function readExifOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  for (let cursor = 2; cursor + 4 < bytes.length;) {
    if (bytes[cursor] !== 0xff) break;
    const marker = bytes[cursor + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    if (length < 2 || cursor + 2 + length > bytes.length) break;
    const start = cursor + 4;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(start, start + 6)) === 'Exif\0\0') {
      const tiff = start + 6, little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
      const u16 = (at: number) => little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
      const u32 = (at: number) => little ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
        : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      const end = cursor + 2 + length, ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > end) return 1;
      for (let i = 0, count = u16(ifd); i < count && ifd + 2 + (i + 1) * 12 <= end; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
          const orientation = u16(entry + 8);
          return orientation >= 1 && orientation <= 8 ? orientation : 1;
        }
      }
    }
    cursor += 2 + length;
  }
  return 1;
}

export async function renderEditedImage(asset: EmbeddedImageAsset, edits: ImageEdits, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.blob.type) || asset.blob.size > MAX_IMAGE_BYTES) throw new Error('Unsupported image asset.');
  if (![asset.boxWidth, asset.boxHeight].every(value => Number.isFinite(value) && value > 0 && value <= MAX_IMAGE_EDGE) ||
      asset.boxWidth * asset.boxHeight > MAX_IMAGE_PIXELS) throw new Error('Image output exceeds size limit.');
  const encoded = encodedImageDimensions(asset.blob.type, new Uint8Array(await asset.blob.arrayBuffer()));
  assertImageDimensions(encoded.width, encoded.height);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const bitmap = await createImageBitmap(asset.blob, { imageOrientation: 'from-image' });
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    assertImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(asset.boxWidth)); canvas.height = Math.max(1, Math.round(asset.boxHeight));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable.');
    const source = edits.cutout ? await cutoutSource(bitmap, bitmap.width, bitmap.height, edits.cutout, signal) : bitmap;
    drawEditedImage(ctx, source, bitmap.width, bitmap.height, edits, canvas.width, canvas.height);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encode failed.')), 'image/png'));
  } finally { bitmap.close(); }
}

export async function editedImageDataUrl(object: StudioObject, scale = 2, signal = new AbortController().signal): Promise<string> {
  if (object.kind !== 'image' || !object.src) throw new Error('Image source is missing.');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(object.src);
  if (!match) throw new Error('Invalid image source.');
  const raw = base64Bytes(match[2]);
  const bytes = Uint8Array.from(raw);
  const blob = await renderEditedImage({ blob: new Blob([bytes], { type: match[1] }), boxWidth: Math.max(1, Math.ceil(object.width * scale)), boxHeight: Math.max(1, Math.ceil(object.height * scale)) },
    { crop: object.crop, fit: object.imageFit, mask: object.imageMask, adjustments: object.imageAdjustments, cutout: object.imageCutout }, signal);
  return `data:image/png;base64,${bytesBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/** Mask the EXIF-oriented original before crop, fit, clipping and filters. */
export async function cutoutSource(source: CanvasImageSource, width: number, height: number, cutout: ImageCutout, signal: AbortSignal): Promise<HTMLCanvasElement> {
  assertImageDimensions(width, height);
  signal.throwIfAborted();
  const scale = Math.min(1, MAX_CUTOUT_EDGE / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale)), sampleHeight = Math.max(1, Math.round(height * scale));
  const sample = document.createElement('canvas'); sample.width = sampleWidth; sample.height = sampleHeight;
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  if (!sampleContext) throw new Error('Canvas unavailable.');
  sampleContext.drawImage(source, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
  const alpha = await segmentBackground(pixels, cutout, signal);
  signal.throwIfAborted();
  // The full-resolution original is drawn once; the bounded alpha map is scaled onto it.
  const mask = document.createElement('canvas'); mask.width = sampleWidth; mask.height = sampleHeight;
  const maskContext = mask.getContext('2d'); if (!maskContext) throw new Error('Canvas unavailable.');
  const maskPixels = maskContext.createImageData(sampleWidth, sampleHeight);
  for (let at = 0; at < alpha.length; at++) {
    maskPixels.data[at * 4] = 255; maskPixels.data[at * 4 + 1] = 255;
    maskPixels.data[at * 4 + 2] = 255; maskPixels.data[at * 4 + 3] = alpha[at];
  }
  maskContext.putImageData(maskPixels, 0, 0);
  const result = document.createElement('canvas'); result.width = width; result.height = height;
  const context = result.getContext('2d'); if (!context) throw new Error('Canvas unavailable.');
  context.drawImage(source, 0, 0, width, height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(mask, 0, 0, width, height);
  signal.throwIfAborted();
  return result;
}
