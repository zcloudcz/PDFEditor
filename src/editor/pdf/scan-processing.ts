/** Local OCR-input preparation only. Never replaces a PDF page or its source image. */
export interface ScanPreparation { orientation: 0 | 90 | 180 | 270; deskew: number; contrast: number; denoise: boolean }
export const DEFAULT_SCAN_PREPARATION: Readonly<ScanPreparation> = { orientation: 0, deskew: 0, contrast: 1, denoise: false };
export const SCAN_MAX_PIXELS = 12_000_000;
export function validateScanPreparation(options: ScanPreparation): void {
  if (![0, 90, 180, 270].includes(options.orientation) || !Number.isFinite(options.deskew) || Math.abs(options.deskew) > 5 || !Number.isFinite(options.contrast) || options.contrast < 0.5 || options.contrast > 3 || typeof options.denoise !== 'boolean') throw new Error('invalid-scan-preparation');
}
export function scanGeometry(width: number, height: number, options: ScanPreparation) {
  validateScanPreparation(options);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > SCAN_MAX_PIXELS) throw new Error('scan-limit');
  const angle = (options.orientation + options.deskew) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const outputWidth = Math.ceil(Math.abs(width * c) + Math.abs(height * s) - 1e-8), outputHeight = Math.ceil(Math.abs(width * s) + Math.abs(height * c) - 1e-8);
  if (outputWidth * outputHeight > SCAN_MAX_PIXELS) throw new Error('scan-limit');
  return { width: outputWidth, height: outputHeight, angle,
    toOriginal(x: number, y: number): [number, number] { const dx = x - outputWidth / 2, dy = y - outputHeight / 2; return [c * dx + s * dy + width / 2, -s * dx + c * dy + height / 2]; } };
}
/** Isolated dark-pixel removal, not aggressive blur: preserve connected strokes/diacritics. */
export async function filterScanPixels(data: Uint8ClampedArray, width: number, height: number, options: ScanPreparation, signal: AbortSignal): Promise<Uint8ClampedArray> {
  scanGeometry(width, height, { ...options, orientation: 0, deskew: 0 });
  if (data.length !== width * height * 4) throw new Error('invalid-scan-pixels');
  signal.throwIfAborted();
  const output = new Uint8ClampedArray(data.length);
  const gray = (offset: number) => (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) * data[offset + 3] / 255 + 255 - data[offset + 3];
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4; let value = gray(offset);
      if (options.denoise && value < 160 && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        let isolated = true;
        for (let dy = -1; dy <= 1 && isolated; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && gray(offset + (dy * width + dx) * 4) < 200) { isolated = false; break; }
        if (isolated) value = 255;
      }
      value = Math.max(0, Math.min(255, (value - 128) * options.contrast + 128));
      output[offset] = output[offset + 1] = output[offset + 2] = value; output[offset + 3] = 255;
    }
  }
  return output;
}
export async function prepareScanCanvas(source: HTMLCanvasElement, options: ScanPreparation, signal: AbortSignal) {
  const geometry = scanGeometry(source.width, source.height, options); signal.throwIfAborted();
  const canvas = document.createElement('canvas'); canvas.width = geometry.width; canvas.height = geometry.height;
  try {
    const context = canvas.getContext('2d'); if (!context) throw new Error('scan-canvas');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(geometry.angle); context.drawImage(source, -source.width / 2, -source.height / 2); context.resetTransform();
    if (options.contrast !== 1 || options.denoise) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      image.data.set(await filterScanPixels(image.data, canvas.width, canvas.height, { ...options, orientation: 0, deskew: 0 }, signal)); context.putImageData(image, 0, 0);
    }
    signal.throwIfAborted(); return { canvas, geometry };
  } catch (error) { canvas.width = canvas.height = 0; throw error; }
}
