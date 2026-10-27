import { type ImageCutout, validateImageCutout } from './image-masks';

/** Deliberately bounded, deterministic colour flood fill, not a learned subject detector. */
export const MAX_CUTOUT_EDGE = 1024;
export const MAX_CUTOUT_PIXELS = 1_048_576;
export const MAX_BRUSH_VISITS = 16_000_000;
export interface CutoutPixels { width: number; height: number; data: Uint8ClampedArray }
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function segmentBackground(pixels: CutoutPixels, cutout: ImageCutout, signal: AbortSignal): Promise<Uint8ClampedArray> {
  if (!validateImageCutout(cutout)) throw new Error('Invalid image cutout.');
  const { width, height, data } = pixels;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_CUTOUT_EDGE || height > MAX_CUTOUT_EDGE || width * height > MAX_CUTOUT_PIXELS || data.length !== width * height * 4)
    throw new Error('Cutout dimensions exceed limit.');
  cancelled(signal);
  const count = width * height;
  const alpha = new Uint8ClampedArray(count); alpha.fill(255);
  const seed = cutout.seed;
  if (seed) {
    const sx = Math.min(width - 1, Math.floor(seed.x * width));
    const sy = Math.min(height - 1, Math.floor(seed.y * height));
    const origin = (sy * width + sx) * 4;
    const r = data[origin], g = data[origin + 1], b = data[origin + 2];
    // tolerance is a fraction of the maximum RGB Euclidean distance.
    const distanceSquared = 3 * 255 * 255 * seed.tolerance * seed.tolerance;
    const queue = new Int32Array(count);
    const visited = new Uint8Array(count);
    let head = 0, tail = 0;
    queue[tail++] = sy * width + sx; visited[sy * width + sx] = 1;
    while (head < tail) {
      if ((head & 32767) === 0) { cancelled(signal); await yieldToBrowser(); cancelled(signal); }
      const at = queue[head++], offset = at * 4;
      const dr = data[offset] - r, dg = data[offset + 1] - g, db = data[offset + 2] - b;
      if (dr * dr + dg * dg + db * db > distanceSquared) continue;
      alpha[at] = 0;
      const x = at % width, y = (at - x) / width;
      const visit = (next: number) => { if (!visited[next]) { visited[next] = 1; queue[tail++] = next; } };
      if (x > 0) visit(at - 1);
      if (x + 1 < width) visit(at + 1);
      if (y > 0) visit(at - width);
      if (y + 1 < height) visit(at + width);
    }
    // One-pixel transition preserves partially transparent subject edges.
    for (let y = 0; y < height; y++) {
      if ((y & 63) === 0) { cancelled(signal); await yieldToBrowser(); cancelled(signal); }
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if (alpha[at] === 0) continue;
        if ((x > 0 && alpha[at - 1] === 0) || (x + 1 < width && alpha[at + 1] === 0) ||
            (y > 0 && alpha[at - width] === 0) || (y + 1 < height && alpha[at + width] === 0)) alpha[at] = 192;
      }
    }
  }
  let brushVisits = 0, nextYield = 65_536;
  for (const stroke of cutout.strokes) {
    cancelled(signal);
    const radius = Math.max(0.5, stroke.radius * Math.min(width, height));
    const radius2 = radius * radius;
    const segments = stroke.points.length === 1 ? [[stroke.points[0], stroke.points[0]]] :
      stroke.points.slice(1).map((point, index) => [stroke.points[index], point]);
    for (const [a, b] of segments) {
      cancelled(signal);
      const ax = Math.min(width - 1, a.x * width), ay = Math.min(height - 1, a.y * height);
      const bx = Math.min(width - 1, b.x * width), by = Math.min(height - 1, b.y * height);
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const left = Math.max(0, Math.floor(Math.min(ax, bx) - radius)), right = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius));
      const top = Math.max(0, Math.floor(Math.min(ay, by) - radius)), bottom = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius));
      for (let y = top; y <= bottom; y++) {
        brushVisits += right - left + 1;
        if (brushVisits > MAX_BRUSH_VISITS) throw new Error('Cutout brush complexity exceeds limit.');
        if (brushVisits >= nextYield) { cancelled(signal); await yieldToBrowser(); cancelled(signal); nextYield = brushVisits + 65_536; }
        for (let x = left; x <= right; x++) {
          const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
          const ex = x - (ax + dx * t), ey = y - (ay + dy * t);
          if (ex * ex + ey * ey <= radius2) alpha[y * width + x] = stroke.mode === 'keep' ? 255 : 0;
        }
      }
    }
  }
  cancelled(signal);
  return alpha;
}

/** Source alpha is multiplied, so a keep stroke cannot turn transparent source pixels opaque. */
export function applyCutoutAlpha(pixels: CutoutPixels, alpha: Uint8ClampedArray): CutoutPixels {
  if (alpha.length !== pixels.width * pixels.height) throw new Error('Invalid cutout alpha.');
  const data = new Uint8ClampedArray(pixels.data);
  for (let at = 0; at < alpha.length; at++) data[at * 4 + 3] = Math.round(data[at * 4 + 3] * alpha[at] / 255);
  return { width: pixels.width, height: pixels.height, data };
}
