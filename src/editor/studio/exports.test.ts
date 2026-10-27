import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from './project-io';
import { exportPdf, exportSvg } from './exports';
import { PDFDocument, PDFName, PDFString, PDFDict, degrees } from 'pdf-lib';
import type { StudioProject } from './types';
const project = (): StudioProject => ({
  version: 1,
  name: 'Český návrh',
  pages: [
    {
      id: 'p1',
      name: 'Page',
      width: 300,
      height: 200,
      background: '#ffffff',
      objects: [],
    },
  ],
});
describe('portable studio exports', () => {
  it('roundtrips Czech project data', () =>
    expect(parseProject(serializeProject(project()))).toEqual(project()));
  it('rejects nonfinite geometry and remote images', () => {
    const p = project();
    p.pages[0].width = Infinity;
    expect(() => serializeProject(p)).toThrow();
    expect(() =>
      parseProject(
        JSON.stringify({ ...project(), sourcePdf: 'https://evil.test' })
      )
    ).toThrow();
  });
  it('rejects source PDF SVG rather than silently rasterizing', async () => {
    const p = project();
    p.sourcePdf = 'JVBERi0=';
    p.pages[0].sourcePageIndex = 0;
    await expect(exportSvg(p, 'p1')).rejects.toThrow();
  });
  it('exports blank vectors at page size', async () => {
    const doc = await PDFDocument.load(await exportPdf(project()));
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 200 });
  });
  it('retains native crop and rotation when copying', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    page.setCropBox(20, 30, 300, 500);
    page.setRotation(degrees(90));
    const p = project();
    p.sourcePdf = await doc.saveAsBase64();
    p.pages[0].sourcePageIndex = 0;
    p.pages[0].width = 500;
    p.pages[0].height = 300;
    const out = await PDFDocument.load(await exportPdf(p));
    expect(out.getPage(0).getRotation().angle).toBe(90);
    expect(out.getPage(0).getCropBox()).toEqual(page.getCropBox());
  });
  it('preserves document information and catalog metadata when rebuilding structural page copies', async () => {
    const source = await PDFDocument.create(); source.addPage([300, 200]);
    source.setTitle('Original title'); source.setAuthor('Original author');
    source.setSubject('Original subject'); source.setKeywords(['source', 'metadata']);
    source.setCreationDate(new Date('2020-01-02T03:04:05Z'));
    source.catalog.set(PDFName.of('Lang'), PDFString.of('cs-CZ'));
    source.catalog.set(PDFName.of('PageLayout'), PDFName.of('TwoPageLeft'));
    source.catalog.set(PDFName.of('ViewerPreferences'), source.context.obj({ PrintScaling: PDFName.of('None') }));
    const xmp = source.context.flateStream('<x:xmpmeta>original metadata</x:xmpmeta>', { Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML') });
    source.catalog.set(PDFName.of('Metadata'), source.context.register(xmp));
    const p = project(); p.sourcePdf = await source.saveAsBase64(); p.pages[0].sourcePageIndex = 0;
    p.pages.push({ ...structuredClone(p.pages[0]), id: 'copy' });
    const output = await PDFDocument.load(await exportPdf(p), { updateMetadata: false });
    expect(output.getPageCount()).toBe(2); expect(output.getTitle()).toBe('Original title');
    expect(output.getAuthor()).toBe('Original author'); expect(output.getSubject()).toBe('Original subject');
    expect(output.getKeywords()).toBe('source metadata'); expect(output.getCreationDate()?.toISOString()).toBe('2020-01-02T03:04:05.000Z');
    expect(output.catalog.lookup(PDFName.of('Lang'), PDFString).decodeText()).toBe('cs-CZ');
    expect(output.catalog.get(PDFName.of('PageLayout'))).toBe(PDFName.of('TwoPageLeft'));
    expect(output.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict).get(PDFName.of('PrintScaling'))).toBe(PDFName.of('None'));
    expect(output.catalog.has(PDFName.of('Metadata'))).toBe(true);
    const copiedXmp = output.context.lookup(output.catalog.get(PDFName.of('Metadata')));
    if (!(copiedXmp instanceof PDFRawStream)) throw new Error('Missing metadata stream');
    expect(new TextDecoder().decode(decodePDFRawStream(copiedXmp).decode())).toBe('<x:xmpmeta>original metadata</x:xmpmeta>');
  });
  for (const structure of ['StructTreeRoot', 'OCProperties', 'UnknownExtension']) {
    it(`refuses structural copying of ${structure} instead of silently dropping document references`, async () => {
      const source = await PDFDocument.create(); source.addPage([300, 200]);
      source.catalog.set(PDFName.of(structure), source.context.obj({}));
      const p = project(); p.sourcePdf = await source.saveAsBase64(); p.pages[0].sourcePageIndex = 0;
      p.pages.push({ ...structuredClone(p.pages[0]), id: 'copy' });
      await expect(exportPdf(p)).rejects.toMatchObject({ code: 'unsupported-structure' });
    });
  }
});

import JSZip from 'jszip';
import { exportProjectZip, parseProjectZip } from './project-io';
import { exportPptx } from './exports';
import type { StudioObject } from './types';
const object = (changes: Partial<StudioObject> = {}): StudioObject => ({
  id: 'o1',
  name: 'Shape',
  kind: 'rect',
  x: 10,
  y: 20,
  width: 60,
  height: 40,
  rotation: 15,
  opacity: 0.8,
  fill: '#123456',
  stroke: '#654321',
  strokeWidth: 2,
  locked: false,
  ...changes,
});
describe('studio export safety and container integrity', () => {
  it('roundtrips a self-contained ZIP', async () =>
    expect(await parseProjectZip(await exportProjectZip(project()))).toEqual(
      project()
    ));
  it.each([
    'https://evil.test/image.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
  ])('rejects unsafe image source %s', (src) => {
    const p = project();
    p.pages[0].objects = [object({ kind: 'image', src })];
    expect(() => serializeProject(p)).toThrow();
  });
  it('rejects SVG markup in path and CSS in colors', () => {
    const p = project();
    p.pages[0].objects = [
      object({ kind: 'path', path: 'M0 0 <script>alert(1)</script>' }),
    ];
    expect(() => serializeProject(p)).toThrow();
    p.pages[0].objects = [object({ fill: 'url(https://evil.test)' })];
    expect(() => serializeProject(p)).toThrow();
  });
  it('escapes text and IDs in XML', async () => {
    const p = project();
    p.pages[0].objects = [object({ name: '<&"', kind: 'rect' })];
    const svg = await exportSvg(p, 'p1');
    expect(svg).toContain('rotate(15)');
    expect(svg).toContain('opacity="0.8"');
  });
  it('writes editable PPTX geometry and consistent slide links', async () => {
    const p = project();
    p.pages[0].objects = [object()];
    const zip = await JSZip.loadAsync(await exportPptx(p));
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide).toContain('<a:prstGeom prst="rect">');
    expect(slide).toContain('rot="900000"');
    expect(zip.file('ppt/slideLayouts/slideLayout1.xml')).not.toBeNull();
    expect(
      await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
    ).toContain('slides/slide1.xml');
  });
  it('rejects mixed PPTX page sizes', async () => {
    const p = project();
    p.pages.push({ ...p.pages[0], id: 'p2', width: 400 });
    await expect(exportPptx(p)).rejects.toThrow('stejnou');
  });
});

it('preserves original document metadata and form fields without page restructuring', async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 200]);
  source.setAuthor('Original author');
  const field = source.getForm().createTextField('original-field');
  field.setText('Keep me');
  const p = project();
  p.sourcePdf = await source.saveAsBase64();
  p.pages[0].sourcePageIndex = 0;
  p.pages[0].objects = [object()];
  const result = await PDFDocument.load(await exportPdf(p));
  expect(result.getAuthor()).toBe('Original author');
  expect(result.getForm().getTextField('original-field').getText()).toBe(
    'Keep me'
  );
});
import { readFile } from 'node:fs/promises';
import { vi } from 'vitest';
import { PDFRawStream, decodePDFRawStream } from 'pdf-lib';
it('embeds local Czech Unicode font mappings in vector PDF text', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () =>
        new Response(
          await readFile(
            'public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'
          )
        )
    );
  try {
    const p = project();
    p.pages[0].objects = [
      object({
        kind: 'text',
        text: 'Český žluťoučký kůň',
        fontSize: 24,
        fontFamily: 'Liberation Sans',
      }),
    ];
    const result = await PDFDocument.load(await exportPdf(p));
    const fonts = result
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    const first = fonts.lookup(fonts.keys()[0], PDFDict);
    const unicode = first.lookup(PDFName.of('ToUnicode')) as PDFRawStream;
    const cmap = new TextDecoder().decode(decodePDFRawStream(unicode).decode());
    expect(cmap).toContain('<010C>');
    expect(cmap).toContain('<016F>');
    expect(fetchMock).toHaveBeenCalledWith(
      '/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'
    );
  } finally {
    fetchMock.mockRestore();
  }
});

it.each(['form', 'attachment'])(
  'rejects restructuring PDF with %s instead of losing document data',
  async (kind) => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    if (kind === 'form')
      source.getForm().createTextField('keep').setText('Keep');
    if (kind === 'attachment')
      await source.attach(new Uint8Array([1, 2, 3]), 'keep.bin');
    const p = project();
    p.sourcePdf = await source.saveAsBase64();
    p.pages[0].sourcePageIndex = 0;
    p.pages.push({ ...p.pages[0], id: 'copy' });
    await expect(exportPdf(p)).rejects.toThrow('podporována');
  }
);

import { pdfPageViewportInverse } from './exports';
it.each([0, 90, 180, 270])(
  'maps visible page coordinates through CropBox and rotation %i',
  async (rotation) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    page.setCropBox(20, 30, 300, 500);
    page.setRotation(degrees(rotation));
    const expected: Record<number, number[]> = {
      0: [1, 0, 0, -1, 20, 530],
      90: [0, 1, 1, 0, 20, 30],
      180: [-1, 0, 0, 1, 320, 30],
      270: [0, -1, -1, 0, 320, 530],
    };
    expect(pdfPageViewportInverse(page)).toEqual(expected[rotation]);
  }
);
it('intersects crop with media and accounts for UserUnit', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.setCropBox(-20, -30, 500, 700);
  page.node.set(PDFName.of('UserUnit'), doc.context.obj(2));
  expect(pdfPageViewportInverse(page)).toEqual([0.5, 0, 0, -0.5, 0, 600]);
});

import { pdfBackgroundScale } from './exports';
it('caps preview resolution but preserves requested raster export resolution', () => {
  expect(pdfBackgroundScale(600, 800)).toBe(1.5);
  expect(pdfBackgroundScale(600, 800, 4)).toBe(4);
  expect(pdfBackgroundScale(14400, 14400)).toBeLessThan(0.12);
  expect(() => pdfBackgroundScale(14400, 14400, 4)).toThrow();
});
it.each(['\u0000', '\u0001', '\ud800'])(
  'rejects XML-invalid control or surrogate %s',
  (character) => {
    const p = project();
    p.pages[0].objects = [
      object({ kind: 'text', text: `A${character}B`, fontSize: 24 }),
    ];
    expect(() => serializeProject(p)).toThrow();
  }
);
