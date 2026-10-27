import { describe, expect, it } from 'vitest';
import { EDITOR_LOCALES } from '../editor/i18n/locales';
import { sourceMessages } from '../editor/i18n/catalog';

const bundles = import.meta.glob<Record<string, string>>('../editor/i18n/translations/*.json', { eager: true, import: 'default' });
const placeholders = (text: string) => [...text.matchAll(/\{\{?(\w+)\}?\}/g)].map(match => match[1]).sort();

describe('editor language portfolio', () => {
  it('declares unique locales with native names and explicit direction', () => {
    expect(EDITOR_LOCALES.length).toBe(49);
    expect(new Set(EDITOR_LOCALES.map(locale => locale.code)).size).toBe(EDITOR_LOCALES.length);
    for (const locale of EDITOR_LOCALES) {
      expect(locale.name.trim()).not.toBe('');
      expect(['ltr', 'rtl']).toContain(locale.dir);
    }
  });

  for (const locale of EDITOR_LOCALES) {
    it(`${locale.code} covers every UI message without changing placeholders`, () => {
      const translations = bundles[`../editor/i18n/translations/${locale.code}.json`];
      expect(translations, `Missing ${locale.code} bundle`).toBeDefined();
      expect(Object.keys(translations ?? {}).sort()).toEqual([...sourceMessages].sort());
      for (const source of sourceMessages) {
        const value = translations?.[source];
        expect(typeof value, `${locale.code}: ${source}`).toBe('string');
        expect(value?.trim().length, `${locale.code}: ${source}`).toBeGreaterThan(0);
        expect(placeholders(value ?? ''), `${locale.code}: ${source}`).toEqual(placeholders(source));
      }
    });
  }
});
