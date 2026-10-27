import { t } from './i18n';
export type FitMode = 'page' | 'width' | 'height';
export type PaperSize = 'a4' | 'letter' | 'custom';

export function pageDimensions(size: PaperSize, landscape: boolean, widthMm: number, heightMm: number) {
  const mmToPt = 72 / 25.4;
  let width = size === 'a4' ? 210 * mmToPt : size === 'letter' ? 612 : widthMm * mmToPt;
  let height = size === 'a4' ? 297 * mmToPt : size === 'letter' ? 792 : heightMm * mmToPt;
  if (![width, height].every(value => Number.isFinite(value) && value >= 25 * mmToPt && value <= 2000 * mmToPt)) {
    throw new Error(t('Rozměry musí být v rozsahu 25 až 2000 mm.'));
  }
  [width, height] = landscape ? [Math.max(width, height), Math.min(width, height)] : [Math.min(width, height), Math.max(width, height)];
  return { width, height };
}

export function fitZoom(mode: FitMode, pageWidth: number, pageHeight: number, availableWidth: number, availableHeight: number) {
  if (![pageWidth, pageHeight, availableWidth, availableHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const width = availableWidth / pageWidth;
  const height = availableHeight / pageHeight;
  return Math.max(0.01, Math.min(6, mode === 'width' ? width : mode === 'height' ? height : Math.min(width, height)));
}
