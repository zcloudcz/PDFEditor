import { bytesBase64 } from './project-validation';
import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, assertImageDimensions, encodedImageDimensions, readExifOrientation } from './image-effects';
import type { StudioObject } from './types';

export interface EmbeddedImage {
  id: string;
  src: string;
  width: number;
  height: number;
  exifOrientation: number;
  provenance: NonNullable<StudioObject['imageProvenance']>;
}
type Decoder = (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
const browserDecode: Decoder = blob => createImageBitmap(blob, { imageOrientation: 'from-image' });
const declared = (value: unknown): value is NonNullable<StudioObject['imageProvenance']> => {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Partial<NonNullable<StudioObject['imageProvenance']>>;
  return (meta.kind === 'local-upload' && meta.license === 'unspecified' && meta.source === 'local upload') ||
    (meta.kind === 'user-declared' && typeof meta.license === 'string' && meta.license.trim().length > 0 && meta.license.length <= 100 &&
    typeof meta.source === 'string' && meta.source.trim().length > 0 && meta.source.length <= 500);
};
const signatureMatches = (mime: string, bytes: Uint8Array) => mime === 'image/png'
  ? bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)
  : mime === 'image/jpeg'
    ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
    : mime === 'image/webp' && bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';

export function validateEmbeddedImage(value: unknown): value is EmbeddedImage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<EmbeddedImage>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200 &&
    typeof item.src === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.src) &&
    item.src.length <= Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 50 &&
    Number.isInteger(item.width) && item.width! > 0 && item.width! <= MAX_IMAGE_EDGE &&
    Number.isInteger(item.height) && item.height! > 0 && item.height! <= MAX_IMAGE_EDGE &&
    item.width! * item.height! <= MAX_IMAGE_PIXELS &&
    Number.isInteger(item.exifOrientation) && item.exifOrientation! >= 1 && item.exifOrientation! <= 8 && declared(item.provenance);
}

export async function importEmbeddedImage(
  blob: Blob, details: { license: string; source: string } | undefined, signal: AbortSignal, decode: Decoder = browserDecode,
): Promise<EmbeddedImage> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const provenance: NonNullable<StudioObject['imageProvenance']> = details
    ? { kind: 'user-declared', license: details.license.trim(), source: details.source.trim() }
    : { kind: 'local-upload', license: 'unspecified', source: 'local upload' };
  if (!declared(provenance) || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) throw new Error('Unsupported image asset.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!signatureMatches(blob.type, bytes)) throw new Error('Invalid image signature.');
  const encoded = encodedImageDimensions(blob.type, bytes);
  assertImageDimensions(encoded.width, encoded.height);
  const bitmap = await decode(blob);
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const { width, height } = bitmap;
    assertImageDimensions(width, height);
    const image: EmbeddedImage = {
      id: crypto.randomUUID(), src: `data:${blob.type};base64,${bytesBase64(bytes)}`, width, height,
      exifOrientation: blob.type === 'image/jpeg' ? readExifOrientation(bytes) : 1,
      provenance,
    };
    return image;
  } finally { bitmap.close?.(); }
}
