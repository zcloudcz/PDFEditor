// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { migrateProject, toStudioProject } from './migrations';
import { exportProjectBundle, importProjectBundle, validateProjectV2 } from './project-v2';
import type { StudioProject } from '../studio/types';

export function fixture(): StudioProject {
  return { version: 1, name: 'Český projekt', sourcePdf: btoa('%PDF-1.7\n'), pages: [{ id: 'page', name: 'Page', width: 595.2, height: 841.8, background: '#ffffff', sourcePageIndex: 0, objects: [{ id: 'text', kind: 'text', name: 'Text', x: -10.25, y: 20.5, width: 240, height: 75, rotation: 12.5, opacity: 0.7, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false, text: 'Žluťoučký text', fontSize: 24, textRuns: [{ text: 'Žluťoučký ', bold: true, color: '#ff0000' }, { text: 'text', italic: true, underline: true, fontSize: 17 }], verticalAlign: 'middle', wrapText: true, lineHeight: 1.3 }] }] };
}
describe('project v2 migration', () => {
  it('preserves all rich runs, geometry and PDF without mutating input', async () => {
    const source = fixture(); const before = structuredClone(source);
    const v2 = await migrateProject(source);
    expect(await toStudioProject(v2)).toEqual(source);
    expect(source).toEqual(before);
    expect(await importProjectBundle(await exportProjectBundle(v2))).toEqual(v2);
  });
  it.each(['pdf', 'slides', 'flow', 'sheet', 'board', 'web', 'timeline', 'future'])('rejects unsupported %s sections', async kind => {
    const v2 = await migrateProject(fixture());
    (v2.sections[0] as { kind: string }).kind = kind;
    await expect(validateProjectV2(v2)).rejects.toThrow(/section/i);
  });
  it('rejects duplicate IDs and corrupt hashes', async () => {
    const v2 = await migrateProject(fixture());
    v2.sections[0].pages[0].objects[0].id = 'page';
    await expect(validateProjectV2(v2)).rejects.toThrow();
    const clean = await migrateProject(fixture());
    Object.values(clean.assets)[0].base64 = btoa('%PDF-broken');
    await expect(validateProjectV2(clean)).rejects.toThrow(/hash/i);
  });
  it.each(['migrate', 'materialize', 'export'])('owns the input snapshot before asynchronous %s validation', async operation => {
    const project = await migrateProject(fixture());
    const before = structuredClone(project);
    const pending = operation === 'migrate' ? migrateProject(project)
      : operation === 'materialize' ? toStudioProject(project) : exportProjectBundle(project);
    Object.values(project.assets)[0].base64 = btoa('%PDF-1.7\ncorrupted-after-validation-start');
    const result = await pending;
    expect(result).toEqual(operation === 'migrate' ? before
      : operation === 'materialize' ? fixture() : JSON.stringify(before));
  });
});
