// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { editDocumentProperties } from './document-properties';
import { editAttachments, listAttachments } from './attachments';

it('PDF.js independently reads content, metadata and attachment after edits', async () => {
  const doc = await PDFDocument.create(); doc.addPage([300, 400]).drawText('Structure remains', { x: 20, y: 350 });
  const original = await doc.save();
  const props = await editDocumentProperties(original, { title: 'Edited title', xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>' });
  const withFirst = await editAttachments(props, { kind: 'import', filename: 'note.txt', bytes: new Uint8Array([72, 105]), mimeType: 'text/plain' });
  const output = await editAttachments(withFirst, { kind: 'import', filename: 'a.txt', bytes: new Uint8Array([1]), mimeType: 'text/plain' });
  const pdf = await getDocument({ data: output.slice() }).promise;
  try {
    expect((await (await pdf.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')).toContain('Structure remains');
    expect((await pdf.getMetadata()).info).toMatchObject({ Title: 'Edited title' });
    expect(Array.from((await pdf.getAttachments())?.['note.txt']?.content ?? [])).toEqual([72, 105]);
    expect(Array.from((await pdf.getAttachments())?.['a.txt']?.content ?? [])).toEqual([1]);
  } finally { await pdf.destroy(); }
  expect((await listAttachments(output)).map(file => file.filename)).toEqual(['a.txt', 'note.txt']);
});
