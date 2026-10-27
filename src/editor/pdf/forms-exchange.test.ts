// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyFormChanges, exportFormValuesFdf, exportFormValuesXfdf, importFormValuesFdf, importFormValuesXfdf, readFormFields } from './forms';

const fontBytes = new Uint8Array(await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'));
const encoder = new TextEncoder();

async function formFixture() {
  const doc = await PDFDocument.create(); const page = doc.addPage([400, 500]); const form = doc.getForm();
  const text = form.createTextField('jméno'); text.addToPage(page, { x: 20, y: 400, width: 180, height: 24 });
  const check = form.createCheckBox('souhlas'); check.addToPage(page, { x: 20, y: 350, width: 20, height: 20 });
  const radio = form.createRadioGroup('volba'); radio.addOptionToPage('Ano', page, { x: 20, y: 300, width: 20, height: 20 }); radio.addOptionToPage('Ne', page, { x: 50, y: 300, width: 20, height: 20 });
  const choice = form.createDropdown('výběr'); choice.addOptions(['První', 'Druhý']); choice.addToPage(page, { x: 20, y: 250, width: 120, height: 24 });
  const empty = form.createTextField('prázdné'); empty.addToPage(page, { x: 20, y: 200, width: 120, height: 24 });
  return doc.save();
}

describe('FDF/XFDF form value exchange', () => {
  it.each(['FDF', 'XFDF'] as const)('roundtrips Unicode names and all common value kinds through %s', async format => {
    const original = await formFixture(); const fields = await readFormFields(original);
    const id = (name: string) => fields.find(field => field.name === name)!.id;
    const filled = await applyFormChanges(original, [
      { kind: 'set-value', id: id('jméno'), value: 'Příliš žluťoučký kůň' },
      { kind: 'set-value', id: id('souhlas'), value: true },
      { kind: 'set-value', id: id('volba'), value: 'Ano' },
      { kind: 'set-value', id: id('výběr'), value: ['Druhý'] },
      { kind: 'set-value', id: id('prázdné'), value: '' },
    ], { fontBytes });
    const saved = await readFormFields(filled);
    const exchange = format === 'FDF' ? exportFormValuesFdf(saved) : exportFormValuesXfdf(saved);
    const changes = format === 'FDF' ? await importFormValuesFdf(encoder.encode(exchange), fields) : importFormValuesXfdf(exchange, fields);
    const output = await applyFormChanges(original, changes, { fontBytes });
    expect((await readFormFields(output)).map(field => field.value)).toEqual(saved.map(field => field.value));
    const independent = await getDocument({ data: output.slice() }).promise;
    try {
      const values = await independent.getFieldObjects() as Record<string, Array<{ value?: string }>>;
      expect(values['jméno'].some(widget => widget.value === 'Příliš žluťoučký kůň')).toBe(true);
      expect(values['souhlas'].some(widget => !!widget.value && widget.value !== 'Off')).toBe(true);
      expect(values['výběr'].some(widget => widget.value === 'Druhý')).toBe(true);
    } finally { await independent.destroy(); }
  });

  it('rejects oversized and malformed exchange data without touching source bytes', async () => {
    const original = await formFixture(), copy = original.slice(), fields = await readFormFields(original);
    expect(() => importFormValuesXfdf('<!DOCTYPE xfdf><xfdf/>', fields)).toThrow();
    expect(() => importFormValuesXfdf('<xfdf><fields><field name="jméno"><value>A</field></fields></xfdf>', fields)).toThrow();
    expect(() => importFormValuesXfdf('<xfdf><fields><field name="unknown"><value>A</value></field></fields></xfdf>', fields)).toThrow();
    expect(() => importFormValuesXfdf('x'.repeat(1024 * 1024 + 1), fields)).toThrow();
    await expect(importFormValuesFdf(encoder.encode('%FDF-1.2\nnot a PDF'), fields)).rejects.toThrow();
    await expect(importFormValuesFdf(new Uint8Array(1024 * 1024 + 1), fields)).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(applyFormChanges(original, [{ kind: 'set-value', id: fields[0].id, value: 'Changed' }], { fontBytes, signal: abort.signal })).rejects.toThrow();
    expect(original).toEqual(copy);
  });
});
