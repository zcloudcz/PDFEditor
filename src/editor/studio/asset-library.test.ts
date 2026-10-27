import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { importEmbeddedImage, validateEmbeddedImage } from './asset-library';

describe('local image asset import', () => {
  it('accepts a real PNG, records declared provenance, and preserves original bytes', async () => {
    const canvas = createCanvas(4, 3); canvas.getContext('2d').fillRect(0, 0, 4, 3);
    const bytes = canvas.toBuffer('image/png');
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
    const image = await importEmbeddedImage(blob, { license: 'CC0-1.0', source: 'Created by me' }, new AbortController().signal,
      async input => { const decoded = await loadImage(Buffer.from(await input.arrayBuffer())); return { width: decoded.width, height: decoded.height }; });
    expect(image.width).toBe(4); expect(image.height).toBe(3);
    expect(image.provenance).toEqual({ kind: 'user-declared', license: 'CC0-1.0', source: 'Created by me' });
    expect(Buffer.from(image.src.split(',')[1], 'base64')).toEqual(bytes);
    expect(validateEmbeddedImage(image)).toBe(true);
  });

  it('rejects spoofed MIME, oversized dimensions, and missing provenance', async () => {
    const canvas = createCanvas(4, 3); const bytes = canvas.toBuffer('image/png');
    const jpegClaim = new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' });
    const probe = async () => ({ width: 4, height: 3 });
    await expect(importEmbeddedImage(jpegClaim, { license: 'CC0-1.0', source: 'Me' }, new AbortController().signal, probe)).rejects.toThrow();
    const png = new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
    await expect(importEmbeddedImage(png, { license: 'CC0-1.0', source: 'Me' }, new AbortController().signal, async () => ({ width: 20000, height: 20000 }))).rejects.toThrow();
    await expect(importEmbeddedImage(png, { license: '', source: 'Me' }, new AbortController().signal, probe)).rejects.toThrow();
  });

  it('rejects a declared huge PNG before invoking the decoder', async () => {
    const canvas = createCanvas(4, 3);
    const bytes = Uint8Array.from(canvas.toBuffer('image/png'));
    bytes.set([0, 0, 0x4e, 0x20], 16); // 20,000-pixel IHDR width; decoder must never see it.
    let decoded = false;
    await expect(importEmbeddedImage(new Blob([bytes], { type: 'image/png' }),
      { license: 'CC0-1.0', source: 'Me' }, new AbortController().signal,
      async () => { decoded = true; return { width: 4, height: 3 }; })).rejects.toThrow();
    expect(decoded).toBe(false);
  });

  it('records EXIF orientation from a decodable JPEG without rewriting the original', async () => {
    const canvas = createCanvas(3, 2); canvas.getContext('2d').fillRect(0, 0, 3, 2);
    const jpeg = Uint8Array.from(canvas.toBuffer('image/jpeg'));
    const exif = Uint8Array.from([0xff,0xe1,0,0x22,0x45,0x78,0x69,0x66,0,0,0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const oriented = Uint8Array.from([...jpeg.subarray(0, 2), ...exif, ...jpeg.subarray(2)]);
    const image = await importEmbeddedImage(new Blob([oriented], { type: 'image/jpeg' }),
      { license: 'CC0-1.0', source: 'Created by me' }, new AbortController().signal,
      async input => { const decoded = await loadImage(Buffer.from(await input.arrayBuffer())); return { width: decoded.width, height: decoded.height }; });
    expect(image.exifOrientation).toBe(6);
    expect(Buffer.from(image.src.split(',')[1], 'base64')).toEqual(Buffer.from(oriented));
  });

  it('imports a private local upload without asking the user for license metadata', async () => {
    const canvas = createCanvas(2, 2);
    const blob = new Blob([Uint8Array.from(canvas.toBuffer('image/png'))], { type: 'image/png' });
    const image = await importEmbeddedImage(blob, undefined, new AbortController().signal,
      async input => { const decoded = await loadImage(Buffer.from(await input.arrayBuffer())); return { width: decoded.width, height: decoded.height }; });
    expect(image.provenance).toEqual({ kind: 'local-upload', license: 'unspecified', source: 'local upload' });
  });
});
