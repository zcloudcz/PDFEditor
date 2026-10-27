import type { Glyph, GlyphRun } from '@pdf-lib/fontkit';
import 'regenerator-runtime/runtime';
import bidiFactory from 'bidi-js';
import { loadedFont } from './fonts';
import { t } from '../i18n';

const bidi = bidiFactory();
export interface PositionedGlyph { glyph: Glyph; x: number; y: number; advance: number; encodedIndex: number }
export interface ShapedSegment { text: string; x: number; glyphs: PositionedGlyph[] }
export interface ShapedText { segments: ShapedSegment[]; width: number; scale: number }
export interface TextOptions { textDirection?: 'auto' | 'ltr' | 'rtl'; textLanguage?: 'und' | 'cs' | 'en' | 'ar' | 'hi' | 'ja'; tracking?: number }
const languageTags: Record<NonNullable<TextOptions['textLanguage']>, string | undefined> = { und: undefined, cs: 'CSY ', en: 'ENG ', ar: 'ARA ', hi: 'HIN ', ja: 'JAN ' };
type LayoutFont = (text: string, features?: undefined, script?: undefined, language?: string, direction?: 'ltr' | 'rtl') => GlyphRun;
/** One backend owns substitutions AND GPOS. Consumers must not re-shape individual characters. */
export function shapeText(text: string, family: string, size: number, options: TextOptions = {}): ShapedText {
  const font = loadedFont(family);
  if (!font) throw new Error(t('Lokální písmo nelze načíst.'));
  const normalized = text.normalize('NFC').replace(/\t/g, '    ');
  const levels = bidi.getEmbeddingLevels(normalized, options.textDirection === 'auto' ? undefined : options.textDirection);
  const order = Array.from({ length: normalized.length }, (_, index) => index);
  for (const [start, end] of bidi.getReorderSegments(normalized, levels)) {
    for (let left = start, right = end; left < right; left++, right--) [order[left], order[right]] = [order[right], order[left]];
  }
  const visual = new Map(order.map((index, position) => [index, position]));
  const parts: { text: string; level: number; visual: number }[] = [];
  for (let start = 0; start < normalized.length;) {
    let end = start + 1;
    while (end < normalized.length && levels.levels[end] === levels.levels[start]) end++;
    parts.push({ text: normalized.slice(start, end), level: levels.levels[start], visual: Math.min(visual.get(start)!, visual.get(end - 1)!) });
    start = end;
  }
  parts.sort((a, b) => a.visual - b.visual);
  let x = 0;
  const scale = size / font.unitsPerEm;
  const segments = parts.map(part => {
    // Installed fontkit accepts script/language/direction beyond its two-argument
    // declaration. Keep the adapter here rather than relying on browser shaping.
    const layout: LayoutFont = font.layout.bind(font);
    const shaped = layout(part.text, undefined, undefined, languageTags[options.textLanguage ?? 'und'], part.level & 1 ? 'rtl' : 'ltr');
    const encoded = font.layout(part.text).glyphs;
    const encodingIndices = new Map<number, { indices: number[]; cursor: number }>();
    encoded.forEach((glyph, index) => { const entry = encodingIndices.get(glyph.id) ?? { indices: [], cursor: 0 }; entry.indices.push(index); encodingIndices.set(glyph.id, entry); });
    const start = x;
    const indices = shaped.glyphs.map((_, index) => index);
    const glyphs = indices.map(index => {
      const glyph = shaped.glyphs[index];
      const pos = shaped.positions[index];
      const encodingEntry = encodingIndices.get(glyph.id);
      const encodedIndex = encodingEntry?.indices[encodingEntry.cursor++];
      // pdf-lib's encoder uses default-language shaping. Do not silently map
      // language-specific substitutions to unrelated CIDs.
      if (encodedIndex === undefined) throw new Error(t('Tento textový profil zatím nelze věrně exportovat.'));
      const result = { glyph, x: x + pos.xOffset * scale, y: pos.yOffset * scale, advance: pos.xAdvance * scale, encodedIndex };
      x += pos.xAdvance * scale;
      return result;
    });
    return { text: part.text, x: start, glyphs };
  });
  if (options.tracking) {
    // Tracking is an export-supported profile for one-glyph Latin/CJK clusters.
    // Do not detach cursive/combining glyphs merely to add letter spacing.
    let offset = 0;
    const all = segments.flatMap(segment => segment.glyphs);
    for (const [index, glyph] of all.entries()) {
      glyph.x += offset;
      if (index < all.length - 1 && glyph.advance > 0) offset += options.tracking;
    }
    x += offset;
  }
  return { segments, width: x, scale };
}
