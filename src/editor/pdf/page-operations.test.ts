import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import {
  assertPageOperationSupported,
  cropPdfPages,
  extractPdfPages,
  mergePdfDocuments,
  rotatePdfPages,
} from './page-operations';

async function fixture() {
  const doc = await PDFDocument.create();
  doc.setTitle('Source title');
  doc.addPage([300, 400]).drawText('First page');
  const second = doc.addPage([500, 600]);
  second.setRotation(degrees(90));
  second.setCropBox(20, 30, 400, 500);
  second.drawText('Second page');
  return doc;
}

describe('local PDF page operations', () => {
  it('rotates only selected pages relative to existing rotation without changing input', async () => {
    const input = await (await fixture()).save();
    const original = input.slice();
    const doc = await PDFDocument.load(await rotatePdfPages(input, [1], -180));
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 270]);
    expect(doc.getPage(1).getCropBox()).toEqual({
      x: 20,
      y: 30,
      width: 400,
      height: 500,
    });
    expect(doc.getTitle()).toBe('Source title');
    expect(input).toEqual(original);
  });

  it('extracts in selected order, retaining page sizes, rotation, content and document title', async () => {
    const doc = await PDFDocument.load(
      await extractPdfPages(await (await fixture()).save(), [1, 0])
    );
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([500, 300]);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPages().every((p) => p.node.Contents() !== undefined)).toBe(
      true
    );
    expect(doc.getTitle()).toBe('Source title');
  });

  it('merges in input order and retains first document metadata', async () => {
    const a = await fixture();
    const b = await PDFDocument.create();
    b.addPage([700, 800]);
    const doc = await PDFDocument.load(
      await mergePdfDocuments([await a.save(), await b.save()])
    );
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([300, 500, 700]);
    expect(doc.getTitle()).toBe('Source title');
  });

  it('crops in original page coordinates without deleting content or changing MediaBox', async () => {
    const input = await (await fixture()).save();
    const doc = await PDFDocument.load(
      await cropPdfPages(input, [1], { x: 25, y: 40, width: 200, height: 300 })
    );
    expect(doc.getPage(1).getCropBox()).toEqual({
      x: 25,
      y: 40,
      width: 200,
      height: 300,
    });
    expect(doc.getPage(1).getMediaBox()).toEqual({
      x: 0,
      y: 0,
      width: 500,
      height: 600,
    });
    expect(doc.getPage(1).node.Contents()).toBeDefined();
    expect(doc.getPage(0).getCropBox()).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 400,
    });
  });

  it.each(
    [[], [0, 0], [-1], [2], [0.5], [NaN]].map((indices) => ({ indices }))
  )('rejects invalid selection $indices', async ({ indices }) => {
    await expect(
      extractPdfPages(await (await fixture()).save(), indices)
    ).rejects.toMatchObject({ code: 'invalid-selection' });
  });

  it('rejects invalid rotations, crops, empty input and too many pages', async () => {
    const bytes = await (await fixture()).save();
    await expect(rotatePdfPages(bytes, [0], 45)).rejects.toMatchObject({
      code: 'invalid-angle',
    });
    await expect(
      cropPdfPages(bytes, [0], { x: 0, y: 0, width: Infinity, height: 1 })
    ).rejects.toMatchObject({ code: 'invalid-crop' });
    await expect(
      cropPdfPages(bytes, [0], { x: 290, y: 0, width: 20, height: 1 })
    ).rejects.toMatchObject({ code: 'invalid-crop' });
    await expect(mergePdfDocuments([])).rejects.toMatchObject({
      code: 'invalid-input',
    });
    const large = await PDFDocument.create();
    for (let i = 0; i < 201; i++) large.addPage();
    await expect(
      extractPdfPages(await large.save(), [0])
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it.each([
    'AcroForm',
    'Outlines',
    'Names',
    'StructTreeRoot',
    'OCProperties',
    'OpenAction',
    'AF',
    'Dests',
  ])('refuses unsafe copy of %s', async (key) => {
    const doc = await fixture();
    doc.catalog.set(PDFName.of(key), doc.context.obj({}));
    const bytes = await doc.save();
    await expect(extractPdfPages(bytes, [0])).rejects.toMatchObject({
      code: 'unsupported-structure',
    });
    await expect(mergePdfDocuments([bytes])).rejects.toMatchObject({
      code: 'unsupported-structure',
    });
  });

  it('refuses annotation references during copy, but preserves them during rotation', async () => {
    const doc = await fixture();
    doc
      .getPage(0)
      .node.set(
        PDFName.of('Annots'),
        doc.context.obj([
          { Type: 'Annot', Subtype: 'Text', Rect: [1, 2, 3, 4] },
        ])
      );
    const bytes = await doc.save();
    await expect(extractPdfPages(bytes, [0])).rejects.toMatchObject({
      code: 'unsupported-structure',
    });
    const out = await PDFDocument.load(await rotatePdfPages(bytes, [0], 90));
    expect(out.getPage(0).node.Annots()?.size()).toBe(1);
  });

  it('refuses signature dictionaries even without a visible form field', async () => {
    const doc = await fixture();
    doc.context.register(
      doc.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3] })
    );
    const bytes = await doc.save();
    await expect(rotatePdfPages(bytes, [0], 90)).rejects.toMatchObject({
      code: 'signed',
    });
    await expect(
      cropPdfPages(bytes, [0], { x: 0, y: 0, width: 20, height: 20 })
    ).rejects.toMatchObject({ code: 'signed' });
  });

  it('preflights original bytes and rejects encrypted inputs rather than emitting plaintext', async () => {
    const doc = await fixture();
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({
        Filter: 'Standard',
        V: 1,
        R: 2,
        Length: 40,
        O: '',
        U: '',
        P: -4,
      })
    );
    const bytes = await doc.save();
    await expect(
      assertPageOperationSupported(bytes, 'rotate')
    ).rejects.toMatchObject({ code: 'encrypted' });
    await expect(mergePdfDocuments([bytes])).rejects.toMatchObject({
      code: 'encrypted',
    });
  });

  it('preserves forms and tagged catalog during same-document rotation', async () => {
    const doc = await fixture();
    doc.getForm().createTextField('Name').setText('Preserved value');
    doc.catalog.set(
      PDFName.of('StructTreeRoot'),
      doc.context.obj({ Type: 'StructTreeRoot' })
    );
    const out = await PDFDocument.load(
      await rotatePdfPages(await doc.save(), [1], 90)
    );
    expect(out.getForm().getTextField('Name').getText()).toBe(
      'Preserved value'
    );
    expect(out.catalog.has(PDFName.of('StructTreeRoot'))).toBe(true);
  });

  it('validates every crop target before producing output', async () => {
    const bytes = await (await fixture()).save();
    const before = bytes.slice();
    await expect(
      cropPdfPages(bytes, [1, 0], { x: 0, y: 0, width: 400, height: 500 })
    ).rejects.toMatchObject({ code: 'invalid-crop' });
    expect(bytes).toEqual(before);
  });

  it('rejects combined page count beyond the editor limit', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 101; i++) doc.addPage();
    const bytes = await doc.save();
    await expect(mergePdfDocuments([bytes, bytes])).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
  });
});
