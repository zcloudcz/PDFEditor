import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { applyPageAction, exportSelectedPages, parsePageSelection, mergeProjectPdfs, splitProjectPages } from './page-actions';
import JSZip from 'jszip';
import { base64Bytes, bytesBase64 } from './project-io';
import { validateProjectSource } from './document-bridge';
import type { StudioProject } from './types';
import { editNavigation, readNavigation } from '../pdf/navigation';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function fixture(): Promise<StudioProject> {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]); pdf.addPage([500, 600]); pdf.addPage([700, 800]);
  return { version: 1, name: 'Test', sourcePdf: bytesBase64(await pdf.save()), pages: pdf.getPages().map((p, index) => ({
    id: `page-${index}`, name: `Page ${index + 1}`, ...p.getSize(), background: '#ffffff', sourcePageIndex: index,
    objects: [{ id: `object-${index}`, kind: 'rect', name: 'Untouched', x: 20, y: 30, width: 40, height: 60, rotation: 0, opacity: 1, fill: '#ff0000', stroke: 'none', strokeWidth: 0, locked: true }],
  })) };
}

describe('page selection', () => {
  it('accepts ordered one-based ranges', () => expect(parsePageSelection('3, 1-2', 3)).toEqual([2, 0, 1]));
  it.each(['', '0', '4', '3-1', '1,1', '1-3,2', '1.5', '1e2', '1,', '1-999999999'])('rejects invalid or overlapping selection %s', input => {
    expect(() => parsePageSelection(input, 3)).toThrow();
  });
});

describe('shared page operations', () => {
  it.each([-90, 180] as const)('rotates %s degrees without moving unrelated pages', async angle => {
    const project = await fixture();
    const next = await applyPageAction(project, { kind: 'rotate', indices: [0], angle });
    expect(next.pages[1]).toEqual(project.pages[1]);
    expect(next.pages[0].objects[0]).toMatchObject(angle === -90 ? { x: 40, y: 230, rotation: 270 } : { x: 240, y: 310, rotation: 180 });
    await validateProjectSource(next);
  });

  it.each([0, 90, 180, 270])('crops displayed margins consistently at rotation %s and UserUnit 2', async angle => {
    const project = await fixture();
    const pdf = await PDFDocument.load(base64Bytes(project.sourcePdf!));
    pdf.getPage(0).setCropBox(10, 20, 200, 300); pdf.getPage(0).setRotation(degrees(angle));
    pdf.getPage(0).node.set(PDFName.of('UserUnit'), pdf.context.obj(2));
    project.pages[0].width = angle % 180 ? 600 : 400;
    project.pages[0].height = angle % 180 ? 400 : 600;
    project.sourcePdf = bytesBase64(await pdf.save());
    const next = await applyPageAction(project, { kind: 'crop', indices: [0], margins: { top: 20, right: 40, bottom: 60, left: 80 } });
    expect(next.pages[0].width).toBe(project.pages[0].width - 120);
    expect(next.pages[0].height).toBe(project.pages[0].height - 80);
    expect(next.pages[0].objects[0]).toMatchObject({ x: -60, y: 10, locked: true });
    await validateProjectSource(next);
    const out = (await PDFDocument.load(base64Bytes(next.sourcePdf!))).getPage(0).getCropBox();
    const expected = angle === 0 ? { x: 50, y: 50, width: 140, height: 260 } : angle === 90 ? { x: 20, y: 60, width: 160, height: 240 } : angle === 180 ? { x: 30, y: 30, width: 140, height: 260 } : { x: 40, y: 40, width: 160, height: 240 };
    expect(out).toEqual(expected);
  });

  it('crops design-only pages in millimeters and retains editable objects', async () => {
    const project = await fixture(); project.sourcePdf = undefined; project.pages.forEach(page => { page.sourcePageIndex = undefined; });
    const next = await applyPageAction(project, { kind: 'crop', indices: [0], margins: { top: 25.4, right: 0, bottom: 0, left: 25.4 }, unit: 'mm' });
    expect(next.sourcePdf).toBeUndefined();
    expect(next.pages[0]).toMatchObject({ width: 228, height: 328 });
    expect(next.pages[0].objects[0]).toMatchObject({ x: -52, y: -42 });
  });

  it('rejects invalid crop atomically before changing the document', async () => {
    const project = await fixture(), original = structuredClone(project);
    for (const left of [-1, Number.NaN, 300]) {
      await expect(applyPageAction(project, { kind: 'crop', indices: [0], margins: { top: 0, right: 0, bottom: 0, left } })).rejects.toThrow();
    }
    expect(project).toEqual(original);
  });

  it('appends multiple PDFs while retaining original graphic objects and source-less pages', async () => {
    const project = await fixture();
    project.pages[1].sourcePageIndex = undefined;
    const original = structuredClone(project);
    const one = await PDFDocument.create(); one.addPage([123, 456]);
    const two = await PDFDocument.create(); two.addPage([234, 567]);
    const next = await mergeProjectPdfs(project, [await one.save(), await two.save()]);
    expect(next.pages.map(page => page.width)).toEqual([300, 500, 700, 123, 234]);
    expect(next.pages[1].sourcePageIndex).toBeUndefined();
    expect(next.pages[0].objects).toEqual(project.pages[0].objects);
    expect(next.pages.map(page => page.sourcePageIndex)).toEqual([0, undefined, 1, 2, 3]);
    expect(project).toEqual(original); await validateProjectSource(next);
  });

  it('refuses a bad second merge input without changing project', async () => {
    const project = await fixture(), original = structuredClone(project);
    const pdf = await PDFDocument.create(); pdf.addPage();
    await expect(mergeProjectPdfs(project, [await pdf.save(), new Uint8Array([1, 2, 3])])).rejects.toThrow();
    expect(project).toEqual(original);
  });

  it('merges same-name forms independently while retaining graphic and page identities', async () => {
    const project = await fixture();
    const source = await PDFDocument.load(base64Bytes(project.sourcePdf!));
    source.getForm().createCheckBox('same').addToPage(source.getPage(0), { x: 100, y: 100, width: 20, height: 20 });
    project.sourcePdf = bytesBase64(await source.save());
    const input = await PDFDocument.create(), page = input.addPage([300, 400]);
    const other = input.getForm().createCheckBox('same'); other.addToPage(page, { x: 100, y: 100, width: 20, height: 20 }); other.check();
    const before = structuredClone(project), next = await mergeProjectPdfs(project, [await input.save()]);
    expect(next.pages.slice(0, 3)).toEqual(project.pages);
    expect(project).toEqual(before);
    const form = (await PDFDocument.load(base64Bytes(next.sourcePdf!))).getForm();
    expect(form.getFields().map(field => field.getName())).toEqual(['document_1.same', 'document_2.same']);
    expect(form.getCheckBox('document_1.same').isChecked()).toBe(false);
    expect(form.getCheckBox('document_2.same').isChecked()).toBe(true);
  });

  it('exports split pages in a single ZIP and leaves the source unchanged', async () => {
    const project = await fixture(), original = structuredClone(project);
    const zip = await JSZip.loadAsync(await splitProjectPages(project, [2, 0]));
    expect(Object.keys(zip.files)).toEqual(['page-003.pdf', 'page-001.pdf']);
    const file = zip.file('page-003.pdf');
    if (!file) throw new Error('Missing split output');
    const pdf = await PDFDocument.load(await file.async('uint8array'));
    expect(pdf.getPageCount()).toBe(1); expect(pdf.getPage(0).getWidth()).toBe(700);
    expect(project).toEqual(original);
  });
  it('keeps native text and visible mixed geometry in PDF.js split output while retaining editable graphics in the project', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]).drawText('Native one');
    const rotated = source.addPage([500, 600]); rotated.setCropBox(20, 30, 300, 400); rotated.setRotation(degrees(90)); rotated.drawText('Native two', { x: 50, y: 100 });
    const project = await fixture(); project.sourcePdf = bytesBase64(await source.save());
    project.pages = project.pages.slice(0, 2);
    project.pages[1].width = 400; project.pages[1].height = 300;
    const before = structuredClone(project);
    const archive = await JSZip.loadAsync(await splitProjectPages(project, [1, 0]));
    for (const [name, width, height, text] of [['page-002.pdf', 400, 300, 'Native two'], ['page-001.pdf', 300, 400, 'Native one']] as const) {
      const entry = archive.file(name); if (!entry) throw new Error('Missing split page');
      const pdf = await getDocument({ data: await entry.async('uint8array'), useSystemFonts: false }).promise;
      try {
        expect(pdf.numPages).toBe(1);
        const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1 });
        expect([viewport.width, viewport.height]).toEqual([width, height]);
        expect((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')).toContain(text);
      } finally { await pdf.destroy(); }
    }
    expect(project).toEqual(before);
    expect(project.pages[1].objects[0].id).toBe('object-1');
  });
  it('duplicates with fresh identities and leaves original immutable', async () => {
    const project = await fixture(), original = structuredClone(project);
    const next = await applyPageAction(project, { kind: 'duplicate', indices: [1] });
    expect(project).toEqual(original);
    expect(next.pages.map(p => p.width)).toEqual([300, 500, 500, 700]);
    expect(next.pages[1].id).not.toBe(next.pages[2].id);
    expect(next.pages[1].objects[0].id).not.toBe(next.pages[2].objects[0].id);
    expect(next.pages[2].objects[0].locked).toBe(true);
    await validateProjectSource(next);
  });
  it('removes selected pages and remaps source indices', async () => {
    const next = await applyPageAction(await fixture(), { kind: 'delete', indices: [1] });
    expect(next.pages.map(p => p.id)).toEqual(['page-0', 'page-2']);
    expect(next.pages.map(p => p.sourcePageIndex)).toEqual([0, 1]);
    expect((await PDFDocument.load(base64Bytes(next.sourcePdf!))).getPageCount()).toBe(2);
  });
  it('reverses selected positions without changing other pages', async () => {
    const next = await applyPageAction(await fixture(), { kind: 'reverse', indices: [2, 0] });
    expect(next.pages.map(p => p.id)).toEqual(['page-2', 'page-1', 'page-0']);
    await validateProjectSource(next);
  });
  it('moves selected pages together one position while preserving their IDs, objects and PDF references', async () => {
    const project = await fixture(), before = structuredClone(project);
    const down = await applyPageAction(project, { kind: 'move', indices: [0, 1], direction: 'down' });
    expect(down.pages.map(page => page.id)).toEqual(['page-2', 'page-0', 'page-1']);
    expect(down.pages.map(page => page.objects[0].id)).toEqual(['object-2', 'object-0', 'object-1']);
    const back = await applyPageAction(down, { kind: 'move', indices: [1, 2], direction: 'up' });
    expect(back.pages).toEqual(project.pages);
    expect((await PDFDocument.load(base64Bytes(down.sourcePdf!))).getPages().map(page => page.getWidth())).toEqual([700, 300, 500]);
    expect(project).toEqual(before);
  });
  it('remaps a bookmark through structural edits while keeping stable page and graphic IDs', async () => {
    const project = await fixture();
    project.sourcePdf = bytesBase64(await editNavigation(base64Bytes(project.sourcePdf!), { kind: 'add-bookmark', title: 'Second', pageIndex: 1 }));
    const before = structuredClone(project);
    const reversed = await applyPageAction(project, { kind: 'reverse', indices: [0, 1] });
    expect(reversed.pages.map(page => page.id)).toEqual(['page-1', 'page-0', 'page-2']);
    expect(reversed.pages[0].objects[0].id).toBe('object-1');
    expect((await readNavigation(base64Bytes(reversed.sourcePdf!))).bookmarks[0].destination?.pageIndex).toBe(0);
    const duplicated = await applyPageAction(reversed, { kind: 'duplicate', indices: [0] });
    expect(duplicated.pages[1].id).not.toBe(duplicated.pages[0].id);
    expect(duplicated.pages[1].objects[0].id).not.toBe(duplicated.pages[0].objects[0].id);
    expect((await readNavigation(base64Bytes(duplicated.sourcePdf!))).bookmarks[0].destination?.pageIndex).toBe(0);
    expect(project).toEqual(before);
  });
  it('extracts bookmarked pages with a graphic overlay without changing the live project', async () => {
    const project = await fixture();
    project.sourcePdf = bytesBase64(await editNavigation(base64Bytes(project.sourcePdf!), { kind: 'add-bookmark', title: 'Third', pageIndex: 2 }));
    const before = structuredClone(project);
    const output = await exportSelectedPages(project, [2, 0]);
    const pdf = await getDocument({ data: output.slice(), useSystemFonts: false }).promise;
    try {
      expect(pdf.numPages).toBe(2);
      expect((await pdf.getPage(1)).getViewport({ scale: 1 }).width).toBe(700);
      const outline = await pdf.getOutline();
      expect(outline?.[0].title).toBe('Third');
      const saved = await readNavigation(output);
      expect(saved.bookmarks[0].destination?.pageIndex).toBe(0);
    } finally { await pdf.destroy(); }
    expect(project).toEqual(before);
    expect(project.pages[2].objects[0].id).toBe('object-2');
  });
  it('rotates base and graphic centers together, including locked objects', async () => {
    const original = await fixture();
    let next = await applyPageAction(original, { kind: 'rotate', indices: [0] });
    expect(next.pages[0]).toMatchObject({ width: 400, height: 300 });
    expect(next.pages[0].objects[0]).toMatchObject({ x: 320, y: 10, rotation: 90, width: 40, height: 60, locked: true });
    expect(next.pages[1]).toEqual(original.pages[1]);
    for (let n = 0; n < 3; n++) next = await applyPageAction(next, { kind: 'rotate', indices: [0] });
    expect(next.pages).toEqual(original.pages);
  });
  it('rotates cropped, already rotated PDF dimensions consistently', async () => {
    const project = await fixture();
    const pdf = await PDFDocument.load(base64Bytes(project.sourcePdf!));
    pdf.getPage(0).setCropBox(10, 20, 100, 200); pdf.getPage(0).setRotation(degrees(90));
    project.sourcePdf = bytesBase64(await pdf.save()); project.pages[0].width = 200; project.pages[0].height = 100;
    const next = await applyPageAction(project, { kind: 'rotate', indices: [0] });
    expect(next.pages[0]).toMatchObject({ width: 100, height: 200 });
    await validateProjectSource(next);
  });
  it('exports custom order without replacing the project', async () => {
    const project = await fixture(), original = structuredClone(project);
    const output = await PDFDocument.load(await exportSelectedPages(project, [2, 0]));
    expect(output.getPages().map(p => p.getWidth())).toEqual([700, 300]);
    expect(project).toEqual(original);
  });
  it('keeps graphics-only pages graphics-only when rotated', async () => {
    const project = await fixture();
    project.sourcePdf = undefined;
    project.pages.forEach(page => { page.sourcePageIndex = undefined; });
    const next = await applyPageAction(project, { kind: 'rotate', indices: [0] });
    expect(next.sourcePdf).toBeUndefined();
    expect(next.pages.every(page => page.sourcePageIndex === undefined)).toBe(true);
    expect(next.pages[0].width).toBe(400);
  });
  it('retains metadata through structural changes and extraction', async () => {
    const project = await fixture();
    const pdf = await PDFDocument.load(base64Bytes(project.sourcePdf!));
    pdf.setTitle('Original title'); pdf.setAuthor('Original author');
    pdf.catalog.set(PDFName.of('Lang'), PDFString.of('cs-CZ'));
    project.sourcePdf = bytesBase64(await pdf.save());
    const next = await applyPageAction(project, { kind: 'delete', indices: [1] });
    for (const bytes of [base64Bytes(next.sourcePdf!), await exportSelectedPages(project, [2, 0])]) {
      const saved = await PDFDocument.load(bytes);
      expect(saved.getTitle()).toBe('Original title');
      expect(saved.getAuthor()).toBe('Original author');
      expect(saved.catalog.get(PDFName.of('Lang'))?.toString()).toBe('(cs-CZ)');
    }
  });
  it('preflights structural normalization before rotating an already reordered tagged PDF', async () => {
    const project = await fixture();
    const pdf = await PDFDocument.load(base64Bytes(project.sourcePdf!));
    pdf.catalog.set(PDFName.of('StructTreeRoot'), pdf.context.obj({ Type: 'StructTreeRoot' }));
    project.sourcePdf = bytesBase64(await pdf.save());
    project.pages.reverse();
    await expect(applyPageAction(project, { kind: 'rotate', indices: [0] })).rejects.toThrow();
  });
  it('refuses the last page deletion and structured PDF copying atomically', async () => {
    const project = await fixture();
    await expect(applyPageAction(project, { kind: 'delete', indices: [0, 1, 2] })).rejects.toThrow();
    const pdf = await PDFDocument.load(base64Bytes(project.sourcePdf!));
    pdf.catalog.set(PDFName.of('StructTreeRoot'), pdf.context.obj({ Type: 'StructTreeRoot' }));
    project.sourcePdf = bytesBase64(await pdf.save());
    const original = structuredClone(project);
    await expect(applyPageAction(project, { kind: 'reverse', indices: [0, 2] })).rejects.toThrow();
    expect(project).toEqual(original);
  });
});
