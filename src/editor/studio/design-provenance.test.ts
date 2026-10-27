// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { prepareNativeDocument, mergeNativeSnapshot } from './document-bridge';
import { exportSvg, exportPdf } from './exports';
import { capturePersonalTemplate } from './personal-templates';
import { resizeDesign } from './layout-rules';
import { parsePortableProject, serializePortableProject } from './project-io';
import { nativeRedactCopy } from '../pdf/native-redaction';
import { clearDesignProvenance, designSourceHash, markSyntheticPages, verifyDesignProvenance } from './design-provenance';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { bytesBase64 } from './project-io';
import type { StudioProject } from './types';
import { pageDimensions } from '../page-settings';
const design = (): StudioProject => ({ version: 1, name: 'Design', pages: [{ id: 'design', name: 'Design', width: 300, height: 200, background: '#abcdef', objects: [] }] });
const details = { name: 'Reusable', tags: [] as string[], license: 'Own', source: 'Own' };

it.each([pageDimensions('a4', false, 210, 297), pageDimensions('custom', true, 131.7, 237.4)])('verifies fractional dimensions %j after the actual bundled PDFium save', async dimensions => {
  const initial = design(); Object.assign(initial.pages[0], dimensions);
  const prepared = await prepareNativeDocument(initial);
  const canonical = await nativeRedactCopy(prepared.bytes, [], new AbortController().signal);
  const project = { ...prepared.project, sourcePdf: bytesBase64(canonical), pages: structuredClone(prepared.project.pages) };
  clearDesignProvenance();
  await markSyntheticPages(project, [0]);
  const canonicalSize = (await PDFDocument.load(canonical)).getPage(0).getSize();
  expect({ width: project.pages[0].width, height: project.pages[0].height }).toEqual(canonicalSize);
  expect(await exportSvg(project, 'design')).toContain('#abcdef');
  expect(capturePersonalTemplate(project, ['design'], details).pages[0].sourcePageIndex).toBeUndefined();
  expect(resizeDesign(project, 'design', { width: 400, height: 500 }, []).pages[0].width).toBe(400);
  clearDesignProvenance();
  await verifyDesignProvenance(project);
  expect(await exportSvg(project, 'design')).toContain('#abcdef');
});

it.each(['rotation', 'crop', 'size', 'text', 'image', 'widget'] as const)('refuses forged fractional design provenance containing %s', async change => {
  const initial = design(); Object.assign(initial.pages[0], pageDimensions('a4', false, 210, 297));
  const prepared = await prepareNativeDocument(initial);
  const canonical = await nativeRedactCopy(prepared.bytes, [], new AbortController().signal);
  const pdf = await PDFDocument.load(canonical), page = pdf.getPage(0);
  if (change === 'rotation') page.setRotation(degrees(90));
  if (change === 'crop') page.setCropBox(1, 1, page.getWidth() - 2, page.getHeight() - 2);
  if (change === 'size') page.setSize(page.getWidth() + .01, page.getHeight());
  if (change === 'text') page.drawText('Native text');
  if (change === 'image') page.drawImage(await pdf.embedPng(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3u8AAAAASUVORK5CYII=', 'base64'))), { x: 1, y: 1, width: 10, height: 10 });
  if (change === 'widget') pdf.getForm().createTextField('field').addToPage(page, { x: 10, y: 10, width: 30, height: 20 });
  const project = { ...prepared.project, sourcePdf: await pdf.saveAsBase64(), pages: structuredClone(prepared.project.pages) };
  project.pages[0].syntheticBackground = designSourceHash(project.sourcePdf);
  clearDesignProvenance();
  await expect(verifyDesignProvenance(project)).rejects.toThrow();
});
describe('design provenance through the shared native surface', () => {
  it('retains SVG, personal templates and resize after native canonical preparation and v2 roundtrip', async () => {
    const prepared = await prepareNativeDocument(design());
    const linked = await mergeNativeSnapshot(prepared.project, prepared.bytes);
    const restored = await parsePortableProject(await serializePortableProject(linked));
    expect(await exportSvg(restored, 'design')).toContain('#abcdef');
    expect(capturePersonalTemplate(restored, ['design'], details).pages[0].sourcePageIndex).toBeUndefined();
    const resized = resizeDesign(restored, 'design', { width: 400, height: 250 }, []);
    const rebased = await prepareNativeDocument(resized);
    expect((await PDFDocument.load(rebased.bytes)).getPage(0).getSize()).toEqual({ width: 400, height: 250 });
    expect(rebased.project.pages[0].id).toBe('design');
    expect(await exportSvg(rebased.project, 'design')).toContain('#abcdef');
  });
  it('refuses native text after either a merge or direct source replacement', async () => {
    const prepared = await prepareNativeDocument(design());
    const native = await PDFDocument.load(prepared.bytes); native.getPage(0).drawText('KEEP native text');
    const bytes = await native.save();
    const merged = await mergeNativeSnapshot(prepared.project, bytes);
    for (const project of [merged, { ...prepared.project, sourcePdf: await native.saveAsBase64() }]) {
      await expect(exportSvg(project, 'design')).rejects.toThrow();
      expect(() => capturePersonalTemplate(project, ['design'], details)).toThrow();
      expect(() => resizeDesign(project, 'design', { width: 400, height: 250 }, [])).toThrow();
    }
  });
});


it('verifies actual PDFium canonical saves without trusting serialized provenance', async () => {
  const prepared = await prepareNativeDocument(design());
  const canonical = await nativeRedactCopy(prepared.bytes, [], new AbortController().signal);
  const project = { ...prepared.project, sourcePdf: bytesBase64(canonical) };
  clearDesignProvenance();
  await markSyntheticPages(project, [0]);
  expect(await exportSvg(project, 'design')).toContain('#abcdef');
  const changed = await PDFDocument.load(canonical);
  changed.getPage(0).drawEllipse({ x: 100, y: 80, xScale: 20, yScale: 10, color: rgb(1,0,0) });
  const forged = { ...project, sourcePdf: await changed.saveAsBase64(), pages: structuredClone(project.pages) };
  forged.pages[0].syntheticBackground = designSourceHash(forged.sourcePdf);
  await expect(exportSvg(forged, 'design')).rejects.toThrow(/native content/);
  expect(() => capturePersonalTemplate(forged, ['design'], details)).toThrow();
  expect(() => resizeDesign(forged, 'design', { width: 400, height: 250 }, [])).toThrow();
  const original: StudioProject = { ...project, pages: project.pages.map(page => ({ ...page, syntheticBackground: undefined as string | undefined })) };
  await expect(exportSvg(original, 'design')).rejects.toThrow();
});


it('keeps the colored native background with edited native text and rejects pending proofs after purge', async () => {
  const prepared = await prepareNativeDocument(design());
  clearDesignProvenance();
  const verifying = verifyDesignProvenance(prepared.project);
  clearDesignProvenance();
  await expect(verifying).rejects.toThrow(/changed/);
  await verifyDesignProvenance(prepared.project);
  const native = await PDFDocument.load(prepared.bytes);
  native.getPage(0).drawText('Native content', { x: 10, y: 50 });
  const changed = await mergeNativeSnapshot(prepared.project, await native.save());
  const task = getDocument({ data: await exportPdf(changed), isEvalSupported: false });
  try {
    const page = await (await task.promise).getPage(1);
    const operators = await page.getOperatorList();
    const colors = operators.fnArray.flatMap((op, index) => op === OPS.setFillRGBColor ? [Array.from(operators.argsArray[index])] : []);
    expect(colors).toContainEqual(['#abcdef']);
    expect((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')).toContain('Native content');
  } finally { await task.destroy(); }
});
