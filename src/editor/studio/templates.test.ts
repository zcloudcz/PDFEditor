import { beforeEach, describe, expect, it } from 'vitest';
import { createTemplate, getTemplates, mountTemplatePicker } from './templates';
import { BRAND_STORAGE_KEY, defaultBrandKit, loadBrandKit, mountBrandKit, saveBrandKit, validateBrandKit, validateLogo } from './brand-kit';

beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });
describe('original template library', () => {
  it('contains six independent editable formats with objects inside page bounds', () => {
    expect(getTemplates()).toHaveLength(6);
    const allIds: string[] = [];
    for (const template of getTemplates()) {
      const project = createTemplate(template.id);
      expect(project.version).toBe(1);
      for (const page of project.pages) {
        allIds.push(page.id);
        expect(page.width).toBe(template.width); expect(page.height).toBe(template.height);
        expect(page.objects.length).toBeGreaterThanOrEqual(5);
        for (const obj of page.objects) {
          allIds.push(obj.id);
          expect(obj.x).toBeGreaterThanOrEqual(0); expect(obj.y).toBeGreaterThanOrEqual(0);
          expect(obj.x + obj.width).toBeLessThanOrEqual(page.width + 0.01);
          expect(obj.y + obj.height).toBeLessThanOrEqual(page.height + 0.01);
          expect(obj.locked).toBe(false);
        }
      }
    }
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(createTemplate('presentation').pages).toHaveLength(3);
  });
  it('creates fresh instances and refuses unknown templates and invalid brand input', () => {
    const a = createTemplate('flyer'); const b = createTemplate('flyer');
    a.pages[0].objects[0].fill = '#ffffff';
    expect(b.pages[0].objects[0].fill).toBe('#204d45');
    expect(a.pages[0].id).not.toBe(b.pages[0].id);
    expect(() => createTemplate('missing')).toThrow();
    expect(() => createTemplate('flyer', { ...defaultBrandKit(), colors: ['red'] })).toThrow();
  });
  it('uses saved brand colors and name when selecting, and cleans up picker', () => {
    saveBrandKit({ name: 'Moje studio', font: 'Liberation Sans', colors: ['#112233', '#abcdef'] });
    const host = document.createElement('div'); let project = createTemplate('social');
    const dispose = mountTemplatePicker(host, value => { project = value; });
    host.querySelector('button')!.click();
    expect(project.pages[0].objects.some(obj => obj.text === 'Moje studio')).toBe(true);
    expect(project.pages[0].objects[0].fill).toBe('#112233');
    dispose(); expect(host.children).toHaveLength(0);
  });
});
describe('local brand kit', () => {
  it('rejects malformed and remote logos, unsafe colors, and unknown fonts', () => {
    expect(validateLogo('https://example.com/logo.png')).toBe(false);
    expect(validateLogo('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(validateLogo('data:image/png;base64,aGVsbG8=')).toBe(false);
    expect(validateBrandKit({ ...defaultBrandKit(), font: 'Remote font' })).toBe(false);
    expect(validateBrandKit({ ...defaultBrandKit(), colors: ['url(remote)', '#000000'] })).toBe(false);
    expect(validateBrandKit({ ...defaultBrandKit(), name: '' })).toBe(false);
    expect(() => saveBrandKit({ ...defaultBrandKit(), name: '' })).toThrow();
  });
  it('recovers from malformed storage and returns independent defaults', () => {
    localStorage.setItem(BRAND_STORAGE_KEY, '{broken'); expect(loadBrandKit()).toEqual(defaultBrandKit());
    localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ name: 'bad' })); expect(loadBrandKit()).toEqual(defaultBrandKit());
    const a = loadBrandKit(); a.colors[0] = '#ffffff'; expect(loadBrandKit().colors[0]).toBe('#204d45');
  });
  it('saves and resets using local form controls', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = mountBrandKit(host);
    const name = host.querySelector<HTMLInputElement>('[name=brandName]')!; name.value = 'Česká značka';
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(loadBrandKit().name).toBe('Česká značka');
    host.querySelector<HTMLButtonElement>('[data-reset]')!.click(); expect(loadBrandKit()).toEqual(defaultBrandKit());
    dispose(); expect(host.children).toHaveLength(0);
  });
});
