import fontkit, { type Font } from '@pdf-lib/fontkit';
import { t } from '../i18n';

/** PDF text operators contain visual RTL glyph order. ToUnicode must encode
 * multi-character RTL ligatures in that same visual order before a reader's
 * bidi algorithm reconstructs logical Unicode. Never mutate the shared fonts. */
export const pdfFontkit = {
  create(bytes: Uint8Array): Font {
    const font = fontkit.create(bytes);
    const layout: Font['layout'] = font.layout.bind(font);
    font.layout = (text, features) => {
      const run = layout(text, features);
      if (run.direction !== 'rtl') return run;
      return { ...run, glyphs: run.glyphs.map(glyph => glyph.codePoints.length < 2 ? glyph : new Proxy(glyph, {
        get(target, key, receiver) { return key === 'codePoints' ? [...target.codePoints].reverse() : Reflect.get(target, key, receiver); },
      })) };
    };
    return font;
  },
};

/** Finite, bundled registry. CJK is fetched only when an object explicitly selects it. */
export const FONT_FILES: Readonly<Record<string, string>> = Object.freeze({
  'Liberation Sans': '/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf',
  'Liberation Sans Bold': '/pdfjs-viewer/standard_fonts/LiberationSans-Bold.ttf',
  'Liberation Sans Italic': '/pdfjs-viewer/standard_fonts/LiberationSans-Italic.ttf',
  'Liberation Sans BoldItalic': '/pdfjs-viewer/standard_fonts/LiberationSans-BoldItalic.ttf',
  'Noto Sans Arabic': '/fonts/noto/NotoSansArabic-Regular.ttf',
  'Noto Sans Arabic Bold': '/fonts/noto/NotoSansArabic-Bold.ttf',
  'Noto Sans Devanagari': '/fonts/noto/NotoSansDevanagari-Regular.ttf',
  'Noto Sans Devanagari Bold': '/fonts/noto/NotoSansDevanagari-Bold.ttf',
  'Noto Sans CJK JP': '/fonts/noto/NotoSansCJKjp-Regular.otf',
});
const registry = new Map<string, { font: Font; bytes: Uint8Array }>();
const pending = new Map<string, Promise<void>>();
export function fontFile(family: string): string {
  const file = FONT_FILES[family];
  if (!file) throw new Error(t('Tento řez písma není podporován.'));
  return file;
}
export function loadedFont(family: string): Font | undefined { return registry.get(family)?.font; }
export async function prepareFont(family: string): Promise<void> {
  if (registry.has(family)) return;
  if (!pending.has(family)) {
    const file = fontFile(family);
    pending.set(family, (async () => {
      const response = await fetch(file);
      if (!response.ok) throw new Error(t('Lokální písmo nelze načíst.'));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 18 * 1024 * 1024) throw new Error(t('Lokální písmo nelze načíst.'));
      const font = fontkit.create(bytes);
      registry.set(family, { font, bytes });
      if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
        const face = new FontFace(family, bytes.slice().buffer);
        await face.load(); document.fonts.add(face);
      }
    })().catch(error => { registry.delete(family); throw error; }).finally(() => { pending.delete(family); }));
  }
  return pending.get(family)!;
}
export async function fontBytes(family: string): Promise<Uint8Array> {
  await prepareFont(family);
  return registry.get(family)!.bytes;
}
