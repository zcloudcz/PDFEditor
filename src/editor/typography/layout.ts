import { shapeText, type TextOptions } from './shape';
import type { StudioObject } from '../studio/types';
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function glyphPose(x: number, y: number, baseline: number, object?: StudioObject): { x: number; y: number; angle: number } {
  if (!object?.textPath) return { x, y: baseline - y, angle: 0 };
  const radius = object.textPath.radius, angle = (x - object.width / 2) / radius;
  return { x: object.width / 2 + Math.sin(angle) * (radius + y), y: baseline + radius * (1 - Math.cos(angle)) - Math.cos(angle) * y, angle };
}
/** Outlined SVG is deliberately vector artwork; PDF uses selectable embedded glyphs. */
export function glyphRunSvg(run: { text: string; fontFamily: string; fontSize: number; x: number; width: number; color: string; underline: boolean } & TextOptions, baseline: number, object?: StudioObject): string {
  const shaped = shapeText(run.text, run.fontFamily, run.fontSize, run);
  const paths = shaped.segments.flatMap(segment => segment.glyphs.map(({ glyph, x, y }) => {
    const pose = glyphPose(run.x + x, y, baseline, object);
    return `<path data-glyph="${glyph.id}" transform="translate(${pose.x} ${pose.y}) rotate(${pose.angle * 180 / Math.PI}) scale(${shaped.scale} ${-shaped.scale})" d="${glyph.path.toSVG()}"/>`;
  })).join('');
  const outline = object && object.stroke !== 'none' && object.strokeWidth > 0;
  // Font paths use font units; convert the requested point-sized stroke.
  const stroked = outline ? paths.replaceAll('<path ', `<path stroke="${object.stroke}" stroke-width="${object.strokeWidth / shaped.scale}" `) : paths;
  const shadow = object?.textShadow;
  let body = shadow ? `<g transform="translate(${shadow.x} ${shadow.y})" fill="${shadow.color}" fill-opacity="${shadow.opacity * (object?.opacity ?? 1)}">${paths}</g>` : '';
  if (object?.textGradient) {
    const id = `text-${Array.from(`${object.id}:${baseline}:${run.x}`, c => c.codePointAt(0)!.toString(16)).join('-')}`;
    if (outline) body += `<g fill="none">${stroked}</g>`;
    body += `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${object.width}" y2="0"><stop offset="0" stop-color="${object.textGradient.from}"/><stop offset="1" stop-color="${object.textGradient.to}"/></linearGradient><clipPath id="${id}-clip">${paths}</clipPath></defs><g clip-path="url(#${id}-clip)"><rect x="-14400" y="-14400" width="28800" height="28800" fill="url(#${id})"/></g>`;
  } else body += stroked;
  if (run.underline) body += `<path d="M${run.x} ${baseline + run.fontSize * 0.1}h${run.width}" fill="none" stroke="${run.color}" stroke-width="${Math.max(0.5, run.fontSize / 16)}"/>`;
  return `<g aria-label="${xml(run.text)}" font-family="${xml(run.fontFamily)}" font-size="${run.fontSize}" y="${baseline}" fill="${run.color}" fill-opacity="${object?.opacity ?? 1}" stroke-opacity="${object?.opacity ?? 1}"${run.underline ? ' text-decoration="underline"' : ''}>${body}</g>`;
}

