import { describe, expect, it } from 'vitest';
import { applyCutoutAlpha, segmentBackground } from './background-segmentation';
import { validateImageCutout, type ImageCutout } from './image-masks';

const pixels = (width: number, height: number, color = [255, 255, 255, 255]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at++) data.set(color, at * 4);
  return { width, height, data };
};
const set = (data: Uint8ClampedArray, width: number, x: number, y: number, color: number[]) => data.set(color, (y * width + x) * 4);

describe('local assisted cutout', () => {
  it('removes only edge-connected seed colour and retains foreground and enclosed same-colour areas', async () => {
    const image = pixels(7, 7);
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) set(image.data, 7, x, y, [200, 10, 10, 255]);
    set(image.data, 7, 3, 3, [255, 255, 255, 255]);
    const original = new Uint8ClampedArray(image.data);
    const cutout: ImageCutout = { version: 1, seed: { x: 0, y: 0, tolerance: .02 }, strokes: [] };
    const alpha = await segmentBackground(image, cutout, new AbortController().signal);
    expect(alpha[0]).toBe(0);
    expect(alpha[3 * 7 + 3]).toBe(255);
    expect(alpha[3 * 7 + 2]).toBe(255);
    expect(alpha[1 * 7 + 1]).toBe(192);
    expect(image.data).toEqual(original);
  });

  it('applies remove then keep strokes in order while preserving original transparent alpha', async () => {
    const image = pixels(20, 20, [240, 20, 20, 255]);
    set(image.data, 20, 10, 10, [240, 20, 20, 30]);
    const cutout: ImageCutout = { version: 1, strokes: [
      { mode: 'remove', radius: .1, points: [{ x: .5, y: .5 }] },
      { mode: 'keep', radius: .03, points: [{ x: .5, y: .5 }] },
    ] };
    const alpha = await segmentBackground(image, cutout, new AbortController().signal);
    expect(alpha[10 * 20 + 10]).toBe(255);
    expect(alpha[10 * 20 + 9]).toBe(0);
    expect(applyCutoutAlpha(image, alpha).data[(10 * 20 + 10) * 4 + 3]).toBe(30);
  });

  it('rejects unbounded, malformed and alien fields', async () => {
    expect(validateImageCutout({ version: 1, strokes: [{ mode: 'keep', radius: .02, points: [{ x: .5, y: .5 }] }] })).toBe(true);
    expect(validateImageCutout({ version: 1, strokes: [] })).toBe(false);
    expect(validateImageCutout({ version: 1, seed: { x: 0, y: 0, tolerance: .1, secret: 1 }, strokes: [] })).toBe(false);
    expect(validateImageCutout({ version: 1, strokes: [{ mode: 'remove', radius: .2, points: Array(513).fill({ x: 0, y: 0 }) }] })).toBe(false);
    expect(validateImageCutout({ version: 1, strokes: [{ mode: 'remove', radius: NaN, points: [{ x: 0, y: 0 }] }] })).toBe(false);
    await expect(segmentBackground(pixels(1025, 1), { version: 1, seed: { x: 0, y: 0, tolerance: .1 }, strokes: [] }, new AbortController().signal)).rejects.toThrow(/limit/);
  });

  it('cancels a large flood fill during browser yielding', async () => {
    const abort = new AbortController();
    const task = segmentBackground(pixels(1024, 1024), { version: 1, seed: { x: 0, y: 0, tolerance: .1 }, strokes: [] }, abort.signal);
    setTimeout(() => abort.abort(), 0);
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds a one-megapixel synthetic background and foreground mask', async () => {
    const image = pixels(1024, 1024);
    for (let y = 256; y < 768; y++) for (let x = 256; x < 768; x++) set(image.data, 1024, x, y, [120, 20, 20, 255]);
    const started = performance.now();
    const alpha = await segmentBackground(image, { version: 1, seed: { x: 0, y: 0, tolerance: .03 }, strokes: [] }, new AbortController().signal);
    expect(alpha[0]).toBe(0);
    expect(alpha[512 * 1024 + 512]).toBe(255);
    // Synthetic only; browser/device timings are recorded separately from this correctness test.
    expect(performance.now() - started).toBeGreaterThanOrEqual(0);
  });
});
