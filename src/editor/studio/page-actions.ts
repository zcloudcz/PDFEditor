import { t } from '../i18n';
import { assertPageOperationSupported, rotatePdfPages, PageOperationError } from '../pdf/page-operations';
import { assertFormMergeSupported, mergePdfForms } from '../pdf/form-merge';
import { validateProjectSource, visibleSize } from './document-bridge';
import { sourceReferenceMapping } from './page-identity';
import { remapPageReferences } from '../pdf/page-reference-map';
import { PdfNavigationError } from '../pdf/navigation';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { copyPdfMetadata } from '../pdf/metadata';
import JSZip from 'jszip';
import { exportPdf } from './exports';
import { duplicateElements } from './model';
import { base64Bytes, bytesBase64, validateProject } from './project-io';
import type { StudioProject } from './types';

export interface CropMargins { top: number; right: number; bottom: number; left: number }
function pageOperationFailure(error: unknown): never {
  if (error instanceof PdfNavigationError) {
    const code = error.code === 'limit-exceeded' ? 'limit-exceeded'
      : error.code === 'invalid-input' ? 'invalid-input' : 'unsupported-structure';
    throw new PageOperationError(code);
  }
  throw error;
}
export type PageAction =
  | { kind: 'delete' | 'duplicate' | 'reverse'; indices: number[] }
  | { kind: 'move'; indices: number[]; direction: 'up' | 'down' }
  | { kind: 'rotate'; indices: number[]; angle?: 90 | -90 | 180 }
  | { kind: 'crop'; indices: number[]; margins: CropMargins; unit?: 'pt' | 'mm' };

/** Rebuild only PDF-backed pages; keep design pages and original metadata intact. */
async function normalizeSource(project: StudioProject): Promise<StudioProject> {
  if (!project.sourcePdf) return project;
  const bytes = base64Bytes(project.sourcePdf);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const indices = project.pages.flatMap(page => page.sourcePageIndex === undefined ? [] : [page.sourcePageIndex]);
  if (indices.length === doc.getPageCount() && indices.every((index, position) => index === position)) return project;
  if (!indices.length) {
    await assertPageOperationSupported(bytes, 'extract');
    project.sourcePdf = undefined;
    return project;
  }
  const mapping = sourceReferenceMapping(project, doc.getPageCount());
  const remapped = await remapPageReferences(bytes, mapping).catch(pageOperationFailure);
  let index = 0;
  project.pages.forEach(page => { if (page.sourcePageIndex !== undefined) page.sourcePageIndex = index++; });
  project.sourcePdf = bytesBase64(remapped);
  return project;
}

async function preserveMetadata(source: string | undefined, bytes: Uint8Array): Promise<Uint8Array> {
  if (!source) return bytes;
  const original = await PDFDocument.load(base64Bytes(source), { updateMetadata: false });
  const output = await PDFDocument.load(bytes, { updateMetadata: false });
  copyPdfMetadata(original, output);
  return output.save();
}

function checkSelection(indices: readonly number[], count: number): void {
  if (!indices.length || new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= count)) {
    throw new Error(t('Vyberte stránku.'));
  }
}

/** Human page numbers, comma-separated, with inclusive ascending ranges. */
export function parsePageSelection(input: string, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 200 || input.length > 2000) throw new Error(t('Vyberte stránku.'));
  const indices: number[] = [];
  for (const part of input.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error(t('Vyberte stránku.'));
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > count) throw new Error(t('Vyberte stránku.'));
    for (let page = start; page <= end; page++) indices.push(page - 1);
  }
  checkSelection(indices, count);
  return indices;
}

/** Stage complete changes before the host commits one history checkpoint. */
export async function applyPageAction(project: StudioProject, action: PageAction): Promise<StudioProject> {
  validateProject(project);
  checkSelection(action.indices, project.pages.length);
  if (project.sourcePdf && (action.kind === 'rotate' || action.kind === 'crop')) await assertPageOperationSupported(base64Bytes(project.sourcePdf), action.kind);
  const selected = new Set(action.indices);
  if (action.kind === 'delete' && selected.size === project.pages.length) throw new Error(t('Vyberte stránku.'));
  if (action.kind === 'duplicate' && project.pages.length + selected.size > 200) throw new Error(t('Neplatný nebo příliš velký soubor projektu.'));
  let next = structuredClone(project);
  if (action.kind === 'rotate') {
    const angle = action.angle ?? 90;
    if (![90, -90, 180].includes(angle)) throw new PageOperationError('invalid-angle');
    next = await normalizeSource(next);
    const sourceIndices = action.indices.flatMap(index => next.pages[index].sourcePageIndex === undefined ? [] : [next.pages[index].sourcePageIndex]);
    if (next.sourcePdf && sourceIndices.length) next.sourcePdf = bytesBase64(await rotatePdfPages(base64Bytes(next.sourcePdf), sourceIndices, angle));
    for (const index of selected) {
      const page = next.pages[index];
      const oldWidth = page.width, oldHeight = page.height;
      if (angle !== 180) [page.width, page.height] = [page.height, page.width];
      for (const object of page.objects) {
        const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
        const center = angle === 90 ? [oldHeight - cy, cx] : angle === -90 ? [cy, oldWidth - cx] : [oldWidth - cx, oldHeight - cy];
        object.x = center[0] - object.width / 2;
        object.y = center[1] - object.height / 2;
        object.rotation = ((object.rotation + angle) % 360 + 360) % 360;
      }
    }
  } else if (action.kind === 'crop') {
    if (action.unit !== undefined && action.unit !== 'pt' && action.unit !== 'mm') throw new PageOperationError('invalid-crop');
    const factor = action.unit === 'mm' ? 72 / 25.4 : 1;
    const top = action.margins.top * factor, right = action.margins.right * factor;
    const bottom = action.margins.bottom * factor, left = action.margins.left * factor;
    if (![top, right, bottom, left].every(value => Number.isFinite(value) && value >= 0)) throw new PageOperationError('invalid-crop');
    for (const index of selected) {
      const page = next.pages[index];
      if (page.width - left - right < 1 || page.height - top - bottom < 1) throw new PageOperationError('invalid-crop');
    }
    next = await normalizeSource(next);
    const bytes = next.sourcePdf ? base64Bytes(next.sourcePdf) : undefined;
    const source = bytes ? await PDFDocument.load(bytes, { updateMetadata: false }) : undefined;
    for (const index of selected) {
      const page = next.pages[index];
      if (page.sourcePageIndex !== undefined && source && bytes) {
        const pdfPage = source.getPage(page.sourcePageIndex);
        const media = pdfPage.getMediaBox(), crop = pdfPage.getCropBox();
        const x = Math.max(media.x, crop.x), y = Math.max(media.y, crop.y);
        const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
        const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
        const unit = pdfPage.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
        const rotation = ((pdfPage.getRotation().angle % 360) + 360) % 360;
        if (width <= 0 || height <= 0 || !Number.isFinite(unit) || unit <= 0 || ![0, 90, 180, 270].includes(rotation)) throw new PageOperationError('invalid-crop');
        // Margins are measured from the currently visible top/left, not raw PDF axes.
        const edges = rotation === 90 ? [top, left, bottom, right] : rotation === 180 ? [right, top, left, bottom] : rotation === 270 ? [bottom, right, top, left] : [left, bottom, right, top];
        // One parsed PDF/save for the entire range, even with mixed page sizes.
        pdfPage.setCropBox(x + edges[0] / unit, y + edges[1] / unit,
          width - (edges[0] + edges[2]) / unit, height - (edges[1] + edges[3]) / unit);
      }
      page.width -= left + right; page.height -= top + bottom;
      for (const object of page.objects) { object.x -= left; object.y -= top; }
    }
    if (source) next.sourcePdf = bytesBase64(await source.save());
  } else {
    if (action.kind === 'delete') next.pages = next.pages.filter((_, index) => !selected.has(index));
    if (action.kind === 'duplicate') next.pages = next.pages.flatMap((page, index) => selected.has(index) ? [page, {
      ...structuredClone(page), id: crypto.randomUUID(), objects: duplicateElements(page.objects, 0),
    }] : [page]);
    if (action.kind === 'reverse') {
      const positions = [...selected].sort((a, b) => a - b);
      const pages = positions.map(index => next.pages[index]).reverse();
      positions.forEach((index, offset) => { next.pages[index] = pages[offset]; });
    }
    if (action.kind === 'move') {
      if (action.direction !== 'up' && action.direction !== 'down') throw new PageOperationError('invalid-selection');
      const selectedIds = new Set(action.indices.map(index => next.pages[index].id));
      if (action.direction === 'up') {
        for (let index = 1; index < next.pages.length; index++) {
          if (selectedIds.has(next.pages[index].id) && !selectedIds.has(next.pages[index - 1].id)) {
            [next.pages[index - 1], next.pages[index]] = [next.pages[index], next.pages[index - 1]];
          }
        }
      } else {
        for (let index = next.pages.length - 2; index >= 0; index--) {
          if (selectedIds.has(next.pages[index].id) && !selectedIds.has(next.pages[index + 1].id)) {
            [next.pages[index], next.pages[index + 1]] = [next.pages[index + 1], next.pages[index]];
          }
        }
      }
    }
    validateProject(next);
    // Materialize page structure now so unsupported exports fail before committing.
    next = await normalizeSource(next);
  }
  await validateProjectSource(next);
  return next;
}

/** Append local PDFs without baking current graphic overlays into the source. */
export async function mergeProjectPdfs(project: StudioProject, inputs: readonly Uint8Array[]): Promise<StudioProject> {
  validateProject(project);
  if (!inputs.length) throw new PageOperationError('invalid-input');
  if (project.sourcePdf) await assertFormMergeSupported(base64Bytes(project.sourcePdf));
  // Validate all files before changing even the staged project.
  let count = project.pages.length;
  for (const input of inputs) {
    await assertFormMergeSupported(input);
    count += (await PDFDocument.load(input, { updateMetadata: false })).getPageCount();
    if (count > 200) throw new PageOperationError('limit-exceeded');
  }
  const next = await normalizeSource(structuredClone(project));
  const base = next.sourcePdf ? base64Bytes(next.sourcePdf) : undefined;
  const offset = base ? (await PDFDocument.load(base)).getPageCount() : 0;
  const bytes = await mergePdfForms(base ? [base, ...inputs] : inputs);
  const merged = await PDFDocument.load(bytes);
  for (let sourcePageIndex = offset; sourcePageIndex < merged.getPageCount(); sourcePageIndex++) {
    next.pages.push({ id: crypto.randomUUID(), name: `Page ${next.pages.length + 1}`, ...visibleSize(merged.getPage(sourcePageIndex)), background: '#ffffff', sourcePageIndex, objects: [] });
  }
  next.sourcePdf = bytesBase64(bytes);
  await validateProjectSource(next);
  return next;
}

/** One PDF per selected page, packaged as one download to avoid browser multi-download prompts. */
export async function splitProjectPages(project: StudioProject, indices: number[]): Promise<Uint8Array> {
  validateProject(project); checkSelection(indices, project.pages.length);
  const zip = new JSZip();
  let size = 0;
  for (const index of indices) {
    const bytes = await exportSelectedPages(project, [index]);
    size += bytes.byteLength;
    if (size > 100 * 1024 * 1024) throw new PageOperationError('limit-exceeded');
    zip.file(`page-${String(index + 1).padStart(3, '0')}.pdf`, bytes);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Include graphic overlays once in output; leave the editable project untouched. */
export async function exportSelectedPages(project: StudioProject, indices: number[]): Promise<Uint8Array> {
  validateProject(project);
  checkSelection(indices, project.pages.length);
  const selection = structuredClone(project);
  selection.pages = indices.map(index => selection.pages[index]);
  try { return await preserveMetadata(project.sourcePdf, await exportPdf(selection)); }
  catch (error) { return pageOperationFailure(error); }
}
