import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawEditedImage, fitCropToBox, readExifOrientation, resetImageEdits, replaceImagePreservingBox } from './image-effects';

describe('nondestructive image effects', () => {
  it('uses cover crop without stretching and contain letterboxes within the box', () => {
    expect(fitCropToBox(400, 200, 100, 100, 'cover')).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(fitCropToBox(400, 200, 100, 100, 'stretch')).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const source = createCanvas(4, 2); const sc = source.getContext('2d');
    sc.fillStyle = 'red'; sc.fillRect(0, 0, 4, 2);
    const output = createCanvas(4, 4);
    drawEditedImage(output.getContext('2d') as unknown as CanvasRenderingContext2D, source as unknown as CanvasImageSource, 4, 2,
      { fit: 'contain' }, 4, 4);
    const data = output.getContext('2d').getImageData(0, 0, 4, 4).data;
    expect(data[3]).toBe(0);
    expect(data[(1 * 4 + 1) * 4]).toBeGreaterThan(200);
  });

  it('clips circle corners to transparent alpha and changes brightness without changing the source', () => {
    const source = createCanvas(20, 20); const sc = source.getContext('2d');
    sc.fillStyle = 'rgb(80,80,80)'; sc.fillRect(0, 0, 20, 20);
    const output = createCanvas(20, 20);
    drawEditedImage(output.getContext('2d') as unknown as CanvasRenderingContext2D, source as unknown as CanvasImageSource, 20, 20,
      { mask: { kind: 'circle' }, adjustments: { brightness: 2, contrast: 1, saturation: 1, blur: 0 } }, 20, 20);
    const data = output.getContext('2d').getImageData(0, 0, 20, 20).data;
    expect(data[3]).toBe(0);
    expect(data[(10 * 20 + 10) * 4]).toBeGreaterThan(80);
    expect(source.getContext('2d').getImageData(10, 10, 1, 1).data[0]).toBe(80);
  });

  it('replaces only the image source and resets all edits on request', () => {
    const original = { id: 'x', width: 120, height: 80, x: 10, y: 20, src: 'old', crop: { x: .1, y: .2, width: .5, height: .5 }, imageCutout: { version: 1 as const, seed: { x: 0, y: 0, tolerance: .1 }, strokes: [] as [] } };
    const replaced = replaceImagePreservingBox(original, 'new');
    expect(replaced).toMatchObject({ id: 'x', x: 10, y: 20, width: 120, height: 80, src: 'new', crop: original.crop });
    expect(replaced.imageCutout).toBeUndefined();
    expect(original.imageCutout.seed.tolerance).toBe(.1);
    expect(resetImageEdits(replaced)).toEqual({ id: 'x', width: 120, height: 80, x: 10, y: 20, src: 'new' });
  });

  it('reads JPEG EXIF orientation without using file names', () => {
    const bytes = Uint8Array.from([0xff,0xd8,0xff,0xe1,0,0x22,0x45,0x78,0x69,0x66,0,0,0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0,0xff,0xd9]);
    expect(readExifOrientation(bytes)).toBe(6);
  });
});
