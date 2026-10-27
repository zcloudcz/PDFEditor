import { describe, expect, it } from 'vitest';
import { createTemplate } from './templates';
import { validateProject } from './project-validation';
import { migrateProject, toStudioProject } from '../document/migrations';

describe('nondestructive image schema', () => {
  it('keeps the original source and edit metadata across portable v2 migration', async () => {
    const project = createTemplate('flyer');
    const object = project.pages[0].objects[0];
    object.kind = 'image'; object.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3u8AAAAASUVORK5CYII=';
    object.imageFit = 'cover';
    object.imageMask = { kind: 'rounded', radius: 0.2 };
    object.imageAdjustments = { brightness: 1.2, contrast: 0.8, saturation: 1.1, blur: 2 };
    object.brandRoles = { fill: 'primary' };
    validateProject(project);
    const roundtrip = await toStudioProject(await migrateProject(project));
    expect(roundtrip.pages[0].objects[0].src).toBe(object.src);
    expect(roundtrip.pages[0].objects[0].imageMask).toEqual({ kind: 'rounded', radius: 0.2 });
    expect(roundtrip.pages[0].objects[0].imageAdjustments).toEqual(object.imageAdjustments);
    expect(roundtrip.pages[0].objects[0].brandRoles).toEqual({ fill: 'primary' });
  });

  it('rejects out-of-range image edits and undeclared brand roles', () => {
    const project = createTemplate('flyer');
    const object = project.pages[0].objects[0];
    object.kind = 'image'; object.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3u8AAAAASUVORK5CYII=';
    (object as typeof object & { imageMask: unknown }).imageMask = { kind: 'rounded', radius: 2 };
    expect(() => validateProject(project)).toThrow();
    delete object.imageMask;
    (object as unknown as { brandRoles: unknown }).brandRoles = { fill: 'unknown' };
    expect(() => validateProject(project)).toThrow();
  });
});
