import { isDesignPage, designPagePredicate, verifyDesignProvenance } from './design-provenance';
import { t } from '../i18n';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFDict, PDFOperator, PDFOperatorNames,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  beginText, endText, setFontAndSize, setTextMatrix, showText, PDFHexString, setFillingRgbColor, setGraphicsState,
  setStrokingRgbColor, setLineWidth, setTextRenderingMode, TextRenderingMode,
  type PDFPage,
  type PDFFont,
} from 'pdf-lib';
import JSZip from 'jszip';
import type { StudioObject, StudioPage, StudioProject } from './types';
import { base64Bytes, bytesBase64, validateProject } from './project-io';
import { assertTextGlyphs, getTextRuns, layoutText, prepareTextFonts, textRunFamily } from './text-layout';
import { assertPageOperationSupported, PageOperationError } from '../pdf/page-operations';
import { copyPdfMetadata } from '../pdf/metadata';
import { fontBytes, pdfFontkit } from '../typography/fonts';
import { shapeText } from '../typography/shape';
import { devanagariPdfFont } from '../typography/pdf-glyphs';
import { glyphRunSvg, glyphPose } from '../typography/layout';
import { editedImageDataUrl } from './image-effects';
import { remapPageReferences } from '../pdf/page-reference-map';
import { PdfNavigationError } from '../pdf/navigation';
import { sourceReferenceMapping } from './page-identity';
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!
  );
const getPage = (p: StudioProject, id: string) => {
  const page = p.pages.find((x) => x.id === id);
  if (!page) throw new Error(t('Stránka neexistuje.'));
  return page;
};
async function pdfJs() {
  const mod = await import('pdfjs-dist');
  mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return mod;
}
async function sourcePage(project: StudioProject, page: StudioPage) {
  const pdfjs = await pdfJs();
  const doc = await pdfjs.getDocument({
    data: base64Bytes(project.sourcePdf!),
    isEvalSupported: false,
    standardFontDataUrl: '/pdfjs-viewer/standard_fonts/',
  }).promise;
  try {
    return { doc, page: await doc.getPage(page.sourcePageIndex! + 1) };
  } catch (e) {
    await doc.destroy();
    throw e;
  }
}
export function pdfBackgroundScale(
  width: number,
  height: number,
  requested?: number
): number {
  const scale =
    requested ??
    Math.min(
      1.5,
      1600 / Math.max(width, height),
      Math.sqrt(4000000 / (width * height))
    );
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 8 ||
    Math.ceil(width * scale) * Math.ceil(height * scale) > 40000000
  )
    throw new Error(t('Export resolution exceeds the canvas limit.'));
  return scale;
}
export async function renderPdfBackground(
  project: StudioProject,
  pageId: string,
  requestedScale?: number
): Promise<string | null> {
  const page = getPage(project, pageId);
  if (page.sourcePageIndex === undefined) return null;
  const source = await sourcePage(project, page);
  try {
    const natural = source.page.getViewport({ scale: 1 });
    const scale = pdfBackgroundScale(
      natural.width,
      natural.height,
      requestedScale
    );
    const viewport = source.page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await source.page.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    await source.doc.destroy();
  }
}
function objectSvg(o: StudioObject, resolvedImage?: string): string {
  const style = `fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.strokeWidth}"`;
  let body = '';
  if (o.kind === 'rect')
    body = `<rect width="${o.width}" height="${o.height}" ${style}/>`;
  if (o.kind === 'ellipse')
    body = `<ellipse cx="${o.width / 2}" cy="${o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" ${style}/>`;
  if (o.kind === 'line' || o.kind === 'arrow') {
    body = `<path d="M0 0 L${o.width} ${o.height}" fill="none" stroke="${o.stroke}" stroke-width="${o.strokeWidth}"/>`;
    if (o.kind === 'arrow') {
      const a = Math.atan2(o.height, o.width),
        s = Math.max(8, o.strokeWidth * 4);
      body += `<path d="M${o.width - s * Math.cos(a - 0.5)} ${o.height - s * Math.sin(a - 0.5)} L${o.width} ${o.height} L${o.width - s * Math.cos(a + 0.5)} ${o.height - s * Math.sin(a + 0.5)}" fill="none" stroke="${o.stroke}" stroke-width="${o.strokeWidth}"/>`;
    }
  }
  if (o.kind === 'path')
    body = `<path d="${xml(o.path!)}" transform="scale(${o.width / 100} ${o.height / 100})" ${style}/>`;
  if (o.kind === 'text') {
    body = layoutText(o).lines.map(line => line.runs.map(run => glyphRunSvg(run, line.y, o)).join('')).join('');
  }
  if (o.kind === 'image') {
    body = `<image width="${o.width}" height="${o.height}" preserveAspectRatio="none" href="${resolvedImage ?? o.src}"/>`;
  }
  return `<g opacity="${o.kind === 'text' ? 1 : o.opacity}" transform="translate(${o.x + o.width / 2} ${o.y + o.height / 2}) rotate(${o.rotation}) translate(${-o.width / 2} ${-o.height / 2})">${body}</g>`;
}
async function pageSvg(page: StudioPage, background?: string | null) {
  if (page.objects.some(o => o.kind === 'text')) await prepareTextFonts(page.objects);
  page.objects.filter(o => o.kind === 'text').forEach(o => assertTextGlyphs(o, 'svg'));
  const images = new Map(await Promise.all(page.objects.filter(o => o.kind === 'image').map(async o =>
    [o.id, await editedImageDataUrl(o)] as const)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><rect width="100%" height="100%" fill="${page.background}"/>${background ? `<image width="${page.width}" height="${page.height}" href="${background}"/>` : ''}${page.objects.map(o => objectSvg(o, images.get(o.id))).join('')}</svg>`;
}
export async function exportSvg(
  project: StudioProject,
  pageId: string
): Promise<string> {
  validateProject(project);
  const page = getPage(project, pageId);
  await verifyDesignProvenance(project);
  if (!isDesignPage(project, page))
    throw new Error(
      t('SVG export podporuje pouze návrhové stránky bez původního PDF. Použijte PDF pro zachování vektorů.')
    );
  return pageSvg(page);
}
function image(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('Obrázek nelze načíst.')));
    img.src = src;
  });
}
export async function renderPage(
  project: StudioProject,
  pageId: string,
  scale = 1
): Promise<HTMLCanvasElement> {
  validateProject(project);
  const page = getPage(project, pageId);
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 8 ||
    page.width * page.height * scale * scale > 40000000
  )
    throw new Error(t('Výstupní rozlišení je příliš velké.'));
  const svg = await pageSvg(
    page,
    await renderPdfBackground(project, pageId, scale)
  );
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await image(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(page.width * scale);
    canvas.height = Math.ceil(page.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function exportImages(
  project: StudioProject,
  options: {
    format: 'png' | 'jpeg' | 'webp';
    scale?: number;
    pageIds?: string[];
    quality?: number;
  }
): Promise<{ bytes: Uint8Array; mime: string; extension: string }> {
  const ids = options.pageIds ?? project.pages.map((p) => p.id);
  if (!ids.length) throw new Error(t('Vyberte stránku.'));
  const mime = `image/${options.format}`,
    ext = options.format === 'jpeg' ? 'jpg' : options.format;
  const zip = new JSZip();
  let bytes = new Uint8Array();
  for (let i = 0; i < ids.length; i++) {
    const canvas = await renderPage(project, ids[i], options.scale ?? 1);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error(t('Formát obrázku není podporován.'))),
        mime,
        options.quality ?? 0.92
      )
    );
    if (blob.type !== mime)
      throw new Error(t('Prohlížeč nepodporuje tento výstupní formát.'));
    bytes = new Uint8Array(await blob.arrayBuffer());
    if (ids.length > 1) zip.file(`page-${i + 1}.${ext}`, bytes);
  }
  return ids.length === 1
    ? { bytes, mime, extension: ext }
    : {
        bytes: await zip.generateAsync({ type: 'uint8array' }),
        mime: 'application/zip',
        extension: 'zip',
      };
}
const pdfColor = (hex: string) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  );
export function pdfPageViewportInverse(
  page: PDFPage
): [number, number, number, number, number, number] {
  const crop = page.getCropBox(),
    media = page.getMediaBox();
  const left = Math.max(crop.x, media.x),
    bottom = Math.max(crop.y, media.y),
    right = Math.min(crop.x + crop.width, media.x + media.width),
    top = Math.min(crop.y + crop.height, media.y + media.height);
  const c =
    right > left && top > bottom
      ? { x: left, y: bottom, width: right - left, height: top - bottom }
      : media;
  const rawUnit =
    page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
  const u = rawUnit > 0 ? 1 / rawUnit : 1;
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  switch (r) {
    case 90:
      return [0, u, u, 0, c.x, c.y];
    case 180:
      return [-u, 0, 0, u, c.x + c.width, c.y];
    case 270:
      return [0, -u, -u, 0, c.x + c.width, c.y + c.height];
    default:
      return [u, 0, 0, -u, c.x, c.y + c.height];
  }
}
async function drawPdfObject(
  doc: PDFDocument,
  page: PDFPage,
  o: StudioObject,
  fonts: Map<string, PDFFont>
) {
  if (o.fill === 'none' && o.stroke === 'none' && o.kind !== 'image' && o.kind !== 'text') return;
  const a = (o.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      c,
      s,
      -s,
      c,
      o.x + o.width / 2,
      o.y + o.height / 2
    ),
    concatTransformationMatrix(1, 0, 0, 1, -o.width / 2, -o.height / 2)
  );
  const color = o.fill === 'none' ? undefined : pdfColor(o.fill),
    borderColor = o.stroke === 'none' ? undefined : pdfColor(o.stroke);
  const opts = {
    color,
    borderColor,
    borderWidth: o.strokeWidth,
    opacity: o.opacity,
    borderOpacity: o.opacity,
  };
  if (o.kind === 'rect')
    page.drawRectangle({
      x: 0,
      y: 0,
      width: o.width,
      height: o.height,
      ...opts,
    });
  if (o.kind === 'ellipse')
    page.drawEllipse({
      x: o.width / 2,
      y: o.height / 2,
      xScale: o.width / 2,
      yScale: o.height / 2,
      ...opts,
    });
  if (o.kind === 'line' || o.kind === 'arrow') {
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      if (borderColor)
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: borderColor,
          thickness: o.strokeWidth,
          opacity: o.opacity,
        });
    };
    line(0, 0, o.width, o.height);
    if (o.kind === 'arrow') {
      const a = Math.atan2(o.height, o.width),
        l = Math.max(8, o.strokeWidth * 4);
      line(
        o.width,
        o.height,
        o.width - l * Math.cos(a - 0.5),
        o.height - l * Math.sin(a - 0.5)
      );
      line(
        o.width,
        o.height,
        o.width - l * Math.cos(a + 0.5),
        o.height - l * Math.sin(a + 0.5)
      );
    }
  }
  if (o.kind === 'path') {
    page.pushOperators(
      concatTransformationMatrix(o.width / 100, 0, 0, -o.height / 100, 0, 0)
    );
    page.drawSvgPath(o.path!, { x: 0, y: 0, ...opts });
  }
  if (o.kind === 'text') {
    page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
    for (const line of layoutText(o).lines) for (const run of line.runs) {
      const outline = o.stroke !== 'none' && o.strokeWidth > 0;
      if (run.color === 'none' && !outline && !o.textGradient) continue;
      const size = run.fontSize, color = pdfColor(run.color === 'none' ? '#000000' : run.color);
      const font = fonts.get(run.fontFamily);
      if (!font) throw new Error(t('Lokální písmo nelze načíst.'));
      const shaped = shapeText(run.text, run.fontFamily, size, run);
      if (o.textShadow) {
        for (const segment of shaped.segments) for (const glyph of segment.glyphs) {
          const pose = glyphPose(run.x + glyph.x, glyph.y, line.y, o), c = Math.cos(pose.angle), s = Math.sin(pose.angle);
          page.pushOperators(pushGraphicsState(), concatTransformationMatrix(c, -s, s, c, pose.x + o.textShadow.x, -pose.y - o.textShadow.y), concatTransformationMatrix(1, 0, 0, -1, 0, 0));
          page.drawSvgPath(glyph.glyph.path.toSVG(), { x: 0, y: 0, scale: shaped.scale, color: pdfColor(o.textShadow.color), opacity: o.opacity * o.textShadow.opacity });
          page.pushOperators(popGraphicsState());
        }
      }
      const occurrenceFont = run.fontFamily.startsWith('Noto Sans Devanagari') ? await devanagariPdfFont(doc, font, run.fontFamily, shaped, size) : undefined;
      const key = page.node.newFontDictionary(font.name, occurrenceFont?.ref ?? font.ref);
      const opacity = page.node.newExtGState('TextOpacity', doc.context.obj({ Type: 'ExtGState', ca: o.opacity, CA: o.opacity }));
      page.pushOperators(pushGraphicsState(), setGraphicsState(opacity), beginText(), setFontAndSize(key, size), setFillingRgbColor(color.red, color.green, color.blue));
      if (outline) { const stroke = pdfColor(o.stroke); page.pushOperators(setStrokingRgbColor(stroke.red, stroke.green, stroke.blue), setLineWidth(o.strokeWidth)); }
      page.pushOperators(setTextRenderingMode(o.textGradient ? (outline ? TextRenderingMode.OutlineAndClip : TextRenderingMode.Clip) : outline ? (run.color === 'none' ? TextRenderingMode.Outline : TextRenderingMode.FillAndOutline) : TextRenderingMode.Fill));
      let occurrence = 0;
      for (const segment of shaped.segments) {
        // Encode the whole shaped segment once: one CID per resulting glyph,
        // including ligatures. Never encode individual Unicode characters.
        const codes = occurrenceFont ? occurrenceFont.codes.slice(occurrence, occurrence + segment.glyphs.length) : font.encodeText(segment.text).asString().match(/.{4}/g) ?? [];
        occurrence += segment.glyphs.length;
        if (codes.length !== segment.glyphs.length) throw new Error(t('Tento textový profil zatím nelze věrně exportovat.'));
        for (const [index, glyph] of segment.glyphs.entries()) {
          const pose = glyphPose(run.x + glyph.x, glyph.y, line.y, o), c = Math.cos(pose.angle), s = Math.sin(pose.angle);
          page.pushOperators(setTextMatrix(c, -s, s, c, pose.x, -pose.y), showText(PDFHexString.of(codes[occurrenceFont ? index : glyph.encodedIndex])));
        }
      }
      page.pushOperators(endText());
      if (o.textGradient) {
        const from = pdfColor(o.textGradient.from), to = pdfColor(o.textGradient.to);
        const shading = doc.context.register(doc.context.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, o.width, 0],
          Function: { FunctionType: 2, Domain: [0, 1], C0: [from.red, from.green, from.blue], C1: [to.red, to.green, to.blue], N: 1 }, Extend: [true, true] }));
        const resources = page.node.Resources()!;
        let shadings = resources.lookupMaybe(PDFName.of('Shading'), PDFDict);
        if (!shadings) { shadings = doc.context.obj({}); resources.set(PDFName.of('Shading'), shadings); }
        const name = PDFName.of(`TextGradient${shading.objectNumber}`); shadings.set(name, shading);
        page.pushOperators(PDFOperator.of(PDFOperatorNames.ShadingFill, [name]));
      }
      page.pushOperators(popGraphicsState());
      if (run.underline && run.color !== 'none') page.drawLine({ start: { x: run.x, y: -line.y - size * 0.1 }, end: { x: run.x + run.width, y: -line.y - size * 0.1 }, thickness: Math.max(0.5, size / 16), color, opacity: o.opacity });
    }
  }
  if (o.kind === 'image') {
    let src = o.src!;
    if (o.crop || o.imageFit || o.imageMask || o.imageAdjustments || o.imageCutout || src.startsWith('data:image/webp') || src.startsWith('data:image/jpeg')) src = await editedImageDataUrl(o);
    const embedded = src.startsWith('data:image/jpeg')
      ? await doc.embedJpg(src)
      : await doc.embedPng(src);
    page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
    page.drawImage(embedded, {
      x: 0,
      y: -o.height,
      width: o.width,
      height: o.height,
      opacity: o.opacity,
    });
  }
  page.pushOperators(popGraphicsState());
}
export async function exportPdf(project: StudioProject): Promise<Uint8Array> {
  validateProject(project);
  // Regenerate only proven synthetic backgrounds; original native content stays intact.
  const isDesign = designPagePredicate(project);
  if (project.pages.some(page => page.syntheticBackground && isDesign(page))) {
    project = structuredClone(project);
    for (const page of project.pages) if (page.syntheticBackground && isDesign(page)) {
      delete page.sourcePageIndex; delete page.syntheticBackground;
    }
  }
  let source = project.sourcePdf
    ? await PDFDocument.load(base64Bytes(project.sourcePdf), { updateMetadata: false })
    : undefined;
  let preserveSource =
    !!source &&
    project.pages.length === source.getPageCount() &&
    project.pages.every((p, i) => p.sourcePageIndex === i);
  if (source && !preserveSource) {
    try {
      if (project.pages.some(page => page.sourcePageIndex !== undefined)) {
        source = await PDFDocument.load(await remapPageReferences(
          base64Bytes(project.sourcePdf!), sourceReferenceMapping(project, source.getPageCount())
        ), { updateMetadata: false });
        // Insert in the same context so remapped destinations retain their page references.
        project.pages.forEach((page, index) => {
          if (page.sourcePageIndex === undefined) source!.insertPage(index, [page.width, page.height]);
        });
        preserveSource = true;
      } else await assertPageOperationSupported(base64Bytes(project.sourcePdf!), 'extract');
    }
    catch (error) {
      const failure = error instanceof PdfNavigationError ? new PageOperationError(error.code === 'limit-exceeded' ? 'limit-exceeded' : 'unsupported-structure') : error;
      if (failure instanceof PageOperationError && failure.code === 'unsupported-structure') {
        failure.message = t('Změna pořadí nebo počtu stránek PDF s formuláři, záložkami nebo přílohami není podporována. Zachovejte původní stránky pro bezpečný export.');
      }
      throw failure;
    }
  }
  const doc = preserveSource ? source! : await PDFDocument.create();
  if (source && !preserveSource) copyPdfMetadata(source, doc);
  doc.registerFontkit(pdfFontkit);
  const fonts = new Map<string, PDFFont>();
  if (project.pages.some(p => p.objects.some(o => o.kind === 'text'))) await prepareTextFonts(project.pages.flatMap(p => p.objects));
  for (const o of project.pages
    .flatMap((p) => p.objects)
    .filter((o) => o.kind === 'text')) {
    assertTextGlyphs(o);
    for (const family of new Set(getTextRuns(o).map(run => textRunFamily(o, run)))) {
      if (!fonts.has(family))
      fonts.set(
        family,
        await doc.embedFont(await fontBytes(family), { subset: !family.startsWith('Noto Sans Devanagari') })
      );
    }
  }
  for (const [pageIndex, p] of project.pages.entries()) {
    const page = preserveSource
      ? doc.getPage(pageIndex)
      : p.sourcePageIndex !== undefined
        ? (await doc.copyPages(source!, [p.sourcePageIndex]))[0]
        : doc.addPage([p.width, p.height]);
    if (!preserveSource && p.sourcePageIndex !== undefined) doc.addPage(page);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...pdfPageViewportInverse(page))
    );
    if (p.sourcePageIndex === undefined && p.background !== 'none')
      page.drawRectangle({
        x: 0,
        y: 0,
        width: p.width,
        height: p.height,
        color: pdfColor(p.background),
      });
    for (const o of p.objects)
      await drawPdfObject(
        doc,
        page,
        o,
        fonts
      );
    page.pushOperators(popGraphicsState());
  }
  return doc.save();
}
/** PPTX uses editable text/basic geometry. Native PDF backgrounds and other artwork are raster images. */
export async function exportPptx(project: StudioProject): Promise<Uint8Array> {
  validateProject(project);
  if (project.pages.some(page => page.objects.some(o => o.kind === 'text'))) await prepareTextFonts(project.pages.flatMap(p => p.objects));
  project.pages.flatMap(page => page.objects).filter(o => o.kind === 'text').forEach(o => assertTextGlyphs(o, 'pptx'));
  const zip = new JSZip(),
    ns = 'http://schemas.openxmlformats.org/presentationml/2006/main',
    a = 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const emu = (v: number) => Math.round(v * 12700);
  const w = project.pages[0].width,
    h = project.pages[0].height;
  if (project.pages.some((p) => p.width !== w || p.height !== h))
    throw new Error(t('PPTX vyžaduje stejnou velikost všech stránek.'));
  const rels = (entries: { id: string; type: string; target: string }[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map((e) => `<Relationship Id="${e.id}" Type="${r}/${e.type}" Target="${e.target}"/>`).join('')}</Relationships>`;
  const group =
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const fill = (color: string, opacity = 1) =>
    color === 'none'
      ? '<a:noFill/>'
      : `<a:solidFill><a:srgbClr val="${color.slice(1)}"><a:alpha val="${Math.round(opacity * 100000)}"/></a:srgbClr></a:solidFill>`;
  const xfrm = (o: StudioObject) =>
    `<a:xfrm rot="${Math.round(o.rotation * 60000)}"><a:off x="${emu(o.x)}" y="${emu(o.y)}"/><a:ext cx="${emu(o.width)}" cy="${emu(o.height)}"/></a:xfrm>`;
  let media = 0;
  for (let i = 0; i < project.pages.length; i++) {
    const page = project.pages[i],
      entries = [
        {
          id: 'rId1',
          type: 'slideLayout',
          target: '../slideLayouts/slideLayout1.xml',
        },
      ];
    let body = group,
      id = 2;
    const picture = async (src: string, o: StudioObject) => {
      media++;
      const rid = `rId${entries.length + 1}`;
      zip.file(`ppt/media/image${media}.png`, base64Bytes(src.split(',')[1]));
      entries.push({
        id: rid,
        type: 'image',
        target: `../media/image${media}.png`,
      });
      body += `<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="${xml(o.name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(o)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    };
    const bg = await renderPdfBackground(project, page.id);
    if (bg)
      await picture(bg, {
        x: 0,
        y: 0,
        width: w,
        height: h,
        rotation: 0,
        name: t('Původní PDF (rastrové pozadí)'),
      } as StudioObject);
    for (const o of page.objects) {
      if (o.kind === 'image' || o.kind === 'path') {
        const mini: StudioProject = {
          version: 1,
          name: 'Artwork',
          pages: [
            {
              id: 'art',
              name: 'Artwork',
              width: o.width,
              height: o.height,
              background: 'none',
              objects: [{ ...o, x: 0, y: 0, rotation: 0 }],
            },
          ],
        };
        const canvas = await renderPage(
          mini,
          'art',
          Math.min(2, Math.sqrt(40000000 / (o.width * o.height)))
        );
        await picture(canvas.toDataURL('image/png'), o);
        continue;
      }
      const geometry =
        o.kind === 'ellipse'
          ? 'ellipse'
          : o.kind === 'line' || o.kind === 'arrow'
            ? 'line'
            : 'rect';
      body += `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="${xml(o.name)}"/><p:cNvSpPr${o.kind === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(o)}<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${o.kind === 'text' ? '<a:noFill/>' : fill(o.fill, o.opacity)}<a:ln w="${emu(o.strokeWidth)}">${o.kind === 'text' ? '<a:noFill/>' : fill(o.stroke, o.opacity)}${o.kind === 'arrow' ? '<a:tailEnd type="triangle"/>' : ''}</a:ln></p:spPr>`;
      if (o.kind === 'text')
        body += `<p:txBody><a:bodyPr wrap="none" anchor="${o.verticalAlign === 'middle' ? 'ctr' : o.verticalAlign === 'bottom' ? 'b' : 't'}" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${layoutText(o).lines.map(line =>
          `<a:p><a:pPr algn="${o.textAlign === 'center' ? 'ctr' : o.textAlign === 'right' ? 'r' : 'l'}"><a:lnSpc><a:spcPct val="${Math.round((o.lineHeight ?? 1.2) * 100000)}"/></a:lnSpc>${line.paragraphStart && o.paragraphSpacing ? `<a:spcBef><a:spcPts val="${Math.round(o.paragraphSpacing * 100)}"/></a:spcBef>` : ''}</a:pPr>${line.runs.map(run => `<a:r><a:rPr sz="${Math.round(run.fontSize * 100)}" spc="${Math.round((o.tracking ?? 0) * 100)}"${run.bold ? ' b="1"' : ''}${run.italic ? ' i="1"' : ''}${run.underline ? ' u="sng"' : ''}>${fill(run.color, o.opacity)}<a:latin typeface="Liberation Sans"/></a:rPr><a:t xml:space="preserve">${xml(run.text)}</a:t></a:r>`).join('')}</a:p>`
        ).join('')}</p:txBody>`;
      body += '</p:sp>';
    }
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="${ns}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:bg><p:bgPr>${fill(page.background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    );
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(entries));
  }
  zip.file(
    '_rels/.rels',
    rels([
      { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
    ])
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${ns}" xmlns:a="${a}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${project.pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${emu(w)}" cy="${emu(h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    rels([
      {
        id: 'rId1',
        type: 'slideMaster',
        target: 'slideMasters/slideMaster1.xml',
      },
      ...project.pages.map((_, i) => ({
        id: `rId${i + 2}`,
        type: 'slide',
        target: `slides/slide${i + 1}.xml`,
      })),
    ])
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<p:sldMaster xmlns:p="${ns}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`
  );
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      {
        id: 'rId1',
        type: 'slideLayout',
        target: '../slideLayouts/slideLayout1.xml',
      },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
    ])
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<p:sldLayout xmlns:p="${ns}" xmlns:a="${a}" xmlns:r="${r}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    rels([
      {
        id: 'rId1',
        type: 'slideMaster',
        target: '../slideMasters/slideMaster1.xml',
      },
    ])
  );
  const themeColors = [
    '000000',
    'FFFFFF',
    '1F2937',
    'F3F4F6',
    '2563EB',
    '059669',
    'DC2626',
    '9333EA',
    'EA580C',
    '0891B2',
    '0563C1',
    '954F72',
  ];
  const themeNames = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ];
  const themeFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  zip.file(
    'ppt/theme/theme1.xml',
    `<a:theme xmlns:a="${a}" name="Studio"><a:themeElements><a:clrScheme name="Studio">${themeColors.map((c, i) => `<a:${themeNames[i]}><a:srgbClr val="${c}"/></a:${themeNames[i]}>`).join('')}</a:clrScheme><a:fontScheme name="Liberation"><a:majorFont><a:latin typeface="Liberation Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Liberation Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Studio"><a:fillStyleLst>${themeFill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}">${themeFill}<a:prstDash val="solid"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${themeFill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  );
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>${project.pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`
  );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}


