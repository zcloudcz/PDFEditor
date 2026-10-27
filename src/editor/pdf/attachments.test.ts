import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { editAttachments, exportAttachment, listAttachments } from './attachments';

describe('PDF attachments', () => {
  it('captures caller-owned PDF and attachment bytes before yielding', async () => {
    const doc = await PDFDocument.create(); doc.addPage(); const bytes = await doc.save(), original = bytes.slice(), content = new Uint8Array([7, 8]);
    const pending = editAttachments(bytes, { kind: 'import', filename: 'captured.bin', bytes: content });
    content.fill(0); bytes.fill(0);
    const result = await pending, entries = await listAttachments(result);
    expect((await exportAttachment(result, entries[0].id)).bytes).toEqual(new Uint8Array([7, 8]));
    expect((await PDFDocument.load(original)).getPageCount()).toBe(1);
  });
  it('imports, exports, removes without changing page content', async () => {
    const doc = await PDFDocument.create(); doc.addPage().drawText('Keep');
    const original = await doc.save();
    const added = await editAttachments(original, { kind: 'import', filename: 'readme.txt', bytes: new TextEncoder().encode('hello'), mimeType: 'text/plain' });
    const list = await listAttachments(added); expect(list).toHaveLength(1);
    const exported = await exportAttachment(added, list[0].id); expect(new TextDecoder().decode(exported.bytes)).toBe('hello');
    const removed = await editAttachments(added, { kind: 'remove', id: list[0].id });
    expect(await listAttachments(removed)).toEqual([]);
    expect((await PDFDocument.load(removed)).getPageCount()).toBe(1);
  });
  it('rejects path traversal, duplicates and oversized import', async () => {
    const doc = await PDFDocument.create(); doc.addPage(); const bytes = await doc.save();
    await expect(editAttachments(bytes, { kind: 'import', filename: '../evil', bytes: new Uint8Array([1]) })).rejects.toThrow();
    await expect(editAttachments(bytes, { kind: 'import', filename: 'large', bytes: new Uint8Array(21 * 1024 * 1024) })).rejects.toThrow();
    const added = await editAttachments(bytes, { kind: 'import', filename: 'file', bytes: new Uint8Array([1]) });
    await expect(editAttachments(added, { kind: 'import', filename: 'file', bytes: new Uint8Array([2]) })).rejects.toThrow();
  });
  it('rejects cyclic and malformed attachment trees without rewriting them', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const cycle = doc.context.obj({}); const ref = doc.context.register(cycle); cycle.set(PDFName.of('Kids'), doc.context.obj([ref]));
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ EmbeddedFiles: ref }));
    const input = await doc.save();
    await expect(listAttachments(input)).rejects.toMatchObject({ code: 'unsupported-structure' });
    await expect(editAttachments(input, { kind: 'import', filename: 'safe.txt', bytes: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
  it('sorts imported names by PDF string bytes', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const first = await editAttachments(await doc.save(), { kind: 'import', filename: 'z.txt', bytes: new Uint8Array([1]) });
    const second = await editAttachments(first, { kind: 'import', filename: 'a.txt', bytes: new Uint8Array([2]) });
    expect((await listAttachments(second)).map(file => file.filename)).toEqual(['a.txt', 'z.txt']);
    const parsed = await PDFDocument.load(second);
    const names = parsed.catalog.lookup(PDFName.of('Names')) as import('pdf-lib').PDFDict;
    const files = names.lookup(PDFName.of('EmbeddedFiles')) as import('pdf-lib').PDFDict;
    const pairs = files.lookup(PDFName.of('Names')) as import('pdf-lib').PDFArray;
    expect((pairs.get(0) as import('pdf-lib').PDFHexString).decodeText()).toBe('a.txt');
    expect((pairs.get(2) as import('pdf-lib').PDFHexString).decodeText()).toBe('z.txt');
  });
});
