import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { editDocumentProperties, readDocumentProperties } from './document-properties';

describe('PDF document properties', () => {
  it('edits Info and XMP while preserving page content and catalog', async () => {
    const doc = await PDFDocument.create(); doc.addPage().drawText('Keep content');
    const original = await doc.save();
    const edited = await editDocumentProperties(original, { title: 'Český title', author: 'Author', subject: 'Subject', keywords: 'one, two', xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>' });
    const properties = await readDocumentProperties(edited);
    expect(properties.title).toBe('Český title'); expect(properties.author).toBe('Author');
    expect(properties.xmp).toContain('x:xmpmeta');
    const result = await PDFDocument.load(edited, { updateMetadata: false });
    expect(result.getPageCount()).toBe(1); expect(result.catalog.has(PDFName.of('Metadata'))).toBe(true);
  });
  it('rejects active XMP and leaves unsupported encrypted or signed input untouched', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const original = await doc.save();
    await expect(editDocumentProperties(original, { xmp: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///x">]><x>&e;</x>' })).rejects.toThrow();
    doc.catalog.set(PDFName.of('Perms'), doc.context.obj({}));
    await expect(editDocumentProperties(await doc.save(), { title: 'Changed' })).rejects.toThrow();
  });
  it('accepts standard XMP packet instructions without requiring removal', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta><?xpacket end="w"?>';
    const withPacket = await editDocumentProperties(await doc.save(), { xmp });
    const titled = await editDocumentProperties(withPacket, { title: 'Retained' });
    expect((await readDocumentProperties(titled)).xmp).toBe(xmp);
  });
});
