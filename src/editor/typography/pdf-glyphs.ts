import { PDFArray, PDFDict, PDFName, PDFString, type PDFDocument, type PDFFont, type PDFRef } from 'pdf-lib';
import type { ShapedText } from './shape';
import { loadedFont } from './fonts';
import { t } from '../i18n';

const unsupported = () => new Error(t('Tento textový profil zatím nelze věrně exportovat.'));
const hex = (value: number) => value.toString(16).padStart(4, '0');
const utf16 = (value: string) => Array.from({ length: value.length }, (_, i) => hex(value.charCodeAt(i))).join('');

/** A CID identifies an occurrence, not a reusable glyph: reordered Indic marks
 * can give the same outline different logical Unicode within different clusters.
 * This adapter is limited to the bundled TrueType Devanagari faces. */
export async function devanagariPdfFont(doc: PDFDocument, font: PDFFont, family: string, shaped: ShapedText, size: number): Promise<{ ref: PDFRef; codes: string[] }> {
  const sourceFont = loadedFont(family);
  if (!sourceFont || !family.startsWith('Noto Sans Devanagari')) throw unsupported();
  const occurrences = shaped.segments.flatMap(segment => {
    const glyphs = segment.glyphs.map(glyph => ({ ...glyph, unicode: '' }));
    let at = 0;
    for (const { segment: cluster } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(segment.text)) {
      const points = Array.from(cluster, c => c.codePointAt(0)!);
      if (points.length > 1024) throw unsupported();
      let end = at, count = 0;
      while (end < glyphs.length && count < points.length) count += glyphs[end++].glyph.codePoints.length;
      if (count !== points.length) throw unsupported();
      const members = glyphs.slice(at, end), unused = [...members];
      const originalPoints = [...points];
      const logical: number[][] = [];
      while (points.length) {
        const index = unused.findIndex(g => g.glyph.codePoints.length && g.glyph.codePoints.every((cp, i) => points[i] === cp));
        if (index < 0) break;
        const codes = unused.splice(index, 1)[0].glyph.codePoints;
        logical.push(codes); points.splice(0, codes.length);
      }
      if (unused.length) {
        // Reph can combine a trailing vowel and leading consonant in one GID.
        // Its Unicode cannot be represented by reordering whole glyph tokens.
        const represented = members.flatMap(g => g.glyph.codePoints).sort((a, b) => a - b);
        if (represented.join(',') !== [...originalPoints].sort((a, b) => a - b).join(',')) throw unsupported();
        let cursor = 0;
        members.forEach(g => { g.unicode = String.fromCodePoint(...originalPoints.slice(cursor, cursor + g.glyph.codePoints.length)); cursor += g.glyph.codePoints.length; });
      } else members.forEach((g, index) => { g.unicode = String.fromCodePoint(...logical[index]); });
      at = end;
    }
    if (at !== glyphs.length) throw unsupported();
    return glyphs;
  });
  if (!occurrences.length || occurrences.length > 65534) throw unsupported();
  // Caller embeds this face without subsetting: GIDs address the original font.
  await font.embed();
  const type0 = doc.context.lookup(font.ref, PDFDict);
  const original = type0.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
  const gids = new Uint8Array((occurrences.length + 1) * 2);
  const widths: (number | number[])[] = [];
  const nextVisible: (number | undefined)[] = [];
  let nextX: number | undefined;
  for (let i = occurrences.length - 1; i >= 0; i--) {
    nextVisible[i] = nextX;
    if (!/[\p{Mn}\s]/u.test(occurrences[i].unicode)) nextX = occurrences[i].x;
  }
  const codes = occurrences.map((g, index) => {
    const cid = index + 1;
    gids[cid * 2] = g.glyph.id >> 8; gids[cid * 2 + 1] = g.glyph.id & 255;
    // Each glyph has an explicit Tm. Use the distance to the next non-mark
    // occurrence as its selection advance; readers ignore combining advances.
    const next = nextVisible[index];
    const width = next !== undefined ? (next - g.x) / size * 1000 : g.glyph.advanceWidth / sourceFont.unitsPerEm * 1000;
    widths.push(cid, [Math.max(0, width)]);
    return hex(cid);
  });
  const mappings: string[] = [];
  for (let start = 0; start < occurrences.length; start += 100) {
    const group = occurrences.slice(start, start + 100);
    mappings.push(`${group.length} beginbfchar`, ...group.map((g, i) => `<${codes[start + i]}> <${utf16(g.unicode)}>`), 'endbfchar');
  }
  const cmap = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Occurrences def', '/CMapType 2 def',
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange', ...mappings,
    'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'].join('\n');
  const cid = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: font.name,
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: original.get(PDFName.of('FontDescriptor')), CIDToGIDMap: doc.context.register(doc.context.flateStream(gids)), W: widths }));
  return { codes, ref: doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: font.name,
    Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: doc.context.register(doc.context.flateStream(cmap)) })) };
}
