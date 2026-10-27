import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';

const fontPath = 'public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf';
export const ORIGINAL = 'Invoice number 2026';
export const REPLACEMENT = 'Invoice number 2027';
export const UNCHANGED = 'Keep this paragraph unchanged.';
export const CZECH = 'Příliš žluťoučký kůň úpěl ďábelské ódy.';

// Synthetic documents are generated here, contain no personal data, and inherit
// this project's AGPL license. The embedded Liberation font uses SIL OFL 1.1.
export async function buildEditorCorpus() {
  const cases = [];
  const specs = [];
  for (const font of [StandardFonts.Helvetica, StandardFonts.HelveticaBold,
    StandardFonts.TimesRoman, StandardFonts.Courier, StandardFonts.TimesRomanItalic]) {
    for (const rotation of [0, 90, 180, 270]) {
      specs.push({ id: `${font}-${rotation}`, font, rotation });
    }
  }
  for (const subset of [false, true]) {
    specs.push({ id: `czech-${subset ? 'subset' : 'full'}`, embedded: true, subset, czech: true });
    specs.push({ id: `new-glyph-${subset ? 'subset' : 'full'}`, embedded: true, subset, newGlyph: true });
  }
  specs.push(
    { id: 'colored-text', color: rgb(0.1, 0.2, 0.8) },
    { id: 'colored-background', background: true },
    { id: 'cropbox-offset', crop: true },
    { id: 'two-columns', columns: true },
    { id: 'text-field', field: 'text' },
    { id: 'checkbox-field', field: 'check' },
    { id: 'radio-field', field: 'radio' },
    { id: 'dropdown-field', field: 'dropdown' },
    { id: 'external-link', link: true },
    { id: 'metadata', metadata: true },
    { id: 'attachment', attachment: true },
    { id: 'image-background', image: true },
    { id: 'two-pages', pages: 2 },
    { id: 'hundred-pages', pages: 100 },
    { id: 'image-only-scan', scan: true },
    { id: 'scan-with-text-layer', scan: true, textLayer: true },
    { id: 'shared-form-xobject', shared: true, pages: 2 },
    { id: 'long-replacement', long: true },
  );
  for (const spec of specs) {
    const doc = await PDFDocument.create();
    doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
    doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
    doc.setProducer('PDF Editor synthetic validation corpus');
    doc.registerFontkit(fontkit);
    const font = spec.embedded
      ? await doc.embedFont(readFileSync(fontPath), { subset: spec.subset })
      : await doc.embedFont(spec.font || StandardFonts.Helvetica);
    const original = spec.czech ? CZECH : ORIGINAL;
    const replacement = spec.czech ? CZECH.replace('kůň', 'pes')
      : spec.newGlyph ? 'Příjem číslo 2027' : spec.long ? `${REPLACEMENT} - additional detail` : REPLACEMENT;
    const pages = Array.from({ length: spec.pages || 1 }, () => doc.addPage([612, 792]));
    const page = pages[0];
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    if (spec.crop) page.setCropBox(30, 40, 540, 700);
    if (spec.background) page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.85, 0.92, 0.9) });
    if (spec.scan || spec.image) {
      const canvas = createCanvas(612, 792);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 612, 792);
      context.fillStyle = '#14213d'; context.font = '20px sans-serif';
      context.fillText(spec.scan ? 'Scanned document - OCR required' : 'Background image', 65, 300);
      const image = await doc.embedPng(canvas.toBuffer('image/png'));
      page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
    }
    if (!spec.scan || spec.textLayer) {
      page.drawText(original, { x: 72, y: 700, size: 12, font, color: spec.color || rgb(0, 0, 0), opacity: spec.textLayer ? 0 : 1 });
      page.drawText(UNCHANGED, { x: 72, y: 450, size: 12, font });
    }
    for (let i = 1; i < pages.length; i++) pages[i].drawText(`Untouched page ${i + 1}`, { x: 72, y: 700, font, size: 12 });
    if (spec.columns) page.drawText('Right column must survive.', { x: 350, y: 700, size: 12, font });
    if (spec.field) {
      const form = doc.getForm();
      if (spec.field === 'text') { const field = form.createTextField('customer'); field.setText('Alice'); field.addToPage(page, { x: 72, y: 250, width: 200, height: 24 }); }
      if (spec.field === 'check') { const field = form.createCheckBox('approved'); field.addToPage(page, { x: 72, y: 250, width: 20, height: 20 }); field.check(); }
      if (spec.field === 'radio') { const field = form.createRadioGroup('choice'); field.addOptionToPage('A', page, { x: 72, y: 250, width: 20, height: 20 }); field.addOptionToPage('B', page, { x: 110, y: 250, width: 20, height: 20 }); field.select('B'); }
      if (spec.field === 'dropdown') { const field = form.createDropdown('country'); field.addOptions(['CZ', 'SK']); field.select('CZ'); field.addToPage(page, { x: 72, y: 250, width: 100, height: 24 }); }
    }
    if (spec.link) {
      const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 350, 250, 375], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') } }));
      page.node.set(PDFName.of('Annots'), doc.context.obj([link]));
    }
    if (spec.metadata) { doc.setTitle('Keep title'); doc.setAuthor('Synthetic author'); }
    if (spec.attachment) await doc.attach(new TextEncoder().encode('Keep attachment'), 'note.txt', { mimeType: 'text/plain' });
    if (spec.shared) {
      const source = await PDFDocument.create();
      const sourcePage = source.addPage([150, 40]);
      sourcePage.drawText('Shared logo', { x: 5, y: 15, size: 12 });
      const [shared] = await doc.embedPdf(await source.save());
      for (const p of pages) p.drawPage(shared, { x: 72, y: 300 });
    }
    // PDF user-space bounds of the only editable area, including reflow room.
    // The right column and every control object remain outside this rectangle.
    const editBounds = [60, 660, spec.czech ? 410 : spec.long ? 450 : 320, 730];
    cases.push({ id: spec.id, bytes: await doc.save({ useObjectStreams: false }), original, replacement, spec, editBounds });
  }
  return cases;
}
