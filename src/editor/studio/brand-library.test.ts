import { describe, expect, it } from 'vitest';
import { createTemplate } from './templates';
import { getTextRuns } from './text-layout';
import { parsePortableProject, serializePortableProject } from './project-io';
import { applyBrandToSelection, exportBrandProfiles, importBrandProfiles, loadBrandProfiles, saveBrandProfile, validateBrandProfile } from './brand-library';

const brand = {
  version: 1 as const, id: 'brand-1', name: 'Brand One',
  colors: { primary: '#112233', accent: '#abcdef', paper: '#fefefe' },
  textStyles: { heading: { fontFamily: 'Liberation Sans Bold' as const, fontSize: 38 }, body: { fontFamily: 'Liberation Sans' as const, fontSize: 12 } },
};

describe('multiple brand profiles', () => {
  it('applies only declared roles on selected objects and preserves unassigned values', () => {
    const project = createTemplate('flyer');
    const first = project.pages[0].objects[0];
    const second = project.pages[0].objects[1];
    const beforeSecond = structuredClone(second);
    const result = applyBrandToSelection(project, brand, [first.id, second.id], { [first.id]: { fill: 'primary' } });
    expect(result.pages[0].objects[0].fill).toBe('#112233');
    expect(result.pages[0].objects[1]).toEqual(beforeSecond);
    expect(project.pages[0].objects[0].fill).not.toBe('#112233');
  });

  it('rejects remote logos, unsupported fonts, and unsafe colors', () => {
    expect(validateBrandProfile(brand)).toBe(true);
    expect(validateBrandProfile({ ...brand, logo: 'https://example.com/a.png' })).toBe(false);
    expect(validateBrandProfile({ ...brand, colors: { ...brand.colors, primary: 'url(a)' } })).toBe(false);
    expect(validateBrandProfile({ ...brand, textStyles: { ...brand.textStyles, heading: { fontFamily: 'Remote Font', fontSize: 38 } } })).toBe(false);
  });

  it('stores multiple brands and roundtrips a validated local export', () => {
    localStorage.clear();
    saveBrandProfile(brand);
    saveBrandProfile({ ...brand, id: 'brand-2', name: 'Brand Two' });
    expect(loadBrandProfiles().map(item => item.name)).toEqual(['Brand One', 'Brand Two']);
    const payload = exportBrandProfiles(loadBrandProfiles());
    expect(importBrandProfiles(payload)).toHaveLength(2);
    expect(() => importBrandProfiles('{"profiles":[{"logo":"https://example.com/a.png"}]}')).toThrow();
  });

  it('updates rich text runs for assigned color/style while leaving locked and unassigned text untouched', async () => {
    const project = createTemplate('flyer');
    const text = project.pages[0].objects.find(object => object.kind === 'text')!;
    text.text = 'Heading'; text.textRuns = [{ text: 'Heading', fontSize: 18, color: '#ff0000', bold: false, italic: false }];
    text.brandRoles = { fill: 'primary', textStyle: 'heading' };
    const locked = project.pages[0].objects.find(object => object.kind === 'text' && object.id !== text.id)!;
    locked.locked = true; locked.brandRoles = { fill: 'primary', textStyle: 'heading' };
    const lockedBefore = structuredClone(locked);
    const output = applyBrandToSelection(project, brand, [text.id, locked.id]);
    const changed = output.pages[0].objects.find(object => object.id === text.id)!;
    expect(getTextRuns(changed)[0]).toMatchObject({ fontSize: 38, color: '#112233', bold: true, italic: false });
    expect(output.pages[0].objects.find(object => object.id === locked.id)).toEqual(lockedBefore);
    expect(project.pages[0].objects.find(object => object.id === text.id)?.textRuns?.[0].fontSize).toBe(18);
    const restored = await parsePortableProject(await serializePortableProject(output));
    expect(getTextRuns(restored.pages[0].objects.find(object => object.id === text.id)!)[0]).toMatchObject({ fontSize: 38, color: '#112233', bold: true });
  });
});
