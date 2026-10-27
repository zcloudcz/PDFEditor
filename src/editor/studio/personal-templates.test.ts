import { describe, expect, it } from 'vitest';
import { createTemplate } from './templates';
import { capturePersonalTemplate, findPersonalTemplates, insertPersonalTemplate, loadPersonalTemplates, savePersonalTemplate, validatePersonalTemplate } from './personal-templates';
import { validateProject } from './project-validation';

describe('personal templates', () => {
  it('captures a selected design page with user-declared provenance and inserts fresh IDs into an existing PDF project', () => {
    const design = createTemplate('social');
    const saved = capturePersonalTemplate(design, [design.pages[0].id], { name: 'My social', tags: ['campaign'], license: 'CC0-1.0', source: 'Created by me' });
    expect(saved.pages).toHaveLength(1);
    expect(saved.provenance).toEqual({ kind: 'user-declared', license: 'CC0-1.0', source: 'Created by me' });
    const existing = createTemplate('flyer');
    existing.sourcePdf = 'JVBERi0=';
    existing.pages[0].sourcePageIndex = 0;
    const result = insertPersonalTemplate(existing, saved, 1);
    validateProject(result);
    expect(result.sourcePdf).toBe('JVBERi0=');
    expect(result.pages.map(page => page.id)).toEqual([existing.pages[0].id, expect.any(String)]);
    expect(result.pages[0]).toEqual(existing.pages[0]);
    expect(result.pages[1].id).not.toBe(saved.pages[0].id);
    expect(result.pages[1].objects[0].id).not.toBe(saved.pages[0].objects[0].id);
    expect(design.pages).toHaveLength(1);
  });

  it('rejects source-backed pages and malformed or missing media provenance', () => {
    const design = createTemplate('social');
    design.sourcePdf = 'JVBERi0=';
    design.pages[0].sourcePageIndex = 0;
    expect(() => capturePersonalTemplate(design, [design.pages[0].id], { name: 'Unsafe', tags: [], license: 'CC0-1.0', source: 'Me' })).toThrow();
    const clean = createTemplate('social');
    clean.pages[0].objects[0].kind = 'image';
    clean.pages[0].objects[0].src = 'data:image/png;base64,aGVsbG8=';
    expect(() => capturePersonalTemplate(clean, [clean.pages[0].id], { name: 'Unsafe', tags: [], license: 'CC0-1.0', source: 'Me' })).toThrow();
    expect(validatePersonalTemplate({ pages: [] })).toBe(false);
  });

  it('stores, searches, and favorites local templates without replacing any project', () => {
    localStorage.clear();
    const project = createTemplate('social');
    const template = capturePersonalTemplate(project, [project.pages[0].id], { name: 'Autumn social', tags: ['campaign', 'autumn'], license: 'CC0-1.0', source: 'Created by me' });
    savePersonalTemplate(template);
    const loaded = loadPersonalTemplates();
    expect(loaded).toHaveLength(1);
    expect(findPersonalTemplates(loaded, 'AUTUMN', 'campaign')).toHaveLength(1);
    expect(findPersonalTemplates(loaded, '', undefined, true)).toHaveLength(0);
    savePersonalTemplate({ ...template, favorite: true });
    expect(findPersonalTemplates(loadPersonalTemplates(), '', undefined, true)).toHaveLength(1);
  });
  it('requires an explicit declaration when a local upload is saved as a reusable template', () => {
    const project = createTemplate('social');
    const object = project.pages[0].objects[0];
    object.kind = 'image'; object.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3u8AAAAASUVORK5CYII=';
    object.imageProvenance = { kind: 'local-upload', license: 'unspecified', source: 'local upload' };
    expect(() => capturePersonalTemplate(project, [project.pages[0].id], { name: 'Reuse', tags: [], license: '', source: '' })).toThrow();
    const saved = capturePersonalTemplate(project, [project.pages[0].id], { name: 'Reuse', tags: [], license: 'My own image', source: 'Created by me' });
    expect(saved.mediaProvenance[object.id]).toEqual({ kind: 'user-declared', license: 'My own image', source: 'Created by me' });
  });
});
