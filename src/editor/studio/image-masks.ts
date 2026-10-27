import type { StudioObject } from './types';

export type ImageMask = NonNullable<StudioObject['imageMask']>;

/** Coordinates are fractions of the EXIF-oriented original image. No pixel payload is stored. */
export interface ImageCutout {
  version: 1;
  seed?: { x: number; y: number; tolerance: number };
  strokes: Array<{ mode: 'keep' | 'remove'; radius: number; points: Array<{ x: number; y: number }> }>;
}
const point = (value: unknown): value is { x: number; y: number } => !!value && typeof value === 'object' &&
  Object.keys(value).length === 2 && Object.keys(value).every(key => key === 'x' || key === 'y') &&
  Number.isFinite((value as { x: number }).x) && Number.isFinite((value as { y: number }).y) &&
  (value as { x: number }).x >= 0 && (value as { x: number }).x <= 1 &&
  (value as { y: number }).y >= 0 && (value as { y: number }).y <= 1;

export function validateImageCutout(value: unknown): value is ImageCutout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mask = value as Partial<ImageCutout>;
  if (mask.version !== 1 || Object.keys(mask).some(key => !['version', 'seed', 'strokes'].includes(key)) ||
      !Array.isArray(mask.strokes) || mask.strokes.length > 128) return false;
  if (mask.seed !== undefined && (!point({ x: mask.seed?.x, y: mask.seed?.y }) ||
      !Number.isFinite(mask.seed?.tolerance) || mask.seed!.tolerance < 0 || mask.seed!.tolerance > 1 ||
      Object.keys(mask.seed).some(key => !['x', 'y', 'tolerance'].includes(key)))) return false;
  let total = 0;
  for (const stroke of mask.strokes) {
    if (!stroke || typeof stroke !== 'object' || !['keep', 'remove'].includes(stroke.mode) ||
        !Number.isFinite(stroke.radius) || stroke.radius <= 0 || stroke.radius > 0.2 ||
        Object.keys(stroke).some(key => !['mode', 'radius', 'points'].includes(key)) ||
        !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 512 ||
        !stroke.points.every(point)) return false;
    total += stroke.points.length;
    if (total > 4096) return false;
  }
  return mask.seed !== undefined || mask.strokes.length > 0;
}

/** Clip before drawing so rounded and circular corners retain real alpha. */
export function clipImageMask(ctx: CanvasRenderingContext2D, width: number, height: number, mask?: ImageMask): void {
  if (!mask) return;
  ctx.beginPath();
  if (mask.kind === 'circle') {
    ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
  } else {
    const radius = Math.min(width, height) * mask.radius;
    ctx.moveTo(radius, 0);
    ctx.lineTo(width - radius, 0); ctx.quadraticCurveTo(width, 0, width, radius);
    ctx.lineTo(width, height - radius); ctx.quadraticCurveTo(width, height, width - radius, height);
    ctx.lineTo(radius, height); ctx.quadraticCurveTo(0, height, 0, height - radius);
    ctx.lineTo(0, radius); ctx.quadraticCurveTo(0, 0, radius, 0);
  }
  ctx.closePath(); ctx.clip();
}
