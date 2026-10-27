import type { OcrReconstructionProposal } from '../pdf/ocr-reconstruction';
import type { StudioObject, StudioProject } from './types';
import { validateProject } from './project-validation';
import { assertTextGlyphs, layoutText, prepareTextFonts } from './text-layout';

/** Explicit visual reconstruction only: the original scan remains in sourcePdf. */
export async function prepareOcrReconstruction(project: StudioProject, proposal: OcrReconstructionProposal, signal?: AbortSignal): Promise<StudioProject> {
  signal?.throwIfAborted();
  validateProject(project);
  if (!proposal || !Number.isSafeInteger(proposal.revision) || proposal.revision < 0 || !Array.isArray(proposal.pages) || !proposal.pages.length || proposal.pages.length > 200) throw new Error('invalid-ocr-proposal');
  const next = structuredClone(project), seen = new Set<number>(), additions: Array<{ pageIndex: number; cover: StudioObject; text: StudioObject }> = [];
  let characters = 0;
  for (const page of proposal.pages) {
    if (!page || !Number.isInteger(page.pageIndex) || seen.has(page.pageIndex)) throw new Error('invalid-ocr-proposal');
    seen.add(page.pageIndex);
    const target = next.pages[page.pageIndex];
    if (!target || target.sourcePageIndex === undefined || !Array.isArray(page.lines) || !Number.isFinite(page.width) || !Number.isFinite(page.height) || Math.abs(target.width - page.width) > 0.1 || Math.abs(target.height - page.height) > 0.1) throw new Error('invalid-ocr-page');
    for (const line of page.lines) {
      if (!line || typeof line.text !== 'string' || line.text.length > 10000 || /[\r\n]/.test(line.text) || (characters += line.text.length) > 1000000 || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 100) throw new Error('invalid-ocr-line');
      if (!line.text.trim()) continue;
      const rotation = line.rotation ?? 0;
      if (![line.x, line.y, line.width, line.height, rotation].every(Number.isFinite) || line.width <= 0 || line.height <= 0 || line.width > 14400 || line.height > 14400 || Math.abs(rotation) > 360) throw new Error('invalid-ocr-geometry');
      const angle = rotation * Math.PI / 180, cx = line.x + line.width / 2, cy = line.y + line.height / 2;
      for (const dx of [-line.width / 2, line.width / 2]) for (const dy of [-line.height / 2, line.height / 2]) {
        const x = cx + dx * Math.cos(angle) - dy * Math.sin(angle), y = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
        if (x < -0.01 || y < -0.01 || x > target.width + 0.01 || y > target.height + 0.01) throw new Error('invalid-ocr-geometry');
      }
      if (additions.length >= 4000) throw new Error('ocr-proposal-limit');
      const common = { x: line.x, y: line.y, width: line.width, height: line.height, rotation, opacity: 1, stroke: 'none', strokeWidth: 0 };
      const cover: StudioObject = { ...common, id: crypto.randomUUID(), kind: 'rect', name: 'OCR', fill: '#ffffff', locked: true };
      const text: StudioObject = { ...common, id: crypto.randomUUID(), kind: 'text', name: line.text.slice(0, 50), text: line.text, fill: '#000000', locked: false, fontFamily: 'Liberation Sans', fontSize: Math.min(1000, line.height / 1.2), lineHeight: 1.2, wrapText: false, verticalAlign: 'middle', textDirection: 'auto' };
      additions.push({ pageIndex: page.pageIndex, cover, text });
    }
  }
  const count = project.pages.reduce((total, page) => total + page.objects.length, 0);
  if (!additions.length || count + additions.length * 2 > 10000) throw new Error('ocr-proposal-limit');
  await prepareTextFonts(additions.map(item => item.text));
  signal?.throwIfAborted();
  for (const { pageIndex, cover, text } of additions) {
    assertTextGlyphs(text);
    const layout = layoutText(text), width = Math.max(...layout.lines.map(line => line.width), 0);
    const factor = Math.min(1, text.width / Math.max(width, 0.0001), text.height / Math.max(layout.height, 0.0001));
    text.fontSize = Math.min(1000, (text.fontSize ?? 1) * factor);
    if (text.fontSize < 1 || layoutText(text).overflow) throw new Error('ocr-text-does-not-fit');
    next.pages[pageIndex].objects.push(cover, text);
  }
  signal?.throwIfAborted();
  validateProject(next);
  return next;
}
