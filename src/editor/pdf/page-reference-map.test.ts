import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { remapPageReferences } from './page-reference-map';
import { readNavigation } from './navigation';

const key = PDFName.of;
describe('conservative page-reference remapping', () => {
  it.each(['page', 'name-tree', 'destination', 'action'])('refuses unknown %s fields rather than discarding or misdirecting them', async location => {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    const destination = doc.context.obj({ D: [page.ref, 'Fit'] });
    const tree = doc.context.obj({ Names: [PDFString.of('target'), destination] });
    doc.catalog.set(key('Names'), doc.context.obj({ Dests: tree }));
    if (location === 'page') page.node.set(key('FuturePageTarget'), page.ref);
    if (location === 'name-tree') tree.set(key('FutureData'), PDFString.of('Keep'));
    if (location === 'destination') destination.set(key('FutureData'), PDFString.of('Keep'));
    if (location === 'action') page.node.set(key('Annots'), doc.context.obj([doc.context.register(doc.context.obj({
      Subtype: 'Link', Rect: [0, 0, 20, 20], A: { S: 'GoTo', D: [page.ref, 'Fit'], FutureData: PDFString.of('Keep') },
    }))]));
    await expect(remapPageReferences(await doc.save(), [{ oldIndex: 0, newIndices: [0, 1] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });

  it('refuses dangling and cyclic destination references without modifying the source', async () => {
    for (const cyclic of [false, true]) {
      const doc = await PDFDocument.create(); doc.addPage();
      const destination = doc.context.obj({}); const ref = doc.context.register(destination);
      destination.set(key('D'), cyclic ? ref : PDFRef.of(99999));
      doc.catalog.set(key('Dests'), doc.context.obj({ target: destination }));
      const bytes = await doc.save(); const original = bytes.slice();
      await expect(remapPageReferences(bytes, [{ oldIndex: 0, newIndices: [0] }])).rejects.toMatchObject({ code: 'invalid-navigation' });
      expect(bytes).toEqual(original);
    }
  });

  it('refuses cyclic named aliases', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    doc.catalog.set(key('Dests'), doc.context.obj({ a: PDFString.of('b'), b: PDFString.of('a') }));
    await expect(readNavigation(await doc.save())).rejects.toMatchObject({ code: 'invalid-navigation' });
  });
});
