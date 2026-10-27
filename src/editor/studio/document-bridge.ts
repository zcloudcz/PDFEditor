import { designPagePredicate, markSyntheticPages, verifyDesignProvenance } from './design-provenance';
import { t } from '../i18n';
import { PDFDocument, PDFName, PDFNumber, type PDFPage } from 'pdf-lib';
import { exportPdf } from './exports';
import { bytesBase64, base64Bytes, validateProject } from './project-io';
import type { StudioProject } from './types';

/** Match PDF.js visible page dimensions, including cropped/rotated user space. */
export function visibleSize(page: PDFPage): { width: number; height: number } {
  const crop = page.getCropBox(),
    media = page.getMediaBox();
  const width =
    Math.min(crop.x + crop.width, media.x + media.width) -
    Math.max(crop.x, media.x);
  const height =
    Math.min(crop.y + crop.height, media.y + media.height) -
    Math.max(crop.y, media.y);
  const visible = width > 0 && height > 0 ? { width, height } : media;
  const rawUnit =
    page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
  const unit = rawUnit > 0 ? rawUnit : 1;
  const rotated = ((page.getRotation().angle % 180) + 180) % 180 !== 0;
  return {
    width: (rotated ? visible.height : visible.width) * unit,
    height: (rotated ? visible.width : visible.height) * unit,
  };
}

/** Check embedded PDF references before replacing the currently open project. */
export async function validateProjectSource(project: StudioProject): Promise<void> {
  validateProject(project);
  if (!project.sourcePdf) return;
  const source = await PDFDocument.load(base64Bytes(project.sourcePdf));
  for (const page of project.pages) {
    if (page.sourcePageIndex === undefined) continue;
    if (page.sourcePageIndex >= source.getPageCount()) throw new Error(t('Projekt odkazuje na neexistující stránku PDF.'));
    const size = visibleSize(source.getPage(page.sourcePageIndex));
    if (Math.abs(size.width - page.width) > 0.1 || Math.abs(size.height - page.height) > 0.1) {
      throw new Error(t('Rozměry návrhu neodpovídají vloženému PDF. Projekt nelze bezpečně otevřít.'));
    }
  }
  await verifyDesignProvenance(project);
}

/** Native editing receives only the PDF base; design objects remain independently editable. */
export async function prepareNativeDocument(
  project: StudioProject
): Promise<{ bytes: Uint8Array; project: StudioProject }> {
  validateProject(project);
  await verifyDesignProvenance(project);
  const isDesign = designPagePredicate(project);
  const synthetic = project.pages.flatMap((page, index) => isDesign(page) ? [index] : []);
  const base: StudioProject = structuredClone(project);
  for (const [index, page] of base.pages.entries()) {
    page.objects = [];
    if (synthetic.includes(index)) {
      delete page.sourcePageIndex; delete page.syntheticBackground;
    }
  }
  const bytes = await exportPdf(base);
  const normalized: StudioProject = structuredClone(project);
  normalized.sourcePdf = bytesBase64(bytes);
  normalized.pages.forEach((page, index) => {
    page.sourcePageIndex = index;
  });
  await markSyntheticPages(normalized, synthetic);
  validateProject(normalized);
  return { bytes, project: normalized };
}

/** Native editing keeps existing page order; new pages may only be appended. */
export async function mergeNativeSnapshot(
  project: StudioProject,
  bytes: Uint8Array
): Promise<StudioProject> {
  validateProject(project);
  if (bytes.byteLength > 75 * 1024 * 1024)
    throw new Error(t('Dokument je příliš velký pro projekt.'));
  if (
    !project.sourcePdf ||
    project.pages.some((page, index) => page.sourcePageIndex !== index)
  ) {
    throw new Error(
      t('Před nativní úpravou je nutné připravit společný dokument.')
    );
  }
  const native = await PDFDocument.load(bytes);
  if (native.getPageCount() < project.pages.length) {
    throw new Error(
      t('Nativní dokument má méně stránek. Sloučení by ztratilo objekty návrhu.')
    );
  }
  const merged: StudioProject = structuredClone(project);
  const pages = native.getPages();
  pages.forEach((nativePage, index) => {
    const size = visibleSize(nativePage);
    const existing = merged.pages[index];
    if (existing) {
      if (
        Math.abs(existing.width - size.width) > 0.1 ||
        Math.abs(existing.height - size.height) > 0.1
      ) {
        throw new Error(
          t('Rozměry původní stránky se změnily. Nelze bezpečně zachovat umístění objektů návrhu.')
        );
      }
      existing.width = size.width;
      existing.height = size.height;
      existing.sourcePageIndex = index;
    } else {
      merged.pages.push({
        id: crypto.randomUUID(),
        name: `Stránka ${index + 1}`,
        ...size,
        background: '#ffffff',
        sourcePageIndex: index,
        objects: [],
      });
    }
  });
  merged.sourcePdf = bytesBase64(bytes);
  if (merged.sourcePdf !== project.sourcePdf) for (const page of merged.pages) delete page.syntheticBackground;
  validateProject(merged);
  return merged;
}

