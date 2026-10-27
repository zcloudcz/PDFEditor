import { afterEach, expect, it, vi } from 'vitest';
import { prepareImageCutoutDraft } from './mask-editor';
import { editedImageDataUrl } from './image-effects';
import type { StudioObject } from './types';
import type { ImageCutout } from './image-masks';
vi.mock('./image-effects', () => ({ editedImageDataUrl: vi.fn(async () => 'data:image/png;base64,processed') }));
const image = (): StudioObject => ({ id: 'image', kind: 'image', name: 'Image', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false, src: 'data:image/png;base64,original' });
const mask = (): ImageCutout => ({ version: 1, strokes: [{ mode: 'remove', radius: .2, points: Array.from({ length: 42 }, (_, i) => ({ x: i % 2, y: .5 })) }] });
afterEach(() => vi.mocked(editedImageDataUrl).mockReset());
it('does not return or mutate a mask edit when the real rendering stage refuses its complexity', async () => {
  const original = image(), before = structuredClone(original);
  vi.mocked(editedImageDataUrl).mockRejectedValueOnce(new Error('Cutout brush complexity exceeds limit.'));
  await expect(prepareImageCutoutDraft(original, mask(), new AbortController().signal)).rejects.toThrow('complexity');
  expect(original).toEqual(before);
});
it('preflights immutable draft pixels before allowing an edit, and honors cancellation', async () => {
  const original = image(), edit = mask(), abort = new AbortController();
  vi.mocked(editedImageDataUrl).mockResolvedValueOnce('data:image/png;base64,processed');
  const next = await prepareImageCutoutDraft(original, edit, abort.signal);
  expect(editedImageDataUrl).toHaveBeenCalledWith(next, 2, abort.signal);
  expect(next.src).toBe(original.src);
  expect(original.imageCutout).toBeUndefined();
  edit.strokes[0].points[0].x = .4;
  expect(next.imageCutout?.strokes[0].points[0].x).toBe(0);
  abort.abort();
  await expect(prepareImageCutoutDraft(original, mask(), abort.signal)).rejects.toThrow();
});
