// @vitest-environment node
import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from './exports';
import { bytesBase64 } from './project-io';
import { editNavigation, readNavigation } from '../pdf/navigation';
import type { StudioProject } from './types';

async function fixture(): Promise<StudioProject> {
  const doc = await PDFDocument.create();
  const first = doc.addPage([300, 400]), second = doc.addPage([500, 600]);
  first.drawText('First native page', { x: 20, y: 350 });
  second.drawText('Second native page', { x: 20, y: 550 });
  doc.setTitle('Preserved title');
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: { Names: [PDFString.of('second'), [second.ref, 'Fit']] } }));
  first.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 30, 30], Dest: PDFString.of('second') }))]));
  const bytes = await editNavigation(await doc.save(), { kind: 'add-bookmark', title: 'Second', pageIndex: 1 });
  return { version: 1, name: 'Navigation', sourcePdf: bytesBase64(bytes), pages: [
    { id: 'second', name: 'Second', width: 500, height: 600, background: '#ffffff', sourcePageIndex: 1, objects: [] },
    { id: 'design', name: 'Design', width: 200, height: 250, background: '#ffffff', objects: [] },
    { id: 'first', name: 'First', width: 300, height: 400, background: '#ffffff', sourcePageIndex: 0, objects: [
      { id: 'rect', name: 'Graphic', kind: 'rect', x: 80, y: 80, width: 30, height: 40, rotation: 0, opacity: 1, fill: '#ff0000', stroke: 'none', strokeWidth: 0, locked: false },
    ] },
  ] };
}

it('exports reordered PDF pages and an interleaved design page without losing navigation or editable project objects', async () => {
  const project = await fixture(), original = structuredClone(project);
  const bytes = await exportPdf(project);
  expect(project).toEqual(original);
  const nav = await readNavigation(bytes);
  expect(nav.bookmarks[0].destination?.pageIndex).toBe(0);
  expect(nav.destinations[0].destination.pageIndex).toBe(0);
  expect(nav.links[0]).toMatchObject({ pageIndex: 2, destination: { pageIndex: 0 } });
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    expect(doc.numPages).toBe(3);
    expect((await doc.getMetadata()).info).toMatchObject({ Title: 'Preserved title' });
    const second = await doc.getPage(1), first = await doc.getPage(3);
    expect((await second.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')).toContain('Second native page');
    expect((await first.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')).toContain('First native page');
    expect((await doc.getPage(2)).getViewport({ scale: 1 }).width).toBe(200);
  } finally { await doc.destroy(); }
});

it('removes links to deleted targets while preserving unrelated native text and metadata', async () => {
  const project = await fixture(); project.pages = [project.pages[2]];
  const bytes = await exportPdf(project);
  const nav = await readNavigation(bytes);
  expect(nav.bookmarks[0].destination).toBeNull();
  expect(nav.links).toEqual([]);
  expect(nav.destinations).toEqual([]);
  expect((await PDFDocument.load(bytes)).getTitle()).toBe('Preserved title');
});
