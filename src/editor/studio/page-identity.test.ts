import { describe, expect, it } from 'vitest';
import { buildPageIdentityMap, sourceReferenceMapping } from './page-identity';
import type { StudioProject } from './types';

function fixture(): StudioProject {
  return { version: 1, name: 'Identity', sourcePdf: 'JVBERi0x', pages: [
    { id: 'b', name: 'B', width: 300, height: 400, background: '#ffffff', sourcePageIndex: 1, objects: [] },
    { id: 'design', name: 'Design', width: 300, height: 400, background: '#ffffff', objects: [] },
    { id: 'a-copy', name: 'A copy', width: 300, height: 400, background: '#ffffff', sourcePageIndex: 0, objects: [] },
    { id: 'a', name: 'A', width: 300, height: 400, background: '#ffffff', sourcePageIndex: 0, objects: [] },
  ] };
}

describe('stable project page identities', () => {
  it('maps IDs in both directions across reorder, duplicate, deletion and design-only pages', () => {
    const project = fixture(), before = structuredClone(project);
    const map = buildPageIdentityMap(project, 3);
    expect(map.byId.get('a')).toEqual({ projectIndex: 3, sourcePageIndex: 0 });
    expect(map.byId.get('design')).toEqual({ projectIndex: 1 });
    expect(map.bySourceIndex.get(0)).toEqual(['a-copy', 'a']);
    expect(map.bySourceIndex.has(2)).toBe(false);
    expect(sourceReferenceMapping(project, 3)).toEqual([
      { oldIndex: 0, newIndices: [1, 2] },
      { oldIndex: 1, newIndices: [0] },
      { oldIndex: 2, newIndices: [] },
    ]);
    expect(project).toEqual(before);
  });
  it('rejects invalid and ambiguous identities before structural changes', () => {
    const duplicate = fixture(); duplicate.pages[1].id = duplicate.pages[0].id;
    expect(() => buildPageIdentityMap(duplicate, 3)).toThrow();
    const broken = fixture(); broken.pages[0].sourcePageIndex = 3;
    expect(() => sourceReferenceMapping(broken, 3)).toThrow();
    expect(() => sourceReferenceMapping(fixture(), 201)).toThrow();
    expect(() => sourceReferenceMapping(fixture(), 0)).toThrow();
  });
});
