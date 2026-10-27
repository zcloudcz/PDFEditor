// @vitest-environment node
import { expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { editNavigation, readNavigation } from './navigation';
import { remapPageReferences } from './page-reference-map';
import { inspect, unchangedPixelsEqual } from '../../tests/helpers/editor-pdf-inspect.js';

it('PDF.js independently resolves remapped outlines, named destinations and links', async () => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([300, 400]); const second = doc.addPage([500, 600]);
  first.drawText('First page stays intact', { x: 20, y: 350 });
  second.drawRectangle({ x: 25, y: 40, width: 100, height: 90, color: rgb(0.2, 0.6, 0.4) });
  second.drawText('Second page moves first', { x: 20, y: 550 });
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: { Names: [PDFString.of('target'), [second.ref, 'XYZ', 10, 20, null]] } }));
  first.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 30, 30], Dest: PDFString.of('target') }))]));
  const bookmarked = await editNavigation(await doc.save(), { kind: 'add-bookmark', title: 'Česká kapitola', pageIndex: 1 });
  const output = await remapPageReferences(bookmarked, [{ oldIndex: 1, newIndices: [0] }, { oldIndex: 0, newIndices: [1] }]);
  const parsed = await getDocument({ data: output.slice() }).promise;
  try {
    const outline = await parsed.getOutline();
    expect(outline[0].title).toBe('Česká kapitola');
    expect(await parsed.getPageIndex(outline[0].dest[0])).toBe(0);
    const named = await parsed.getDestination('target');
    expect(await parsed.getPageIndex(named![0])).toBe(0);
    expect(named!.slice(2)).toEqual([10, 20, null]);
    const page = await parsed.getPage(2); const links = await page.getAnnotations();
    expect(links).toHaveLength(1);
    expect(await parsed.getPageIndex(links[0].dest[0])).toBe(0);
    expect(page.view).toEqual([0, 0, 300, 400]);
  } finally { await parsed.destroy(); }
  const before = await inspect(bookmarked, true, 2, undefined), after = await inspect(output, true, 1, undefined);
  expect(after.text).toContain('Second page moves first');
  expect(unchangedPixelsEqual(before.pixels, after.pixels)).toBe(true);
});

it('rejects malformed destination operands instead of reporting them as supported', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  doc.catalog.set(PDFName.of('Dests'), doc.context.obj({ invalid: [page.ref, 'FitR', 0] }));
  await expect(readNavigation(await doc.save())).rejects.toMatchObject({ code: 'invalid-navigation' });
});

it('navigation edits preserve rendered content, forms, attachments, XMP, tags, layers and unknown catalog data', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage([300, 400]);
  page.drawRectangle({ x: 30, y: 40, width: 80, height: 90, color: rgb(0.1, 0.3, 0.7) });
  page.drawText('Keep document text', { x: 30, y: 350 });
  const field = doc.getForm().createTextField('retained-field'); field.setText('Retained value'); field.addToPage(page, { x: 30, y: 220, width: 160, height: 30 });
  await doc.attach(new Uint8Array([1, 2, 3, 4]), 'fixture.bin', { mimeType: 'application/octet-stream' });
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Retained XMP</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
  const tags = doc.context.obj({ Type: 'StructTreeRoot', K: [] });
  doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(tags));
  const layer = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Retained layer') }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [layer], D: { Order: [layer], ON: [layer] } }));
  doc.catalog.set(PDFName.of('FutureData'), doc.context.obj({ Keep: PDFString.of('Unrelated structure') }));
  const original = await doc.save();
  const withBookmark = await editNavigation(original, { kind: 'add-bookmark', title: 'Chapter', pageIndex: 0 });
  const bookmark = (await readNavigation(withBookmark)).bookmarks[0];
  const renamed = await editNavigation(withBookmark, { kind: 'rename-bookmark', id: bookmark.id, title: 'Renamed' });
  const output = await editNavigation(renamed, { kind: 'remove-bookmark', id: bookmark.id });
  const before = await inspect(original, true, 1, undefined), after = await inspect(output, true, 1, undefined);
  expect(after.text).toContain('Keep document text');
  expect(unchangedPixelsEqual(before.pixels, after.pixels)).toBe(true);
  expect(after.fields).toEqual(before.fields);
  expect(after.attachments['fixture.bin'].content).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(after.metadata.metadata.get('dc:title')).toBe('Retained XMP');
  const parsed = await PDFDocument.load(output);
  expect(parsed.getForm().getTextField('retained-field').getText()).toBe('Retained value');
  expect(parsed.catalog.lookup(PDFName.of('FutureData'), PDFDict).lookup(PDFName.of('Keep'), PDFString).decodeText()).toBe('Unrelated structure');
  expect(parsed.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).toString()).toBe(tags.toString());
  expect(parsed.catalog.lookup(PDFName.of('OCProperties'), PDFDict).toString()).toBe(doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).toString());
});
