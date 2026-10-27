// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDict, PDFDocument, PDFName, PDFRef, PDFString, StandardFonts } from 'pdf-lib';
import { AnnotationMode, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inspect } from '../../tests/helpers/editor-pdf-inspect.js';
import { applyFormChanges, readFormFields } from './forms';
import { mergePdfForms } from './form-merge';

function fieldValues(data: unknown, name: string): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const field: unknown = Reflect.get(data, name);
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is { value: unknown } => typeof item === 'object' && item !== null && 'value' in item).map(item => item.value);
}

async function fixture(value: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create(), one = doc.addPage([400, 500]), two = doc.addPage([400, 500]), form = doc.getForm();
  doc.setTitle(`Title ${value}`); one.drawText(`Document ${value}`, { x: 20, y: 450 });
  const text = form.createTextField('group.text'); text.setText(value); text.addToPage(one, { x: 20, y: 350, width: 150, height: 25 }); text.addToPage(two, { x: 40, y: 350, width: 150, height: 25 });
  const check = form.createCheckBox('check'); check.addToPage(one, { x: 20, y: 300, width: 20, height: 20 }); check.check();
  const radio = form.createRadioGroup('radio'); radio.addOptionToPage('A', one, { x: 20, y: 250, width: 20, height: 20 }); radio.addOptionToPage('B', two, { x: 20, y: 250, width: 20, height: 20 }); radio.select('B');
  const choice = form.createDropdown('choice'); choice.addOptions(['One', 'Two']); choice.select('Two'); choice.addToPage(one, { x: 20, y: 200, width: 100, height: 25 });
  return doc.save();
}

describe('strict AcroForm merge', () => {
  it('preserves escaped DA font names when PDF.js regenerates an edited Courier field', async () => {
    const source = await PDFDocument.create(), page = source.addPage([300, 150]), font = await source.embedFont(StandardFonts.Courier);
    const field = source.getForm().createTextField('text'); field.setText('Original'); field.addToPage(page, { x: 20, y: 50, width: 240, height: 40, font });
    field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/He#6cv 12 Tf 0 g'));
    const acro = source.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    acro.set(PDFName.of('DR'), source.context.obj({ Font: { Helv: font.ref } }));
    const input = await source.save({ updateFieldAppearances: false }), original = input.slice(), merged = await mergePdfForms([input]);
    async function renderEdited(bytes: Uint8Array): Promise<Uint8ClampedArray> {
      const reader = await getDocument({ data: bytes.slice(), useSystemFonts: false, standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/` }).promise;
      try {
        const first = await reader.getPage(1), annotations = await first.getAnnotations();
        const widget = annotations.find(annotation => annotation.subtype === 'Widget'); if (!widget) throw new Error('Missing widget');
        reader.annotationStorage.setValue(widget.id, { value: 'WWWWiiii' });
        const viewport = first.getViewport({ scale: 1 }), canvas = createCanvas(viewport.width, viewport.height), context = canvas.getContext('2d');
        await first.render({ viewport, canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      } finally { await reader.destroy(); }
    }
    const before = await renderEdited(input), after = await renderEdited(merged);
    expect(after.reduce((count, value, index) => count + Number(value !== before[index]), 0)).toBe(0); expect(input).toEqual(original);
  });

  it('renames escaped DA resources consistently across every resource category', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 150]), font = await doc.embedFont(StandardFonts.Courier);
    const field = doc.getForm().createTextField('text'); field.addToPage(page, { x: 20, y: 50, width: 200, height: 30, font });
    const da = PDFString.of('/He#6Cv 12 Tf /st#61te gs /Gr#61y cs 0 sc'); field.acroField.dict.set(PDFName.of('DA'), da);
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict); acro.set(PDFName.of('DA'), da);
    acro.set(PDFName.of('DR'), doc.context.obj({ Font: { Helv: font.ref }, ExtGState: { state: { ca: 0.5 } }, ColorSpace: { Gray: PDFName.of('DeviceGray') } }));
    const output = await PDFDocument.load(await mergePdfForms([await doc.save({ updateFieldAppearances: false })]));
    const appearance = output.getForm().getTextField('document_1.text').acroField.dict.lookup(PDFName.of('DA'), PDFString).decodeText();
    expect(appearance).toBe('/document_1_Helv 12 Tf /document_1_state gs /document_1_Gray cs 0 sc');
    const resources = output.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('DR'), PDFDict);
    for (const [category, name] of [['Font', 'Helv'], ['ExtGState', 'state'], ['ColorSpace', 'Gray']]) expect(resources.lookup(PDFName.of(category), PDFDict).has(PDFName.of(`document_1_${name}`))).toBe(true);
  });

  it.each(['/Helv 12 Tf (literal /Helv)', '/Helv 12 Tf % /Helv comment', '/Helv#xx 12 Tf'])('conservatively refuses unsupported DA tokenization %s without changing input', async da => {
    const doc = await PDFDocument.load(await fixture('Safe')); doc.getForm().getTextField('group.text').acroField.dict.set(PDFName.of('DA'), PDFString.of(da));
    const input = await doc.save({ updateFieldAppearances: false }), copy = input.slice();
    await expect(mergePdfForms([input])).rejects.toMatchObject({ code: 'unsupported-structure' }); expect(input).toEqual(copy);
  });

  it('preserves every widget/value/AP, isolates duplicate names, and edits only one document', async () => {
    const one = await fixture('First'), two = await fixture('Second'), savedOne = one.slice(), savedTwo = two.slice();
    const merged = await mergePdfForms([one, two]), reopened = await PDFDocument.load(merged), fields = await readFormFields(merged);
    expect(reopened.getTitle()).toBe('Title First');
    expect(fields).toHaveLength(8);
    expect(fields.find(field => field.name === 'document_1.group.text')?.widgets.map(widget => widget.pageIndex)).toEqual([0, 1]);
    expect(fields.find(field => field.name === 'document_2.group.text')?.widgets.map(widget => widget.pageIndex)).toEqual([2, 3]);
    const reader = await getDocument({ data: merged.slice() }).promise;
    try {
      const values = await reader.getFieldObjects();
      expect(fieldValues(values, 'document_1.group.text')).toContain('First');
      expect(fieldValues(values, 'document_2.group.text')).toContain('Second');
      for (let index = 1; index <= 4; index++) {
        const widgets = (await (await reader.getPage(index)).getAnnotations()).filter(item => item.subtype === 'Widget');
        expect(widgets.length).toBeGreaterThanOrEqual(2);
        expect(widgets.every(item => item.hasAppearance)).toBe(true);
      }
    } finally { await reader.destroy(); }
    for (let index = 0; index < 4; index++) {
      const before = await inspect(index < 2 ? one : two, true, index % 2 + 1, undefined), after = await inspect(merged, true, index + 1, undefined);
      expect(after.pixels?.data.every((value, offset) => value === before.pixels?.data[offset])).toBe(true);
    }
    const fontBytes = new Uint8Array(await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'));
    const output = await applyFormChanges(merged, fields.filter(field => field.name.startsWith('document_1.')).map(field => ({ kind: 'set-value' as const, id: field.id, value: field.kind === 'text' ? 'Changed' : field.kind === 'checkbox' ? false : field.kind === 'radio' ? 'A' : ['One'] })), { fontBytes });
    const changed = await readFormFields(output);
    expect(changed.filter(field => field.name.startsWith('document_2.')).map(field => field.value)).toEqual(fields.filter(field => field.name.startsWith('document_2.')).map(field => field.value));
    const independent = await getDocument({ data: output.slice() }).promise;
    try { const values = await independent.getFieldObjects(); expect(fieldValues(values, 'document_1.group.text')).toContain('Changed'); expect(fieldValues(values, 'document_2.group.text')).toContain('Second'); expect(fieldValues(values, 'document_2.choice')).toContain('Two'); } finally { await independent.destroy(); }
    expect(one).toEqual(savedOne); expect(two).toEqual(savedTwo);
  });

  it.each(['Outlines', 'StructTreeRoot', 'OCProperties', 'Names', 'AF', 'OpenAction'])('rejects unsupported catalog %s atomically', async name => {
    const source = await fixture('Safe'), doc = await PDFDocument.load(source); doc.catalog.set(PDFName.of(name), doc.context.obj({}));
    const input = await doc.save(), copy = input.slice();
    await expect(mergePdfForms([source, input])).rejects.toMatchObject({ code: 'unsupported-structure' }); expect(input).toEqual(copy);
  });

  it.each(['XFA', 'JS', 'AA', 'SigFlags'])('rejects active or unsupported AcroForm %s', async name => {
    const doc = await PDFDocument.load(await fixture('Safe')); doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of(name), PDFString.of('unsafe'));
    await expect(mergePdfForms([await doc.save({ updateFieldAppearances: false })])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });

  it('refuses dangling references and orphan widgets rather than silently dropping them', async () => {
    const doc = await PDFDocument.load(await fixture('Safe'));
    doc.getPage(0).node.set(PDFName.of('Resources'), PDFRef.of(999999));
    await expect(mergePdfForms([await doc.save({ updateFieldAppearances: false })])).rejects.toThrow();
    const orphan = await PDFDocument.load(await fixture('Safe'));
    orphan.catalog.delete(PDFName.of('AcroForm'));
    await expect(mergePdfForms([await orphan.save({ updateFieldAppearances: false })])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
});
