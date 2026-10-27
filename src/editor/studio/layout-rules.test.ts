import { describe, expect, it } from 'vitest';
import type { StudioObject, StudioProject } from './types';
import { distributeSelection, previewDesignResize, resizeDesign, snapToGuides, insertReusableBlock } from './layout-rules';
import { capturePersonalTemplate } from './personal-templates';

const object = (id: string, x: number, y: number, width = 20, height = 20): StudioObject => ({
  id, kind: 'rect', name: id, x, y, width, height, rotation: 0, opacity: 1,
  fill: '#ffffff', stroke: '#000000', strokeWidth: 0, locked: false,
});
const project = (): StudioProject => ({ version: 1, name: 'Design', pages: [
  { id: 'design', name: 'Design', width: 200, height: 100, background: '#ffffff', objects: [
    object('a', 10, 10), object('b', 70, 10), object('c', 130, 10),
  ] },
] });

describe('design layout rules', () => {
  it('reuses saved objects with fresh IDs and groups without importing a source PDF', () => {
    const input = project(); input.pages[0].objects[0].groupId = 'g'; input.pages[0].objects[1].groupId = 'g';
    const template = capturePersonalTemplate(input, ['a', 'b'], { name: 'Block', tags: [], license: 'Own', source: 'Own' });
    const output = insertReusableBlock(input, 'design', template);
    const copies = output.pages[0].objects.slice(3);
    expect(copies.map(o => [o.x, o.y])).toEqual([[16,16],[76,16]]);
    expect(new Set(output.pages[0].objects.map(o => o.id)).size).toBe(5);
    expect(copies[0].groupId).toBe(copies[1].groupId); expect(copies[0].groupId).not.toBe('g');
    expect(input.pages[0].objects).toHaveLength(3);
    input.pages[0].width = 50;
    expect(() => insertReusableBlock(input, 'design', template)).toThrow(/beyond/);
  });
  it('rejects rotated corners that extend beyond a resized page', () => {
    const input = project(); input.pages[0].objects[0].rotation = 45; input.pages[0].objects[0].x = 0;
    expect(() => resizeDesign(input, 'design', { width: 200, height: 100 }, [])).toThrow(/beyond/);
  });
  it('preserves metadata, IDs and source assets while anchoring and stretching', () => {
    const input = project();
    input.pages[0].objects[0].groupId = 'g';
    input.pages[0].objects[0].kind = 'image';
    input.pages[0].objects[0].src = 'data:image/png;base64,aA==';
    input.pages[0].objects[0].imageProvenance = { kind: 'local-upload', license: 'unspecified', source: 'local upload' };
    const original = structuredClone(input);
    const output = resizeDesign(input, 'design', { width: 300, height: 150 }, [
      { objectId: 'a', horizontal: 'start', vertical: 'start' },
      { objectId: 'b', horizontal: 'end', vertical: 'center' },
      { objectId: 'c', horizontal: 'stretch', vertical: 'end' },
    ]);
    expect(output.pages[0].objects.map(o => [o.id, o.x, o.y, o.width, o.groupId])).toEqual([
      ['a', 10, 10, 20, 'g'], ['b', 170, 35, 20, undefined], ['c', 130, 60, 120, undefined],
    ]);
    expect(output.pages[0].objects[0].imageProvenance).toEqual(original.pages[0].objects[0].imageProvenance);
    const again = resizeDesign(output, 'design', { width: 320, height: 170 }, []);
    expect(again.pages[0].objects[1].x).toBe(190);
    expect(input).toEqual(original);
  });

  it('rejects zero sizes, overflowing anchors, and source-backed page in mixed projects', () => {
    const input = project();
    expect(() => resizeDesign(input, 'design', { width: 0, height: 100 }, [])).toThrow();
    expect(() => resizeDesign(input, 'design', { width: 10, height: 100 }, [{ objectId: 'a', horizontal: 'end', vertical: 'start' }])).toThrow();
    input.sourcePdf = 'JVBERi0=';
    input.pages.push({ id: 'pdf', name: 'PDF', width: 200, height: 100, background: '#ffffff', sourcePageIndex: 0, objects: [] });
    expect(() => resizeDesign(input, 'pdf', { width: 300, height: 150 }, [])).toThrow(/PDF/);
    expect(resizeDesign(input, 'design', { width: 300, height: 150 }, []).sourcePdf).toBe(input.sourcePdf);
  });

  it('distributes selected unlocked objects by equal gaps without changing endpoints or locked items', () => {
    const input = project(); input.pages[0].objects[1].x = 40;
    input.pages[0].objects.push({ ...object('locked', 90, 10), locked: true });
    const output = distributeSelection(input, 'design', ['a', 'b', 'c', 'locked'], 'horizontal');
    expect(output.pages[0].objects.map(o => o.x)).toEqual([10, 70, 130, 90]);
    expect(input.pages[0].objects[1].x).toBe(40);
  });

  it('preserves complete groups and rejects partial or locked groups', () => {
    const input = project(); input.pages[0].objects[0].groupId = 'group'; input.pages[0].objects[1].groupId = 'group';
    expect(() => distributeSelection(input, 'design', ['a', 'c'], 'horizontal')).toThrow(/group/);
    const output = distributeSelection(input, 'design', ['a', 'b', 'c'], 'horizontal');
    expect(output.pages[0].objects[0].groupId).toBe('group');
    expect(output.pages[0].objects[1].groupId).toBe('group');
    input.pages[0].objects[1].locked = true;
    expect(() => distributeSelection(input, 'design', ['a', 'b', 'c'], 'horizontal')).toThrow(/group/);
  });

  it('previews without mutation and snaps only to local guide values', () => {
    const input = project(); const original = structuredClone(input);
    const preview = previewDesignResize(input, 'design', { width: 300, height: 150 }, []);
    expect(preview.project.pages[0].width).toBe(300);
    expect(input).toEqual(original);
    expect(snapToGuides({ x: 49, y: 68 }, [{ axis: 'x', position: 50 }, { axis: 'y', position: 70 }], 3)).toEqual({ x: 50, y: 70 });
  });
});

it('distributes rotated visible bounds and group unions with unchanged endpoints', () => {
  const input = project(); input.pages[0].width = 500; input.pages[0].height = 300;
  input.pages[0].objects = [{ ...object('a', 50, 100, 100, 20), rotation: 90 }, object('b', 200, 100), object('c', 350, 100)];
  const output = distributeSelection(input, 'design', ['a', 'b', 'c'], 'horizontal');
  expect(output.pages[0].objects.map(o => o.x)).toEqual([50, 220, 350]);
  input.pages[0].objects[1].groupId = 'group';
  input.pages[0].objects.push({ ...object('d', 210, 130), rotation: 90, groupId: 'group' });
  const grouped = distributeSelection(input, 'design', ['a', 'b', 'c', 'd'], 'horizontal');
  expect(grouped.pages[0].objects.map(o => o.x)).toEqual([50, 215, 350, 225]);
});
