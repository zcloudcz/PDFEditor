// @vitest-environment node
import { expect, it } from 'vitest';
import { AssetStore, decodeAsset } from './asset-store';
import { migrateProject, toStudioProject } from './migrations';
import { validateProjectV2 } from './project-v2';
import type { StudioProject } from '../studio/types';

it('deduplicates 100 repeated image instances and preserves all references', async () => {
  const source: StudioProject = { version: 1, name: 'Repeated images', pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [] }] };
  const src = `data:image/png;base64,${btoa('x'.repeat(10000))}`;
  source.pages[0].objects = Array.from({ length: 100 }, (_, i) => ({ id: `image-${i}`, kind: 'image', name: 'Image', src, x: 0, y: 0, width: 20, height: 20, rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false }));
  const v2 = await migrateProject(source);
  expect(Object.values(v2.assets).filter(a => a.mime === 'image/png')).toHaveLength(1);
  expect(JSON.stringify(v2).length).toBeLessThan(JSON.stringify(source).length / 10);
  expect(await toStudioProject(v2)).toEqual(source);
  delete v2.assets[v2.sections[0].pages[0].objects[0].assetId!];
  await expect(validateProjectV2(v2)).rejects.toThrow(/asset/i);
});
it('copies asset data and rejects external URLs and MIME conflicts', async () => {
  const store = new AssetStore();
  await expect(store.addDataUrl('https://example.com/image.png')).rejects.toThrow();
  const bytes = new Uint8Array([1, 2, 3]);
  const id = await store.add(bytes, 'image/png'); bytes[0] = 9;
  expect(store.get(id)).toEqual(new Uint8Array([1, 2, 3]));
  await expect(store.add(new Uint8Array([1, 2, 3]), 'image/jpeg')).rejects.toThrow();
});
it('bounds distinct assets while allowing repeated references at the limit', async () => {
  const store = new AssetStore();
  const bytes = (i: number) => new Uint8Array([i & 255, i >>> 8]);
  await Promise.all(Array.from({ length: 10001 }, (_, i) => store.add(bytes(i), 'image/png')));
  const repeated = await store.add(bytes(0), 'image/png');
  expect(store.get(repeated)).toEqual(bytes(0));
  await expect(store.add(bytes(10001), 'image/png')).rejects.toThrow(/too many assets/i);
  expect(Object.keys(store.snapshot())).toHaveLength(10001);
});
it('decodes assets over 4 MB (the old regex overflowed) and still rejects malformed base64', () => {
  const pdf = new Uint8Array(6_000_000).fill(7);
  pdf.set([0x25, 0x50, 0x44, 0x46]);
  const base64 = Buffer.from(pdf).toString('base64');
  expect(Buffer.from(decodeAsset(base64)).equals(Buffer.from(pdf))).toBe(true);
  for (const bad of ['A===', 'AB=C', 'ABC', 'AB==AAAA', 'AA-A', 'AAA']) expect(() => decodeAsset(bad)).toThrow('Invalid embedded asset');
});
