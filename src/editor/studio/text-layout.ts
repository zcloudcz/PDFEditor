import { fontFile, loadedFont, prepareFont } from '../typography/fonts';
import { shapeText } from '../typography/shape';
import { assertTextProfile } from '../typography/preflight';
import type { StudioObject, StudioTextRun } from './types';
import { t } from '../i18n';

export type ResolvedTextRun = { text: string; bold: boolean; italic: boolean; underline: boolean; fontSize: number; color: string };
export type PositionedTextRun = ResolvedTextRun & { x: number; width: number; fontFamily: string; textDirection?: StudioObject['textDirection']; textLanguage?: StudioObject['textLanguage']; tracking?: number };
export type TextMeasure = (text: string, family: string, size: number, options?: { textDirection?: StudioObject['textDirection']; textLanguage?: StudioObject['textLanguage']; tracking?: number }) => number;
export function textRunFamily(object: StudioObject, run: StudioTextRun): string {
  const bold = run.bold ?? object.fontFamily?.includes('Bold') ?? false;
  const italic = run.italic ?? object.fontFamily?.includes('Italic') ?? false;
  const base = object.fontFamily?.startsWith('Noto ') ? object.fontFamily.replace(/ Bold$/, '') : 'Liberation Sans';
  return `${base}${bold && italic ? ' BoldItalic' : bold ? ' Bold' : italic ? ' Italic' : ''}`;
}
export const textFontFile = fontFile;
export async function prepareTextFonts(objects?: StudioObject[]): Promise<void> {
  const families = objects ? new Set(objects.filter(o => o.kind === 'text').flatMap(o => getTextRuns(o).map(run => textRunFamily(o, run)))) : new Set(['Liberation Sans', 'Liberation Sans Bold', 'Liberation Sans Italic', 'Liberation Sans BoldItalic']);
  await Promise.all([...families].map(prepareFont));
}
export function assertTextGlyphs(object: StudioObject, format?: 'pdf' | 'svg' | 'pptx'): void {
  for (const run of getTextRuns(object)) assertTextProfile(object, textRunFamily(object, run), run.text, format);
}
export function getTextRuns(object: StudioObject): ResolvedTextRun[] {
  const source = object.textRuns ?? [{ text: object.text ?? '' }];
  return source.map(run => ({ text: run.text, bold: run.bold ?? object.fontFamily?.includes('Bold') ?? false,
    italic: run.italic ?? object.fontFamily?.includes('Italic') ?? false, underline: run.underline ?? object.underline ?? false,
    fontSize: run.fontSize ?? object.fontSize ?? 24, color: run.color ?? object.fill }));
}
export const measureText: TextMeasure = (text, family, size, options) => {
  const font = loadedFont(family);
  // Temporary preview only until local font metrics are ready; exports await them.
  if (!font) return Array.from(text).length * size * 0.55;
  return shapeText(text, family, size, options).width;
};
export function layoutText(object: StudioObject, measureInput: TextMeasure = measureText): {
  lines: { runs: PositionedTextRun[]; y: number; width: number; paragraphStart?: boolean }[]; height: number; overflow: boolean;
} {
  const measure = (text: string, family: string, size: number) => measureInput(text, family, size, object);
  const size = object.fontSize ?? 24;
  const lines: { runs: PositionedTextRun[]; y: number; width: number; paragraphStart?: boolean }[] = [{ runs: [], y: 0, width: 0 }];
  const tails = new WeakMap<PositionedTextRun, string>();
  const sameStyle = (last: PositionedTextRun | undefined, run: ResolvedTextRun) => last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline && last.fontSize === run.fontSize && last.color === run.color;
  const increment = (text: string, run: ResolvedTextRun): number => {
    const family = textRunFamily(object, run), last = lines[lines.length - 1].runs.at(-1);
    const width = measure(text, family, run.fontSize);
    if (!sameStyle(last, run) || !last) return width + (last ? object.tracking ?? 0 : 0);
    // Bounded boundary shaping captures kerning/ligatures without reshaping the
    // entire growing paragraph on every token. Final runs are measured once exactly.
    const tail = tails.get(last) ?? '', head = Array.from(text.slice(0, 16)).slice(0, 8).join('');
    return width + measure(tail + head, family, run.fontSize) - measure(tail, family, run.fontSize) - measure(head, family, run.fontSize);
  };
  const append = (text: string, run: ResolvedTextRun) => {
    const line = lines[lines.length - 1], family = textRunFamily(object, run);
    const last = line.runs[line.runs.length - 1];
    if (last && sameStyle(last, run)) {
      const added = increment(text, run);
      last.text += text;
      line.width += added; last.width += added;
      tails.set(last, Array.from((tails.get(last) ?? '') + text.slice(-16)).slice(-8).join(''));
    } else {
      const width = measure(text, family, run.fontSize);
      if (last) line.width += object.tracking ?? 0;
      const positioned = { ...run, text, x: line.width, width, fontFamily: family, textDirection: object.textDirection, textLanguage: object.textLanguage, tracking: object.tracking };
      line.runs.push(positioned);
      tails.set(positioned, Array.from(text.slice(-16)).slice(-8).join(''));
      line.width += width;
    }
  };
  const newline = (paragraphStart = false) => lines.push({ runs: [], y: 0, width: 0, paragraphStart });
  for (const run of getTextRuns(object)) {
    for (const token of run.text.replace(/\r\n?/g, '\n').split(/(\n|[^\S\n]+|[^\s]+)/u).filter(Boolean)) {
      if (token === '\n') { newline(true); continue; }
      // pre-wrap spaces hang off the previous line; never create a separate
      // automatic blank line merely because the preceding word fits exactly.
      if (/^[^\S\n]+$/u.test(token)) { append(token, run); continue; }
      const width = measure(token, textRunFamily(object, run), run.fontSize);
      if (object.wrapText && lines[lines.length - 1].width > 0 && lines[lines.length - 1].width + increment(token, run) > object.width) newline();
      if (object.wrapText && width > object.width) {
        for (const character of Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token), item => item.segment)) {
          const charWidth = increment(character, run);
          if (lines[lines.length - 1].width > 0 && lines[lines.length - 1].width + charWidth > object.width) newline();
          append(character, run);
        }
      } else append(token, run);
    }
  }
  for (const line of lines) {
    let width = 0;
    for (const run of line.runs) {
      if (run !== line.runs[0]) width += object.tracking ?? 0;
      run.x = width;
      run.width = measure(run.text, run.fontFamily, run.fontSize);
      width += run.width;
    }
    line.width = width;
    if (object.wrapText) {
      // Hanging trailing whitespace is retained in text, but does not push
      // centered/right-aligned visible content or report false overflow.
      for (let index = line.runs.length - 1; index >= 0; index--) {
        const run = line.runs[index], trailing = /[^\S\n]+$/u.exec(run.text)?.[0] ?? '';
        line.width -= measure(trailing, run.fontFamily, run.fontSize) + (trailing && trailing.length < run.text.length ? object.tracking ?? 0 : 0);
        if (trailing.length !== run.text.length) break;
      }
    }
  }
  const lineSizes = lines.map(line => line.runs.length ? Math.max(...line.runs.map(run => run.fontSize)) : size);
  const height = lineSizes.reduce((sum, lineSize, index) => sum + lineSize * (index === lines.length - 1 ? 1 : object.lineHeight ?? 1.2) + (lines[index].paragraphStart ? object.paragraphSpacing ?? 0 : 0), 0);
  const free = Math.max(0, object.height - height);
  const top = object.verticalAlign === 'middle' ? free / 2 : object.verticalAlign === 'bottom' ? free : 0;
  let offset = top;
  lines.forEach((line, index) => {
    if (line.paragraphStart) offset += object.paragraphSpacing ?? 0;
    const left = object.textAlign === 'center' ? (object.width - line.width) / 2 : object.textAlign === 'right' ? object.width - line.width : 0;
    line.y = offset + lineSizes[index];
    offset += lineSizes[index] * (object.lineHeight ?? 1.2);
    line.runs.forEach(run => { run.x += left; });
  });
  return { lines, height, overflow: height > object.height || lines.some(line => line.width > object.width) };
}
