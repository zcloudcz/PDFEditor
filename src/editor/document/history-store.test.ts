// @vitest-environment node
import { expect, it } from 'vitest';
import { HistoryStore } from './history-store';
import type { DocumentCheckpoint } from './coordinator';
import type { StudioProject } from '../studio/types';
import { createHash } from 'node:crypto';

const image = `data:image/png;base64,${btoa('same image'.repeat(1000))}`;
const pdf = btoa('%PDF-1.7\nshared source');
function checkpoint(revision: number, count = 100): DocumentCheckpoint {
  const project: StudioProject = {
    version: 1, name: `revision ${revision}`, sourcePdf: pdf,
    pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', sourcePageIndex: 0,
      objects: Array.from({ length: count }, (_, i) => ({ id: `image-${i}`, kind: 'image', name: 'Image', src: image, x: i, y: 0, width: 20, height: 20, rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false })) }],
  };
  return { revision, nativeRevision: revision, project };
}
it('keeps 100 repeated images and unchanged source PDF once across 80 states', () => {
  let history = HistoryStore.create(80);
  const original = checkpoint(0);
  for (let i = 0; i < 100; i++) history = history.recorded(checkpoint(i));
  expect(history.stateCount).toBe(80);
  expect(history.mediaCount).toBe(2);
  expect(history.mediaCharacters).toBe(image.split(',')[1].length + pdf.length);
  const storedStates = JSON.stringify(Reflect.get(history, 'states'));
  expect(storedStates.length + history.mediaCharacters).toBeLessThan(JSON.stringify(checkpoint(99)).length * 80 / 20);
  const media = Reflect.get(history, 'media') as Map<string, string>;
  for (const [hash, payload] of media) expect(hash).toBe(createHash('sha256').update(payload).digest('hex'));
  expect(history.at(79)?.project.pages[0].objects).toHaveLength(100);
  expect(history.at(79)?.project).toEqual(checkpoint(99).project);
  expect(original.project).toEqual(checkpoint(0).project);
  const previous = history.at(0)!;
  previous.project.pages[0].objects[0].src = 'damaged';
  expect(history.at(0)?.project.pages[0].objects[0].src).toBe(image);
});
it('drops assets only after their last state or redo branch is gone', () => {
  let history = HistoryStore.create(3);
  history = history.recorded(checkpoint(0));
  const changed = checkpoint(1); changed.project.pages[0].objects[0].src = `data:image/png;base64,${btoa('second')}`;
  history = history.recorded(changed);
  expect(history.mediaCount).toBe(3);
  history = history.moved(0, checkpoint(2));
  history = history.recorded(checkpoint(3));
  expect(history.canRedo).toBe(false);
  expect(history.mediaCount).toBe(2);
});
