// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { prepareRedaction } from './redaction';
import { nativeRedactCopy } from './native-redaction';
import { inspect, unchangedPixelsEqual } from '../../tests/helpers/editor-pdf-inspect.js';

async function extract(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false });
  try {
    const document = await task.promise;
    const all: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      all.push((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return all.join(' ');
  } finally { await task.destroy(); }
}

async function decodedObjects(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const chunks: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    chunks.push(object.toString());
    if (object instanceof PDFRawStream) chunks.push(new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()));
  }
  return chunks.join('\n');
}

function incrementalFixture(): Uint8Array {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  const add = (number: number, body: string) => { offsets[number] = pdf.length; pdf += `${number} 0 obj\n${body}\nendobj\n`; };
  const stream = (text: string) => {
    const body = `BT /F1 14 Tf 40 100 Td (${text}) Tj ET\n`;
    return `<< /Length ${body.length} >>\nstream\n${body}endstream`;
  };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  add(4, stream('OLDREVISIONSECRET'));
  add(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const previousXref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let index = 1; index <= 5; index++) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${previousXref}\n%%EOF\n`;
  const nextOffset = pdf.length;
  pdf += `4 0 obj\n${stream('CURRENTSECRET')}\nendobj\n`;
  const nextXref = pdf.length;
  pdf += `xref\n4 1\n${String(nextOffset).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R /Prev ${previousXref} >>\nstartxref\n${nextXref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe('native region redaction preparation', () => {
  it('removes selected text while keeping outside text and never changing input bytes', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    page.drawText('SECRETCORE', { x: 40, y: 100, size: 18 });
    page.drawText('PUBLICLINE', { x: 40, y: 300, size: 18 });
    const original = await doc.save(), copy = original.slice();
    expect(await extract(original)).toContain('SECRETCORE');
    const result = await prepareRedaction(original, [{ pageIndex: 0, rect: [35, 95, 220, 30] }]);
    expect(result.requiresRecoveryPurge).toBe(true);
    expect(result.requiresIndependentReview).toBe(true);
    expect(original).toEqual(copy);
    const text = await extract(result.bytes);
    expect(text).not.toContain('SECRETCORE');
    expect(text).toContain('PUBLICLINE');
    expect(new TextDecoder('latin1').decode(result.bytes)).not.toContain('SECRETCORE');
    expect(await decodedObjects(result.bytes)).not.toContain('SECRETCORE');
  }, 30_000);

  it('removes metadata and comments, and preserves crop/rotation geometry', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('PRIVATE TITLE');
    const page = doc.addPage([400, 500]);
    page.setCropBox(20, 30, 300, 350);
    page.setRotation(degrees(90));
    page.node.set(PDFName.of('UserUnit'), doc.context.obj(2));
    page.drawText('HIDE', { x: 50, y: 100 });
    const comment = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 100, 100, 140], P: page.ref, Contents: PDFString.of('PRIVATE COMMENT') }));
    page.node.addAnnot(comment);
    const result = await prepareRedaction(await doc.save(), [{ pageIndex: 0, rect: [45, 95, 100, 20] }]);
    const parsed = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(parsed.getPage(0).getCropBox()).toEqual(page.getCropBox());
    expect(parsed.getPage(0).getRotation().angle).toBe(90);
    expect(parsed.getPage(0).node.get(PDFName.of('UserUnit'))?.toString()).toBe('2');
    expect(parsed.getPage(0).node.has(PDFName.of('Annots'))).toBe(false);
    expect(parsed.context.trailerInfo.Info).toBeUndefined();
    expect(parsed.catalog.has(PDFName.of('Metadata'))).toBe(false);
    expect(await extract(result.bytes)).not.toContain('HIDE');
    expect(new TextDecoder('latin1').decode(result.bytes)).not.toContain('PRIVATE COMMENT');
    const independent = await inspect(result.bytes);
    expect(independent.annotations).toEqual([]);
    expect(independent.attachments).toBeNull();
    expect(JSON.stringify(independent.metadata.info)).not.toContain('PRIVATE TITLE');
  }, 30_000);

  it('replaces intersecting image pixels and paths without retaining the original image stream', async () => {
    const imageCanvas = createCanvas(80, 40), imageContext = imageCanvas.getContext('2d');
    imageContext.fillStyle = '#e11d48'; imageContext.fillRect(0, 0, 40, 40);
    imageContext.fillStyle = '#16a34a'; imageContext.fillRect(40, 0, 40, 40);
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    const image = await doc.embedPng(imageCanvas.toBuffer('image/png'));
    page.drawImage(image, { x: 30, y: 100, width: 160, height: 80 });
    page.drawRectangle({ x: 30, y: 100, width: 160, height: 5, color: rgb(0, 0, 1) });
    const original = await doc.save(), before = await inspect(original, true, 1, [30, 100, 105, 180]);
    const rawBefore = await PDFDocument.load(original);
    const imageStreams = rawBefore.context.enumerateIndirectObjects().map(([, value]) => value)
      .filter((value): value is PDFRawStream => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
      .map(value => decodePDFRawStream(value).decode());
    expect(imageStreams.length).toBeGreaterThan(0);
    const result = await prepareRedaction(original, [{ pageIndex: 0, rect: [30, 100, 75, 80] }]);
    const after = await inspect(result.bytes, true, 1, [30, 100, 105, 180]);
    expect(unchangedPixelsEqual(before.pixels!, after.pixels!)).toBe(true);
    expect(Buffer.from(before.pixels!.data).equals(Buffer.from(after.pixels!.data))).toBe(false);
    const rawAfter = await PDFDocument.load(result.bytes);
    const outputStreams = rawAfter.context.enumerateIndirectObjects().map(([, value]) => value)
      .filter((value): value is PDFRawStream => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
      .map(value => decodePDFRawStream(value).decode());
    for (const originalStream of imageStreams) expect(outputStreams.some(outputStream => Buffer.from(outputStream).equals(Buffer.from(originalStream)))).toBe(false);
  }, 30_000);

  it('rejects a second placement of a shared image before native mutation', async () => {
    const canvas = createCanvas(40, 40), context = canvas.getContext('2d');
    context.fillStyle = '#dc2626'; context.fillRect(0, 0, 40, 40);
    const doc = await PDFDocument.create(), page = doc.addPage([300, 400]);
    const image = await doc.embedPng(canvas.toBuffer('image/png'));
    page.drawImage(image, { x: 30, y: 50, width: 80, height: 80 });
    page.drawImage(image, { x: 30, y: 250, width: 80, height: 80 });
    const bytes = await doc.save(), copy = bytes.slice();
    await expect(prepareRedaction(bytes, [{ pageIndex: 0, rect: [30, 50, 80, 80] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(bytes).toEqual(copy);
  }, 30_000);

  it('rejects unsupported forms and invalid regions without altering the source', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage([400, 500]);
    page.drawText('KEEP', { x: 30, y: 50 });
    doc.getForm().createTextField('field').addToPage(page, { x: 20, y: 200, width: 100, height: 20 });
    const input = await doc.save(), copy = input.slice();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [25, 45, 100, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [-1, 45, 100, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(input).toEqual(copy);
  });

  it('does not mutate source bytes when cancelled before opening the native engine', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage([300, 300]);
    page.drawText('PRIVATE', { x: 40, y: 100 });
    const input = await doc.save(), copy = input.slice(), abort = new AbortController();
    abort.abort();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 100, 20] }], undefined, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(input).toEqual(copy);
  });

  it('fails closed on nested document JavaScript', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('PRIVATE', { x: 40, y: 100 });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
    const input = await doc.save(), copy = input.slice();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 100, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(input).toEqual(copy);
  });

  it('rejects a signed revision before native mutation', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('PRIVATE', { x: 40, y: 100 });
    const signature = doc.context.register(doc.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30], Contents: PDFString.of('TESTSIGNATURE') }));
    doc.catalog.set(PDFName.of('Perms'), doc.context.obj({ DocMDP: signature }));
    const input = await doc.save(), copy = input.slice();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 100, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(input).toEqual(copy);
  });

  it('leaves input bytes unchanged when the isolated native open fails', async () => {
    const input = new TextEncoder().encode('%PDF-1.7\ninvalid'), copy = input.slice();
    await expect(nativeRedactCopy(input, [{ pageIndex: 0, rect: [1, 1, 10, 10] }], new AbortController().signal)).rejects.toThrow();
    expect(input).toEqual(copy);
  });

  it('records the native graphics state shape used for redaction overlays', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('PRIVATE', { x: 40, y: 100 });
    const bytes = await nativeRedactCopy(await doc.save(), [{ pageIndex: 0, rect: [35, 95, 100, 20] }], new AbortController().signal);
    const native = await PDFDocument.load(bytes), resources = native.getPage(0).node.Resources()!;
    const ext = resources.lookup(PDFName.of('ExtGState')) as import('pdf-lib').PDFDict;
    const shapes = ext.entries().map(([name, entry]) => {
      const state = native.context.lookup(entry) as import('pdf-lib').PDFDict;
      return [name.decodeText(), state.entries().map(([key, value]) => [key.decodeText(), value.toString()]).sort((a, b) => a[0].localeCompare(b[0]))];
    });
    expect(shapes).toEqual([['FXE1', [['BM', '/Normal'], ['ca', '1'], ['CA', '1']]]]);
  });

  it('rejects Type3 and ToUnicode font streams that can retain redacted mappings', async () => {
    const seed = await PDFDocument.create(), seedPage = seed.addPage([300, 300]);
    seedPage.drawText('FONTSECRET', { x: 40, y: 100 });
    const base = await PDFDocument.load(await seed.save()), page = base.getPage(0);
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as import('pdf-lib').PDFDict;
    const fontRef = fonts.values()[0], font = base.context.lookup(fontRef) as import('pdf-lib').PDFDict;
    const map = base.context.register(base.context.flateStream('beginbfchar\n<41> <0046004F004E0054005300450043005200450054>\nendbfchar'));
    font.set(PDFName.of('ToUnicode'), map);
    const mapped = await base.save();
    await expect(prepareRedaction(mapped, [{ pageIndex: 0, rect: [35, 95, 140, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    font.delete(PDFName.of('ToUnicode'));
    font.set(PDFName.of('Subtype'), PDFName.of('Type3'));
    const type3 = await base.save();
    await expect(prepareRedaction(type3, [{ pageIndex: 0, rect: [35, 95, 140, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    font.set(PDFName.of('Subtype'), base.context.register(PDFName.of('Type3')));
    const indirectType3 = await base.save();
    await expect(prepareRedaction(indirectType3, [{ pageIndex: 0, rect: [35, 95, 140, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });

  it.each(['direct', 'escaped', 'indirect'] as const)('rejects %s marked-content ActualText before native removal', async variant => {
    const seed = await PDFDocument.create(), seedPage = seed.addPage([300, 300]);
    seedPage.drawText('SENSITIVEACCOUNT PUBLIC', { x: 40, y: 100, size: 14 });
    const doc = await PDFDocument.load(await seed.save()), page = doc.getPage(0);
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as import('pdf-lib').PDFDict;
    const fontName = fonts.keys()[0].decodeText();
    if (variant === 'indirect') page.node.Resources()!.set(PDFName.of('Properties'), doc.context.obj({ SecretProps: doc.context.obj({ ActualText: PDFString.of('SENSITIVEACCOUNT PUBLIC') }) }));
    const property = variant === 'indirect' ? '/SecretProps' : variant === 'escaped' ? '<< /#41ctualText (SENSITIVEACCOUNT PUBLIC) >>' : '<< /ActualText (SENSITIVEACCOUNT PUBLIC) >>';
    const content = `/Span ${property} BDC BT /${fontName} 14 Tf 40 100 Td (SENSITIVEACCOUNT PUBLIC) Tj ET EMC`;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    const input = await doc.save(), copy = input.slice();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 145, 30] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(input).toEqual(copy);
  });

  it('rejects an ExtGState soft-mask Form and pattern resources', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('VISIBLE', { x: 40, y: 100 });
    const mask = doc.context.register(doc.context.flateStream('BT (MASKSECRET) Tj ET', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 300, 300],
      Group: { S: 'Transparency', CS: 'DeviceGray' },
    }));
    const gs = doc.context.register(doc.context.obj({ Type: 'ExtGState', SMask: { S: 'Luminosity', G: mask } }));
    page.node.Resources()!.set(PDFName.of('ExtGState'), doc.context.obj({ GS1: gs }));
    const input = await doc.save();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 100, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    const doc2 = await PDFDocument.create(), page2 = doc2.addPage([300, 300]);
    page2.drawText('VISIBLE', { x: 40, y: 100 });
    page2.node.Resources()!.set(PDFName.of('Pattern'), doc2.context.obj({ P1: doc2.context.obj({ PatternType: 1 }) }));
    await expect(prepareRedaction(await doc2.save(), [{ pageIndex: 0, rect: [35, 95, 100, 20] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });

  it('discards an earlier incremental revision during the full rewrite', async () => {
    const bytes = incrementalFixture();
    expect(await extract(bytes)).toContain('CURRENTSECRET');
    expect(await extract(bytes)).not.toContain('OLDREVISIONSECRET');
    const result = await prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 150, 30] }]);
    expect(await extract(result.bytes)).not.toContain('CURRENTSECRET');
    const raw = new TextDecoder('latin1').decode(result.bytes);
    expect(raw).not.toContain('OLDREVISIONSECRET');
    expect(raw).not.toContain('/Prev');
    expect(raw.match(/%%EOF/g)).toHaveLength(1);
  }, 30_000);

  it('drops an embedded attachment while redacting the page', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('PAGESECRET', { x: 40, y: 100 });
    await doc.attach(new TextEncoder().encode('ATTACHMENTSECRET'), 'data.bin', { mimeType: 'application/octet-stream' });
    const input = await doc.save();
    expect((await inspect(input)).attachments).not.toBeNull();
    const result = await prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 120, 20] }]);
    expect((await inspect(result.bytes)).attachments).toBeNull();
    expect(await decodedObjects(result.bytes)).not.toContain('ATTACHMENTSECRET');
    expect(await decodedObjects(result.bytes)).not.toContain('PAGESECRET');
  }, 30_000);

  it('discards unused but reachable Form and image XObjects from Resources', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('REDACTME', { x: 40, y: 100 });
    const secretForm = doc.context.register(doc.context.flateStream('BT (UNUSED_FORM_SECRET) Tj ET', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 200, 50], Resources: {},
    }));
    const canvas = createCanvas(3, 3), context = canvas.getContext('2d');
    context.fillStyle = '#c026d3'; context.fillRect(0, 0, 3, 3);
    const image = await doc.embedPng(canvas.toBuffer('image/png'));
    page.node.Resources()!.set(PDFName.of('XObject'), doc.context.obj({ UnusedForm: secretForm, UnusedImage: image.ref }));
    const bytes = await doc.save();
    expect(await decodedObjects(bytes)).toContain('UNUSED_FORM_SECRET');
    const inputDoc = await PDFDocument.load(bytes);
    const inputImage = inputDoc.context.lookup(image.ref) as PDFRawStream;
    const inputImageData = decodePDFRawStream(inputImage).decode();
    const result = await prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 140, 20] }]);
    const payloads = await decodedObjects(result.bytes);
    expect(payloads).not.toContain('UNUSED_FORM_SECRET');
    const outputDoc = await PDFDocument.load(result.bytes);
    const images = outputDoc.context.enumerateIndirectObjects().map(([, value]) => value)
      .filter((value): value is PDFRawStream => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images.some(value => Buffer.from(decodePDFRawStream(value).decode()).equals(Buffer.from(inputImageData)))).toBe(false);
  }, 30_000);

  it('rejects nested Form XObjects until matrix composition is fixed in native source', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const inner = doc.context.flateStream('BT /F1 14 Tf 5 10 Td (NESTEDSECRET) Tj ET', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 150, 30],
      Resources: { Font: { F1: font.ref } },
    });
    const innerRef = doc.context.register(inner);
    const outer = doc.context.flateStream('q /Inner Do Q', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 150, 30],
      Resources: { XObject: { Inner: innerRef } },
    });
    const outerRef = doc.context.register(outer);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Outer: outerRef } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 1 0 0 1 40 100 cm /Outer Do Q')));
    const bytes = await doc.save();
    expect(await extract(bytes)).toContain('NESTEDSECRET');
    await expect(prepareRedaction(bytes, [{ pageIndex: 0, rect: [40, 100, 150, 30] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
  }, 30_000);

  it('rejects a Form that inherits page resources through a missing Resources entry', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const inner = doc.context.register(doc.context.flateStream('BT /F1 14 Tf 0 10 Td (SCALESECRET) Tj ET', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 160, 30], Resources: { Font: { F1: font.ref } },
    }));
    const outer = doc.context.register(doc.context.flateStream('q 1 0 0 1 80 80 cm /Inner Do Q', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 240, 180],
    }));
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Outer: outer, Inner: inner } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 2 0 0 2 0 0 cm /Outer Do Q')));
    const input = await doc.save(), copy = input.slice();
    expect(await extract(input)).toContain('SCALESECRET');
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [155, 175, 220, 35] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(input).toEqual(copy);
  }, 30_000);

  it('rejects an indirect Form subtype before marked content can evade inspection', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.context.flateStream('/Span << /ActualText (SENSITIVEACCOUNT PUBLIC) >> BDC BT /F1 14 Tf 0 10 Td (SENSITIVEACCOUNT PUBLIC) Tj ET EMC', {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 240, 30], Resources: { Font: { F1: font.ref } },
    });
    form.dict.set(PDFName.of('Subtype'), doc.context.register(PDFName.of('Form')));
    const formRef = doc.context.register(form);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Outer: formRef } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 1 0 0 1 40 100 cm /Outer Do Q')));
    const input = await doc.save(), copy = input.slice();
    await expect(prepareRedaction(input, [{ pageIndex: 0, rect: [35, 95, 145, 30] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(input).toEqual(copy);
  }, 30_000);
});

it.each(['Thumb', 'PagePrivate', 'Lang', 'PageLabels', 'ViewerPreferences', 'FontPrivate'])('removes or refuses ancillary payload %s through native kernel', async kind => {
  const seed = await PDFDocument.create(); seed.addPage([300, 300]).drawText('SECRET PUBLIC', { x: 40, y: 100, size: 14 });
  const doc = await PDFDocument.load(await seed.save()), page = doc.getPage(0), payload = PDFString.of('ANCILLARYSECRET');
  if (kind === 'Thumb') page.node.set(PDFName.of('Thumb'), doc.context.register(doc.context.flateStream(new TextEncoder().encode('ANCILLARYSECRET'), { Type: 'XObject', Subtype: 'Image', Width: 5, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 })));
  if (kind === 'PagePrivate') page.node.set(PDFName.of('PrivateData'), payload);
  if (kind === 'Lang') doc.catalog.set(PDFName.of('Lang'), payload);
  if (kind === 'PageLabels') doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: [0, { P: payload }] }));
  if (kind === 'ViewerPreferences') doc.catalog.set(PDFName.of('ViewerPreferences'), doc.context.obj({ PrivateData: payload }));
  if (kind === 'FontPrivate') {
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as import('pdf-lib').PDFDict;
    (doc.context.lookup(fonts.values()[0]) as import('pdf-lib').PDFDict).set(PDFName.of('PrivateData'), payload);
  }
  const bytes = await doc.save(), copy = bytes.slice();
  try {
    const result = await prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 65, 25] }]);
    expect(await decodedObjects(result.bytes)).not.toContain('ANCILLARYSECRET');
    const raw = new TextDecoder('latin1').decode(result.bytes);
    expect(raw).not.toContain('/Prev'); expect(raw.match(/%%EOF/g)).toHaveLength(1);
  } catch (error) { expect(error).toMatchObject({ code: 'unsupported-structure' }); }
  expect(bytes).toEqual(copy);
}, 30_000);

it.each(['page-tree', 'font-descriptor', 'font-encoding', 'font-base', 'form-extra', 'image-extra', 'content-extra', 'trailing-operands', 'comment'])('refuses retained schema extension or wrong leaf type: %s', async kind => {
  const seed = await PDFDocument.create(); seed.addPage([300, 300]).drawText('SECRET PUBLIC', { x: 40, y: 100, size: 14 });
  const doc = await PDFDocument.load(await seed.save()), page = doc.getPage(0), payload = PDFString.of('ANCILLARYSECRET');
  const fonts = page.node.Resources()!.lookup(PDFName.of('Font')) as import('pdf-lib').PDFDict;
  const font = doc.context.lookup(fonts.values()[0]) as import('pdf-lib').PDFDict;
  if (kind === 'page-tree') (doc.catalog.lookup(PDFName.of('Pages')) as import('pdf-lib').PDFDict).set(PDFName.of('PrivateData'), payload);
  if (kind === 'font-descriptor') font.set(PDFName.of('FontDescriptor'), doc.context.obj({ PrivateData: payload }));
  if (kind === 'font-encoding') font.set(PDFName.of('Encoding'), doc.context.obj({ Type: 'Encoding', Differences: [65, 'ANCILLARYSECRET'] }));
  if (kind === 'font-base') font.set(PDFName.of('BaseFont'), payload);
  if (kind === 'image-extra' || kind === 'form-extra') {
    const s = kind === 'image-extra' ? doc.context.flateStream(new Uint8Array([1, 2, 3]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }) : doc.context.flateStream('q Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: {} });
    s.dict.set(PDFName.of('PrivateData'), doc.context.obj({ Nested: payload }));
    page.node.Resources()!.set(PDFName.of('XObject'), doc.context.obj({ X1: doc.context.register(s) }));
  }
  if (kind === 'content-extra' || kind === 'trailing-operands' || kind === 'comment') {
    const content = doc.context.flateStream(kind === 'trailing-operands' ? 'q Q (ANCILLARYSECRET)' : kind === 'comment' ? 'q Q % ANCILLARYSECRET' : 'q Q');
    if (kind === 'content-extra') content.dict.set(PDFName.of('PrivateData'), payload);
    page.node.set(PDFName.of('Contents'), doc.context.register(content));
  }
  const bytes = await doc.save(), copy = bytes.slice();
  await expect(prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 65, 25] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
  expect(bytes).toEqual(copy);
});

it('rejects decoded image trailing bytes and removes compressed-stream trailing bytes', async () => {
  for (const decodedTrailing of [true, false]) {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
    page.drawText('SECRET PUBLIC', { x: 40, y: 100, size: 14 });
    const pixels = new Uint8Array([10, 20, 30]), secret = new TextEncoder().encode('STREAMTRAILINGSECRET');
    const image = doc.context.flateStream(decodedTrailing ? new Uint8Array([...pixels, ...secret]) : pixels, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' });
    const raw = decodedTrailing ? image : PDFRawStream.of(image.dict, new Uint8Array([...image.getContents(), ...secret]));
    page.node.Resources()!.set(PDFName.of('XObject'), doc.context.obj({ Image1: doc.context.register(raw) }));
    page.node.addContentStream(doc.context.register(doc.context.flateStream('q 10 0 0 10 200 200 cm /Image1 Do Q')));
    const bytes = await doc.save();
    if (decodedTrailing) await expect(prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 65, 25] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    else {
      const result = await prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 65, 25] }]);
      expect(await decodedObjects(result.bytes)).not.toContain('STREAMTRAILINGSECRET');
      expect(await extract(result.bytes)).toContain('PUBLIC');
    }
  }
});

it.each(['Form', 'Image'])('prunes unused %s resources on an unmarked second page', async subtype => {
  const doc = await PDFDocument.create(); doc.addPage([300, 300]).drawText('SECRETACCOUNT', { x: 40, y: 100 });
  const page = doc.addPage([300, 300]); page.drawText('PUBLIC', { x: 40, y: 100 });
  const resource = subtype === 'Form'
    ? doc.context.flateStream('BT /F1 12 Tf (SECRETACCOUNT) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 20], Resources: { Font: { F1: (await doc.embedFont(StandardFonts.Helvetica)).ref } } })
    : doc.context.flateStream(new TextEncoder().encode('SECRETACCOUNT!!'), { Type: 'XObject', Subtype: 'Image', Width: 5, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  page.node.Resources()!.set(PDFName.of('XObject'), doc.context.obj({ Unused: doc.context.register(resource) }));
  const bytes = await doc.save();
  const result = await prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 220, 30] }]);
  expect(await decodedObjects(result.bytes)).not.toContain('SECRETACCOUNT');
  expect(await extract(result.bytes)).toContain('PUBLIC');
});

it('refuses a modest compressed page bomb during expansion', async () => {
  const doc = await PDFDocument.create(), page = doc.addPage([300, 300]);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(new Uint8Array(9 * 1024 * 1024).fill(32))));
  const bytes = await doc.save(); expect(bytes.length).toBeLessThan(20_000);
  await expect(prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 65, 25] }])).rejects.toMatchObject({ code: 'limit-exceeded' });
});


it.each(['ObjStm', 'XRef'])('bounds %s decompression during initial PDF loading', async type => {
  const doc = await PDFDocument.create(); doc.addPage([300, 300]).drawText('PUBLIC', { x: 40, y: 100 });
  doc.context.register(doc.context.flateStream(new Uint8Array(9 * 1024 * 1024).fill(32), { Type: type, N: 0, First: 0, Size: 1, W: [1, 1, 1] }));
  const bytes = await doc.save({ useObjectStreams: false }); expect(bytes.length).toBeLessThan(20_000);
  await expect(prepareRedaction(bytes, [{ pageIndex: 0, rect: [35, 95, 65, 25] }])).rejects.toMatchObject({ code: 'limit-exceeded' });
});

it('prunes shared font dictionaries per page without removing another page font', async () => {
  const doc = await PDFDocument.create(), a = doc.addPage([300, 300]), b = doc.addPage([300, 300]);
  const f1 = await doc.embedFont(StandardFonts.Helvetica), f2 = await doc.embedFont(StandardFonts.Courier);
  const resources = doc.context.register(doc.context.obj({ Font: { F1: f1.ref, F2: f2.ref } }));
  a.node.set(PDFName.of('Resources'), resources); b.node.set(PDFName.of('Resources'), resources);
  a.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('BT /F1 14 Tf 40 100 Td (SECRETACCOUNT) Tj ET')));
  b.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('BT /F2 14 Tf 40 100 Td (PUBLIC) Tj ET')));
  const result = await prepareRedaction(await doc.save(), [{ pageIndex: 0, rect: [35, 95, 220, 30] }]);
  expect(await decodedObjects(result.bytes)).not.toContain('SECRETACCOUNT');
  expect(await extract(result.bytes)).toContain('PUBLIC');
  const output = await PDFDocument.load(result.bytes), fonts = output.getPage(1).node.Resources()!.lookup(PDFName.of('Font')) as import('pdf-lib').PDFDict;
  expect(fonts.values()).toHaveLength(1);
  expect((output.context.lookup(fonts.values()[0]) as import('pdf-lib').PDFDict).get(PDFName.of('BaseFont'))).toBe(PDFName.of('Courier'));
});

it('drops shadowed inherited resource dictionaries and their unused Form payloads', async () => {
  const doc = await PDFDocument.create(); doc.addPage([300, 300]).drawText('SECRETACCOUNT', { x: 40, y: 100 });
  doc.addPage([300, 300]).drawText('PUBLIC', { x: 40, y: 100 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const hidden = doc.context.register(doc.context.flateStream('BT /F1 14 Tf (SECRETACCOUNT) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 30], Resources: { Font: { F1: font.ref } } }));
  (doc.catalog.lookup(PDFName.of('Pages')) as import('pdf-lib').PDFDict).set(PDFName.of('Resources'), doc.context.obj({ XObject: { Unused: hidden } }));
  const result = await prepareRedaction(await doc.save(), [{ pageIndex: 0, rect: [35, 95, 220, 30] }]);
  expect(await decodedObjects(result.bytes)).not.toContain('SECRETACCOUNT');
  expect(await extract(result.bytes)).toContain('PUBLIC');
});
