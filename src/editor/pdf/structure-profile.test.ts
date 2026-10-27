import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { inspectPdfStructures } from './structure-profile';

describe('PDF structure inspection', () => {
  it('reports simple absence only after successful inspection', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    expect(await inspectPdfStructures(await doc.save())).toMatchObject({ pageCount: 1, forms: 'absent', annotations: 'absent', outlines: 'absent', destinations: 'absent', tags: 'absent', encryption: 'absent', signatures: 'absent', optionalContent: 'absent', issues: [] });
  });
  it('does not turn a parse failure into absent structures', async () => {
    expect(await inspectPdfStructures(new Uint8Array([1, 2]))).toMatchObject({ pageCount: null, forms: 'unknown', tags: 'unknown', encryption: 'unknown', issues: ['inspection-failed'] });
  });
  it('reports malformed structures explicitly and recognizes known present families', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj(123));
    doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({ Type: 'StructTreeRoot' }));
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: 123, EmbeddedFiles: {} }));
    doc.catalog.set(PDFName.of('FutureFeature'), doc.context.obj({}));
    page.node.set(PDFName.of('Annots'), doc.context.obj(123));
    expect(await inspectPdfStructures(await doc.save())).toMatchObject({ forms: 'unknown', tags: 'present', annotations: 'unknown', destinations: 'unknown', attachments: 'present', unknownCatalogKeys: ['FutureFeature'] });
  });
  it('finds signatures in indirect objects without running document actions', async () => {
    const doc = await PDFDocument.create(); doc.addPage(); doc.context.register(doc.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3] }));
    expect((await inspectPdfStructures(await doc.save())).signatures).toBe('present');
  });
  it('does not report forms or attachments absent when annotations cannot be inspected', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    page.node.set(PDFName.of('Annots'), doc.context.obj(123));
    expect(await inspectPdfStructures(await doc.save())).toMatchObject({ annotations: 'unknown', forms: 'unknown', attachments: 'unknown' });
  });
  it('recognizes page-associated files and orphaned tagging hints', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    page.node.set(PDFName.of('AF'), doc.context.obj([]));
    page.node.set(PDFName.of('StructParents'), doc.context.obj(0));
    expect(await inspectPdfStructures(await doc.save())).toMatchObject({ attachments: 'present', tags: 'unknown' });
  });
});
