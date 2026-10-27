import { t } from '../i18n';
import type { StudioObject } from '../studio/types';
import { loadedFont, fontFile } from './fonts';

export function assertTextProfile(object: StudioObject, family: string, text: string, format: 'pdf' | 'svg' | 'pptx' = 'pdf'): void {
  fontFile(family);
  const arabic = family.startsWith('Noto Sans Arabic');
  if ((format === 'pptx' && family.startsWith('Noto Sans Devanagari')) ||
      (format !== 'svg' && object.textShadow && !object.textGradient && (object.stroke === 'none' || object.strokeWidth === 0) &&
        (object.textRuns ?? [{ text: object.text ?? '' }]).some(run => (run.color ?? object.fill) === 'none' && run.text.length > 0)) ||
      (object.tracking && (arabic || family.startsWith('Noto Sans Devanagari'))) ||
      ((object.tracking ?? 0) > Math.min(object.fontSize ?? 24, ...((object.textRuns ?? []).map(run => run.fontSize ?? object.fontSize ?? 24))) * 0.1) ||
      (object.textPath && (format !== 'svg' || object.wrapText || /[\n\r]/.test(object.text ?? '') || object.width / object.textPath.radius > Math.PI || arabic || object.underline || object.textRuns?.some(run => run.underline))) ||
      (format === 'pptx' && (object.textShadow || object.textGradient || object.textPath || (object.stroke !== 'none' && object.strokeWidth > 0))) ||
      (format === 'pptx' && !family.startsWith('Liberation Sans')) ||
      (format !== 'svg' && ((object.textDirection === 'rtl' && !arabic) || (object.textDirection === 'ltr' && arabic))) ||
      (arabic && ((object.textRuns?.length ?? 0) > 1 || /[^\p{Script_Extensions=Arabic}0-9\s]/u.test(text) || (format !== 'svg' && /\p{Mark}/u.test(text)))) ||
      /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/u.test(text)) {
    throw new Error(t('Tento textový profil zatím nelze věrně exportovat.'));
  }
  const font = loadedFont(family);
  if (!font) throw new Error(t('Lokální písmo nelze načíst.'));
  for (const character of text.normalize('NFC')) {
    if (character === '\n' || character === '\r' || character === '\t') continue;
    if (!font.hasGlyphForCodePoint(character.codePointAt(0)!)) throw new Error(t('Písmo neobsahuje všechny znaky textu.'));
  }
}
