import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { editNavigation, readNavigation } from './navigation';
import { remapPageReferences } from './page-reference-map';

async function fixture() {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([300, 400]), doc.addPage([500, 600]), doc.addPage([700, 800])];
  doc.setTitle('Keep metadata');
  const root = doc.context.obj({ Type: 'Outlines', Count: 2 }); const rootRef = doc.context.register(root);
  const first = doc.context.obj({ Title: PDFString.of('Chapter'), Parent: rootRef, Dest: [pages[1].ref, 'Fit'], Count: 1 }); const firstRef = doc.context.register(first);
  const child = doc.context.obj({ Title: PDFString.of('Section'), Parent: firstRef, Dest: PDFString.of('third') }); const childRef = doc.context.register(child);
  root.set(PDFName.of('First'), firstRef); root.set(PDFName.of('Last'), firstRef);
  first.set(PDFName.of('First'), childRef); first.set(PDFName.of('Last'), childRef);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: { Names: [PDFString.of('third'), [pages[2].ref, 'Fit']] } }));
  const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 50, 40], P: pages[0].ref, A: { S: 'GoTo', D: PDFString.of('third') } }));
  const uri = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 10, 90, 40], P: pages[0].ref, A: { S: 'URI', URI: PDFString.of('https://example.com') } }));
  pages[0].node.set(PDFName.of('Annots'), doc.context.obj([link, uri]));
  return { doc, first, firstRef, childRef, bytes: await doc.save() };
}

describe('PDF navigation', () => {
  it('reads bookmark hierarchy, named destination and internal/external links without opening them', async () => {
    const { bytes } = await fixture(); const nav = await readNavigation(bytes);
    expect(nav.bookmarks[0]).toMatchObject({ title: 'Chapter', destination: { pageIndex: 1, view: 'Fit' } });
    expect(nav.bookmarks[0].children[0]).toMatchObject({ title: 'Section', destination: { pageIndex: 2 } });
    expect(nav.destinations).toEqual([{ name: 'third', destination: { pageIndex: 2, view: 'Fit' } }]);
    expect(nav.links).toHaveLength(2); expect(nav.links[0].destination?.pageIndex).toBe(2); expect(nav.links[1].uri).toBe('https://example.com');
  });
  it('renames, appends a child and removes a bookmark subtree', async () => {
    const { bytes } = await fixture(); const original = bytes.slice();
    const first = (await readNavigation(bytes)).bookmarks[0];
    let result = await editNavigation(bytes, { kind: 'rename-bookmark', id: first.id, title: 'Česká kapitola' });
    result = await editNavigation(result, { kind: 'add-bookmark', parentId: first.id, title: 'New child', pageIndex: 0 });
    const nav = await readNavigation(result);
    expect(nav.bookmarks[0].title).toBe('Česká kapitola'); expect(nav.bookmarks[0].children).toHaveLength(2);
    result = await editNavigation(result, { kind: 'remove-bookmark', id: first.id });
    expect((await readNavigation(result)).bookmarks).toEqual([]);
    expect((await PDFDocument.load(result)).getTitle()).toBe('Keep metadata'); expect(bytes).toEqual(original);
  });
  it('retargets a link and removes it without changing another link', async () => {
    const { bytes } = await fixture(); const link = (await readNavigation(bytes)).links[0];
    let result = await editNavigation(bytes, { kind: 'set-link-destination', id: link.id, pageIndex: 1 });
    expect((await readNavigation(result)).links[0].destination?.pageIndex).toBe(1);
    result = await editNavigation(result, { kind: 'remove-link', id: link.id });
    expect((await readNavigation(result)).links.map(link => link.uri)).toEqual(['https://example.com']);
  });
  it('rejects cyclic outline and name trees rather than looping', async () => {
    const { doc, first, firstRef } = await fixture(); first.set(PDFName.of('Next'), firstRef);
    await expect(readNavigation(await doc.save())).rejects.toMatchObject({ code: 'invalid-navigation' });
    const simple = await PDFDocument.create(); simple.addPage(); const tree = simple.context.obj({}); const ref = simple.context.register(tree);
    tree.set(PDFName.of('Kids'), simple.context.obj([ref])); simple.catalog.set(PDFName.of('Names'), simple.context.obj({ Dests: ref }));
    await expect(readNavigation(await simple.save())).rejects.toMatchObject({ code: 'invalid-navigation' });
  });
  it('rejects invalid changes and active actions', async () => {
    const { bytes, doc, first } = await fixture();
    await expect(editNavigation(bytes, { kind: 'add-bookmark', title: 'Bad', pageIndex: 99 })).rejects.toMatchObject({ code: 'invalid-change' });
    first.delete(PDFName.of('Dest')); first.set(PDFName.of('A'), doc.context.obj({ S: 'JavaScript', JS: PDFString.of('alert(1)') }));
    await expect(readNavigation(await doc.save())).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
  it.each(['Parent', 'Last', 'Prev'])('rejects a malformed outline %s reference before rewriting the tree', async field => {
    const { doc, first, firstRef, childRef } = await fixture();
    first.set(PDFName.of(field), field === 'Parent' ? childRef : firstRef);
    const bytes = await doc.save();
    await expect(editNavigation(bytes, { kind: 'add-bookmark', title: 'Added', pageIndex: 0 })).rejects.toMatchObject({ code: 'invalid-navigation' });
  });
});

describe('navigation-preserving page mapping', () => {
  it('remaps links/bookmarks/names when reordering and deleting pages', async () => {
    const { bytes } = await fixture(); const original = bytes.slice();
    const result = await remapPageReferences(bytes, [{ oldIndex: 2, newIndices: [0] }, { oldIndex: 0, newIndices: [1] }]);
    const pdf = await PDFDocument.load(result); expect(pdf.getPages().map(page => page.getWidth())).toEqual([700, 300]); expect(pdf.getTitle()).toBe('Keep metadata');
    const nav = await readNavigation(result);
    expect(nav.bookmarks[0].destination).toBeNull(); expect(nav.bookmarks[0].children[0].destination?.pageIndex).toBe(0);
    expect(nav.links[0]).toMatchObject({ pageIndex: 1, destination: { pageIndex: 0 } });
    expect(nav.destinations[0].destination?.pageIndex).toBe(0); expect(bytes).toEqual(original);
  });
  it('drops links and named destinations whose target was deleted, but keeps bookmark hierarchy', async () => {
    const { bytes } = await fixture();
    const result = await remapPageReferences(bytes, [{ oldIndex: 0, newIndices: [0] }, { oldIndex: 1, newIndices: [1] }]);
    const nav = await readNavigation(result);
    expect(nav.links).toHaveLength(1); expect(nav.links[0].uri).toBe('https://example.com');
    expect(nav.destinations).toEqual([]); expect(nav.bookmarks[0].children[0].destination).toBeNull();
  });
  it('duplicates links with separate annotation identities and first-target policy', async () => {
    const { bytes } = await fixture();
    const result = await remapPageReferences(bytes, [{ oldIndex: 0, newIndices: [0, 1] }, { oldIndex: 2, newIndices: [2, 3] }]);
    const nav = await readNavigation(result); expect(nav.links).toHaveLength(4);
    expect(new Set(nav.links.map(link => link.id)).size).toBe(4);
    expect(nav.links.filter(link => link.destination).map(link => link.destination?.pageIndex)).toEqual([2, 2]);
  });
  it('refuses forms/tags and invalid mapping positions', async () => {
    const { doc, bytes } = await fixture();
    await expect(remapPageReferences(bytes, [{ oldIndex: 0, newIndices: [1] }])).rejects.toMatchObject({ code: 'invalid-change' });
    await expect(remapPageReferences(bytes, [{ oldIndex: 0, newIndices: [0] }, { oldIndex: 1, newIndices: [0] }])).rejects.toMatchObject({ code: 'invalid-change' });
    doc.getForm().createTextField('test');
    await expect(remapPageReferences(await doc.save(), [{ oldIndex: 0, newIndices: [0] }])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
});
