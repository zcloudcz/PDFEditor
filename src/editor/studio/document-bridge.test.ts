import { describe, expect, it } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFArray,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';
import { prepareNativeDocument, mergeNativeSnapshot, validateProjectSource } from './document-bridge';
import type { StudioProject } from './types';
const project = (): StudioProject => ({
  version: 1,
  name: 'Shared document',
  pages: [
    {
      id: 'one',
      name: 'Design',
      width: 300,
      height: 200,
      background: '#00ff00',
      objects: [
        {
          id: 'text',
          kind: 'text',
          name: 'Editable',
          text: 'Overlay remains editable',
          fontSize: 24,
          fontFamily: 'Liberation Sans',
          x: 20,
          y: 30,
          width: 100,
          height: 40,
          rotation: 0,
          opacity: 1,
          fill: '#ff0000',
          stroke: 'none',
          strokeWidth: 0,
          locked: false,
        },
      ],
    },
  ],
});
const content = (doc: PDFDocument, index: number) => {
  const contents = doc.getPage(index).node.Contents();
  const streams =
    contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((ref) => {
      const stream = doc.context.lookup(ref);
      return stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : '';
    })
    .join('\n');
};
describe('shared native document bridge', () => {
  it('validates source page references and dimensions before replacing a project', async () => {
    const prepared = await prepareNativeDocument(project());
    await expect(validateProjectSource(prepared.project)).resolves.toBeUndefined();
    const badIndex = structuredClone(prepared.project);
    badIndex.pages[0].sourcePageIndex = 3;
    await expect(validateProjectSource(badIndex)).rejects.toThrow('neexistující');
    const badSize = structuredClone(prepared.project);
    badSize.pages[0].width += 10;
    await expect(validateProjectSource(badSize)).rejects.toThrow('Rozměry');
    const broken = structuredClone(prepared.project);
    broken.sourcePdf = btoa('%PDF-1.7 broken');
    await expect(validateProjectSource(broken)).rejects.toThrow();
  });
  it('retains editable overlays without baking them into native base', async () => {
    const original = project();
    const prepared = await prepareNativeDocument(original);
    expect(prepared.project.pages[0].objects).toEqual(
      original.pages[0].objects
    );
    expect(prepared.project.pages[0].sourcePageIndex).toBe(0);
    expect(original.sourcePdf).toBeUndefined();
    const doc = await PDFDocument.load(prepared.bytes);
    expect(content(doc, 0)).toContain('0 1 0 rg');
    expect(content(doc, 0)).not.toContain('Tj');
    expect(content(doc, 0)).not.toContain('1 0 0 rg');
  });
  it('normalizes reorder, duplicate, and blank page references', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    source.addPage([500, 400]);
    const p = project();
    p.sourcePdf = await source.saveAsBase64();
    p.pages = [
      {
        ...p.pages[0],
        id: 'second',
        width: 500,
        height: 400,
        sourcePageIndex: 1,
      },
      {
        ...p.pages[0],
        id: 'copy',
        width: 500,
        height: 400,
        sourcePageIndex: 1,
        objects: [],
      },
      { ...p.pages[0], id: 'blank', objects: [] },
    ];
    const prepared = await prepareNativeDocument(p);
    expect(prepared.project.pages.map((x) => x.sourcePageIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(prepared.project.pages.map((x) => x.id)).toEqual([
      'second',
      'copy',
      'blank',
    ]);
    expect(
      (await PDFDocument.load(prepared.bytes))
        .getPages()
        .map((x) => x.getSize())
    ).toEqual([
      { width: 500, height: 400 },
      { width: 500, height: 400 },
      { width: 300, height: 200 },
    ]);
  });
  it('merges native changes and appended pages while preserving existing objects', async () => {
    const prepared = await prepareNativeDocument(project());
    const native = await PDFDocument.load(prepared.bytes);
    native.getPage(0).drawText('Native change');
    native.addPage([700, 500]);
    const bytes = await native.save();
    const merged = await mergeNativeSnapshot(prepared.project, bytes);
    expect(merged.pages[0].objects).toEqual(prepared.project.pages[0].objects);
    expect(merged.pages[0].id).toBe('one');
    expect(merged.pages[1].objects).toEqual([]);
    expect(merged.pages[1].sourcePageIndex).toBe(1);
    expect(merged.pages[1].width).toBe(700);
    expect(merged.sourcePdf).not.toBe(prepared.project.sourcePdf);
  });
  it('rejects fewer pages and incompatible visible dimensions', async () => {
    const prepared = await prepareNativeDocument(project());
    const native = await PDFDocument.load(prepared.bytes);
    native.getPage(0).setSize(400, 200);
    await expect(
      mergeNativeSnapshot(prepared.project, await native.save())
    ).rejects.toThrow();
    native.removePage(0);
    await expect(
      mergeNativeSnapshot(
        prepared.project,
        await native.save({ addDefaultPage: false })
      )
    ).rejects.toThrow();
  });
  it('honors visible rotated CropBox and UserUnit on appended pages', async () => {
    const prepared = await prepareNativeDocument(project());
    const native = await PDFDocument.load(prepared.bytes);
    const page = native.addPage([400, 600]);
    page.setCropBox(20, 30, 300, 500);
    page.setRotation(degrees(90));
    page.node.set(PDFName.of('UserUnit'), native.context.obj(2));
    const merged = await mergeNativeSnapshot(
      prepared.project,
      await native.save()
    );
    expect(merged.pages[1].width).toBe(1000);
    expect(merged.pages[1].height).toBe(600);
  });
  it('refuses restructuring structured source PDFs', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    source.getForm().createTextField('field').setText('keep');
    const p = project();
    p.sourcePdf = await source.saveAsBase64();
    p.pages[0].sourcePageIndex = 0;
    p.pages.push({ ...p.pages[0], id: 'duplicate', objects: [] });
    await expect(prepareNativeDocument(p)).rejects.toThrow();
  });
});
