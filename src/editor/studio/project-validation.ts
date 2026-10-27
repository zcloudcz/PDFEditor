import { t } from '../i18n';
import type { StudioProject } from './types';
import { validateImageCutout } from './image-masks';
import { validateProjectData } from '../data/project-data';
const MAX = 100 * 1024 * 1024;
const fail = (): never => {
  throw new Error(t('Neplatný nebo příliš velký soubor projektu.'));
};
const finite = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max = 10000) =>
  typeof v === 'string' &&
  v.length <= max &&
  !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(
    v
  );
const color = (v: unknown) =>
  typeof v === 'string' && /^(#[0-9a-f]{6}|none)$/i.test(v);
// Native base64 (Chrome/Edge 140+, Firefox 133+, Safari 18.2+) is ~20x faster on large PDFs,
// which autosave and history encode/decode on every change. Older runtimes use the fallbacks.
const nativeBase64 = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
export function base64Bytes(s: string): Uint8Array {
  if (nativeBase64.fromBase64) return nativeBase64.fromBase64(s);
  // Plain loop: Uint8Array.from with a callback per byte was the hottest path for large PDFs.
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function bytesBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
// The same source PDF (tens of MB of base64) is validated many times per save; the regex
// scan over it only needs to run once per distinct source.
let lastValidSource: string | undefined;
export function validateProject(
  value: unknown
): asserts value is StudioProject {
  const p = value as StudioProject;
  if (
    !p ||
    p.version !== 1 ||
    !str(p.name, 300) ||
    !Array.isArray(p.pages) ||
    !p.pages.length ||
    p.pages.length > 200
  )
    fail();
  validateProjectData(p);
  if (
    p.sourcePdf !== undefined &&
    (typeof p.sourcePdf !== 'string' ||
      p.sourcePdf.length > MAX ||
      (p.sourcePdf !== lastValidSource && !/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(p.sourcePdf)))
  )
    fail();
  if (p.sourcePdf !== undefined) lastValidSource = p.sourcePdf;
  const ids = new Set<string>();
  let count = 0;
  for (const page of p.pages) {
    if (
      !page ||
      !str(page.id, 200) ||
      ids.has(page.id) ||
      !str(page.name, 300) ||
      !finite(page.width, 1, 14400) ||
      !finite(page.height, 1, 14400) ||
      !color(page.background) ||
      !Array.isArray(page.objects)
    )
      fail();
    ids.add(page.id);
    if (page.syntheticBackground !== undefined && (typeof page.syntheticBackground !== 'string' || !/^[a-f0-9]{64}$/.test(page.syntheticBackground) || page.sourcePageIndex === undefined)) fail();
    if (
      page.sourcePageIndex !== undefined &&
      (!p.sourcePdf ||
        !Number.isInteger(page.sourcePageIndex) ||
        page.sourcePageIndex < 0 ||
        page.sourcePageIndex > 100000)
    )
      fail();
    for (const o of page.objects) {
      if (
        ++count > 10000 ||
        !o ||
        !str(o.id, 200) ||
        ids.has(o.id) ||
        !str(o.name, 300) ||
        !['rect', 'ellipse', 'line', 'arrow', 'path', 'text', 'image'].includes(
          o.kind
        )
      )
        fail();
      ids.add(o.id);
      if (o.layoutAnchors !== undefined && (!o.layoutAnchors || !['start','center','end','stretch'].includes(o.layoutAnchors.horizontal) ||
          !['start','center','end','stretch'].includes(o.layoutAnchors.vertical) || Object.keys(o.layoutAnchors).some(key => !['horizontal','vertical'].includes(key)))) fail();
      if (
        !finite(o.x, -100000, 100000) ||
        !finite(o.y, -100000, 100000) ||
        !finite(o.width, 0.01, 14400) ||
        !finite(o.height, 0.01, 14400) ||
        !finite(o.rotation, -36000, 36000) ||
        !finite(o.opacity, 0, 1) ||
        !finite(o.strokeWidth, 0, 1000) ||
        !color(o.fill) ||
        !color(o.stroke) ||
        typeof o.locked !== 'boolean'
      )
        fail();
      if (
        o.fontFamily !== undefined &&
        ![
          'Liberation Sans',
          'Liberation Sans Bold',
          'Liberation Sans Italic',
          'Liberation Sans BoldItalic',
          'Arial',
            'Noto Sans Arabic', 'Noto Sans Arabic Bold',
            'Noto Sans Devanagari', 'Noto Sans Devanagari Bold',
            'Noto Sans CJK JP',
        ].includes(o.fontFamily)
      )
        fail();
      if (
        o.kind === 'text' &&
        (!str(o.text, 100000) ||
          !finite(o.fontSize, 1, 2000) ||
          !['left', 'center', 'right', undefined].includes(o.textAlign))
      )
        fail();
      if (o.kind === 'text') {
          if (o.textDirection !== undefined && !['auto', 'ltr', 'rtl'].includes(o.textDirection)) fail();
          if (o.textLanguage !== undefined && !['und', 'cs', 'en', 'ar', 'hi', 'ja'].includes(o.textLanguage)) fail();
        if (o.verticalAlign !== undefined && !['top', 'middle', 'bottom'].includes(o.verticalAlign)) fail();
        if (o.lineHeight !== undefined && !finite(o.lineHeight, 0.5, 5)) fail();
        if (o.paragraphSpacing !== undefined && !finite(o.paragraphSpacing, 0, 500)) fail();
        if (o.tracking !== undefined && !finite(o.tracking, 0, 100)) fail();
        if (o.textShadow !== undefined && (!o.textShadow || !finite(o.textShadow.x, -500, 500) || !finite(o.textShadow.y, -500, 500) ||
            !color(o.textShadow.color) || o.textShadow.color === 'none' || !finite(o.textShadow.opacity, 0, 1) || Object.keys(o.textShadow).some(key => !['x','y','color','opacity'].includes(key)))) fail();
        if (o.textGradient !== undefined && (!o.textGradient || !color(o.textGradient.from) || !color(o.textGradient.to) ||
            o.textGradient.from === 'none' || o.textGradient.to === 'none' || Object.keys(o.textGradient).some(key => !['from','to'].includes(key)))) fail();
        if (o.textPath !== undefined && (!o.textPath || !finite(o.textPath.radius, 10, 10000) || Object.keys(o.textPath).some(key => key !== 'radius'))) fail();
        if (o.wrapText !== undefined && typeof o.wrapText !== 'boolean') fail();
        if (o.underline !== undefined && typeof o.underline !== 'boolean') fail();
        if (o.textRuns !== undefined) {
          if (!Array.isArray(o.textRuns) || o.textRuns.length > 10000) fail();
          let length = 0;
          for (const run of o.textRuns) {
            if (!run || !str(run.text, 100000)) fail();
            if (run.fontSize !== undefined && !finite(run.fontSize, 1, 2000)) fail();
            if (run.color !== undefined && !color(run.color)) fail();
            length += run.text.length;
            if (length > 100000 || ['bold', 'italic', 'underline'].some(key => {
              const value = run[key as 'bold' | 'italic' | 'underline'];
              return value !== undefined && typeof value !== 'boolean';
            })) fail();
          }
          if (o.textRuns.map(run => run.text).join('') !== o.text) fail();
        }
      }
      if (o.kind !== 'text' && [o.paragraphSpacing, o.tracking, o.textShadow, o.textGradient, o.textPath].some(value => value !== undefined)) fail();
      if (
        o.kind === 'path' &&
        (!str(o.path, 100000) ||
          !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(o.path!))
      )
        fail();
      if (
        o.kind === 'image' &&
        (!str(o.src, MAX) ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
            o.src!
          ))
      )
        fail();
      if (o.imageFit !== undefined && (o.kind !== 'image' || !['stretch', 'contain', 'cover'].includes(o.imageFit))) fail();
      if (o.imageCutout !== undefined && (o.kind !== 'image' || !validateImageCutout(o.imageCutout))) fail();
      if (o.imageMask !== undefined) {
        const mask = o.imageMask;
        if (o.kind !== 'image' || !mask || !['circle', 'rounded'].includes(mask.kind) ||
            (mask.kind === 'rounded' && !finite(mask.radius, 0, 0.5)) ||
            (mask.kind === 'circle' && Object.keys(mask).some(key => key !== 'kind'))) fail();
      }
      if (o.imageAdjustments !== undefined) {
        const effects = o.imageAdjustments;
        if (o.kind !== 'image' || !effects || !finite(effects.brightness, 0, 2) ||
            !finite(effects.contrast, 0, 2) || !finite(effects.saturation, 0, 2) ||
            !finite(effects.blur, 0, 20) ||
            Object.keys(effects).some(key => !['brightness', 'contrast', 'saturation', 'blur'].includes(key))) fail();
      }
      if (o.imageProvenance !== undefined) {
        const provenance = o.imageProvenance;
        if (o.kind !== 'image' || !provenance ||
            !(provenance.kind === 'local-upload' && provenance.license === 'unspecified' && provenance.source === 'local upload') &&
            !(provenance.kind === 'user-declared' && str(provenance.license, 100) && !!provenance.license.trim() &&
              str(provenance.source, 500) && !!provenance.source.trim()) ||
            Object.keys(provenance).some(key => !['kind', 'license', 'source'].includes(key))) fail();
      }
      if (o.brandRoles !== undefined) {
        const roles = o.brandRoles;
        if (!roles || typeof roles !== 'object' ||
            Object.keys(roles).some(key => !['fill', 'stroke', 'textStyle'].includes(key)) ||
            (roles.fill !== undefined && !['primary', 'accent', 'paper'].includes(roles.fill)) ||
            (roles.stroke !== undefined && !['primary', 'accent', 'paper'].includes(roles.stroke)) ||
            (roles.textStyle !== undefined && (o.kind !== 'text' || !['heading', 'body'].includes(roles.textStyle)))) fail();
      }
      if (
        o.crop &&
        (!finite(o.crop.x, 0, 1) ||
          !finite(o.crop.y, 0, 1) ||
          !finite(o.crop.width, 0.0001, 1) ||
          !finite(o.crop.height, 0.0001, 1) ||
          o.crop.x + o.crop.width > 1.000001 ||
          o.crop.y + o.crop.height > 1.000001)
      )
        fail();
    }
  }
}

