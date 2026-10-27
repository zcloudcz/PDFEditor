import type { OcrPageResult } from './ocr-service';
export interface OcrReconstructionLine { text: string; x: number; y: number; width: number; height: number; confidence: number; rotation?: number }
export interface OcrReconstructionProposal { revision: number; pages: Array<{pageIndex: number; width: number; height: number; lines: OcrReconstructionLine[]}> }
/** Boxes use displayed page points, top-left origin; confidence is 0..100. */
export function proposeOcrReconstruction(revision: number, pages: readonly OcrPageResult[]): OcrReconstructionProposal {
  if (!Number.isSafeInteger(revision) || revision < 0 || !pages.length || pages.length > 200) throw new Error('invalid-ocr-proposal');
  let count = 0;
  return { revision, pages: pages.map(page => {
    if (!page.toDisplay || !page.width || !page.height) throw new Error('invalid-ocr-proposal');
    const toDisplay = page.toDisplay;
    return { pageIndex: page.pageIndex, width: page.width, height: page.height, lines: page.blocks.lines.map(line => {
      if (++count > 4000) throw new Error('ocr-proposal-limit');
      // A line-level vertical/slanted layout is not represented by its axis-aligned hOCR box.
      // Ask for manual input orientation/deskew rather than positioning text incorrectly.
      if (!Number.isFinite(line.textangle) || Math.abs(line.textangle) > 0.01 || !Number.isFinite(line.baseline.slope) || Math.abs(line.baseline.slope) > 0.03) throw new Error('ocr-line-orientation');
      const box = line.bbox, center = toDisplay((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2), left = toDisplay(box.x0, box.y0), right = toDisplay(box.x1, box.y0), bottom = toDisplay(box.x0, box.y1);
      const width = Math.hypot(right[0] - left[0], right[1] - left[1]), height = Math.hypot(bottom[0] - left[0], bottom[1] - left[1]);
      const corners = [left, right, bottom, toDisplay(box.x1, box.y1)];
      if (![width, height, ...center, ...corners.flat()].every(Number.isFinite) || width <= 0 || height <= 0 || corners.some(([x,y]) => x < -0.01 || y < -0.01 || x > page.width! + 0.01 || y > page.height! + 0.01)) throw new Error('ocr-proposal-outside-page');
      const confidence = line.words.length ? line.words.reduce((lowest, word) => Math.min(lowest, word.confidence), 100) : 0;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error('invalid-ocr-confidence');
      return { text: line.words.map(word => word.text).join(' '), x: center[0] - width / 2, y: center[1] - height / 2, width, height, confidence, rotation: page.rotation ?? 0 };
    }) };
  }) };
}
