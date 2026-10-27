import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { read, utils } from 'xlsx';
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { pathToFileURL } = await import('node:url'); const { resolve } = await import('node:path');
  return { default: pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});
import { convertDocument } from './office-export';
import { extractTables } from './table-extraction';
import { importOffice } from './office-import';
import { readFile } from 'node:fs/promises';
import { readConversionPages } from './conversion-profile';
const signal = () => new AbortController().signal;
async function fixture() {
  const doc = await PDFDocument.create(), page = doc.addPage([600, 800]), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [y, left, right] of [[700,'Item','Count'],[680,'Apple','12'],[660,'Pear','9']] as const) {
    page.drawText(left,{x:50,y,size:12,font}); page.drawText(right,{x:300,y,size:12,font});
  }
  return doc.save();
}
describe('bounded browser Office conversion', () => {
  it('scales UserUnit 2 text widths into physical points and PPTX text boxes', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([300, 400]), font = await doc.embedFont(StandardFonts.Helvetica);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)); page.drawText('Hello world', { x: 30, y: 300, size: 12, font });
    const bytes = await doc.save(), pdfjs = await import('pdfjs-dist'), reader = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    try {
      const source = await reader.getPage(1), viewport = source.getViewport({ scale: 1 });
      const item = (await source.getTextContent()).items.find(item => 'str' in item && item.str === 'Hello world')!;
      expect(viewport.width).toBe(600); expect(viewport.height).toBe(800);
      expect('width' in item && item.width).toBeCloseTo(59.34);
      const [converted] = await readConversionPages(bytes, undefined, 'editable', signal());
      expect(converted.text[0]).toMatchObject({ x: 60, y: 176, height: 24 });
      expect(converted.text[0].width).toBeCloseTo(118.68);
      const fontBytes = await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf');
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(fontBytes).buffer })));
      try {
        const result = await convertDocument(new Blob([new Uint8Array(bytes).buffer]), { format: 'pptx', mode: 'editable' }, signal());
        const zip = await JSZip.loadAsync(await result.files[0].blob.arrayBuffer());
        const xml = new DOMParser().parseFromString(await zip.file('ppt/slides/slide1.xml')!.async('string'), 'application/xml');
        const transform = xml.getElementsByTagName('p:sp')[0].getElementsByTagName('a:xfrm')[0];
        expect(Number(transform.getElementsByTagName('a:ext')[0].getAttribute('cx'))).toBe(Math.round(120.68 * 12700));
      } finally { vi.unstubAllGlobals(); }
    } finally { await reader.destroy(); }
  });
  it('detects a candidate table and requires explicit corrections before export', async () => {
    const bytes = await fixture(), tables = await extractTables(bytes,[0],signal());
    expect(tables).toHaveLength(1); expect(tables[0].rows).toEqual([['Apple','12'],['Pear','9']]);
    const result = await convertDocument(new Blob([new Uint8Array(bytes).buffer]),{format:'xlsx',pages:[0],tables},signal());
    const workbook = read(new Uint8Array(await result.files[0].blob.arrayBuffer()));
    expect(utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1})).toEqual([['Item','Count'],['Apple','12'],['Pear','9']]);
    await expect(convertDocument(new Blob([new Uint8Array(bytes).buffer]),{format:'xlsx'},signal())).rejects.toThrow('tables-require-review');
  });
  it('writes actual editable DOCX text with explicit fidelity warnings', async () => {
    const result = await convertDocument(new Blob([new Uint8Array(await fixture()).buffer]),{format:'docx',mode:'editable'},signal());
    const zip = await JSZip.loadAsync(await result.files[0].blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Apple'); expect(xml).toContain('w:sectPr'); expect(xml).toContain('w:cols');
    expect(new DOMParser().parseFromString(xml,'application/xml').querySelector('parsererror')).toBeNull();
    expect(result.report.editable).toBeGreaterThan(0); expect(result.report.limitations).toContain('Font substitution: Liberation Sans; source fonts are not embedded.');
  });
  it('does not pretend to convert Office inputs without an approved local engine', async () => {
    await expect(importOffice(new Blob(['anything']), 'docx',signal())).rejects.toThrow('local-office-engine-unavailable');
  });
  it('exports real PPTX block text with valid internal relationships and refuses mixed slides', async () => {
    const font=await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(font).buffer})));
    try {
      const result=await convertDocument(new Blob([new Uint8Array(await fixture()).buffer]),{format:'pptx',mode:'editable'},signal());
      if(process.env.T17_WRITE_FIXTURE==='1'){
        const {mkdir,writeFile}=await import('node:fs/promises');await mkdir('src/editor/conversion/fixtures',{recursive:true});
        await writeFile('src/editor/conversion/fixtures/born-digital.pptx',new Uint8Array(await result.files[0].blob.arrayBuffer()));
        await writeFile('src/editor/conversion/fixtures/born-digital.pdf',await fixture());
      }
      const zip=await JSZip.loadAsync(await result.files[0].blob.arrayBuffer());
      expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('Apple');
      for(const entry of Object.values(zip.files).filter(e=>e.name.endsWith('.xml')||e.name.endsWith('.rels'))){
        const text=await entry.async('string');expect(new DOMParser().parseFromString(text,'application/xml').querySelector('parsererror')).toBeNull();expect(text).not.toContain('TargetMode="External"');
      }
      const source=await PDFDocument.load(await fixture());source.addPage([400,500]).drawText('Different');
      await expect(convertDocument(new Blob([new Uint8Array(await source.save()).buffer]),{format:'pptx'},signal())).rejects.toThrow('mixed-slide-sizes');
    }finally{vi.unstubAllGlobals();}
  });
  it('keeps XLSX formula-looking strings inert and protects CSV cells',async()=>{
    const table={id:'reviewed',columns:[{id:'a',label:'=Header'}],rows:[['=1+1'],['@SUM(1)'],[12],[null]]};
    const input=new Blob([new Uint8Array(await fixture()).buffer]);
    const out=await convertDocument(input,{format:'xlsx',tables:[table]},signal()),book=read(await out.files[0].blob.arrayBuffer());
    expect(book.Sheets['Table 1'].A2.v).toBe('=1+1');expect(book.Sheets['Table 1'].A2.f).toBeUndefined();expect(book.Sheets['Table 1'].A4.v).toBe(12);
    const csv=await convertDocument(input,{format:'csv',tables:[table]},signal());expect(await csv.files[0].blob.text()).toContain('"\'=1+1"');
  });
  it('refuses invalid selection, scans in editable mode, cancellation and compressed image profiles', async () => {
    const bytes = await fixture();
    await expect(convertDocument(new Blob([new Uint8Array(bytes).buffer]),{format:'docx',pages:[5]},signal())).rejects.toThrow();
    const empty = await PDFDocument.create(); empty.addPage();
    await expect(convertDocument(new Blob([new Uint8Array(await empty.save()).buffer]),{format:'docx',mode:'editable'},signal())).rejects.toThrow('no-editable-text');
    const controller = new AbortController(); controller.abort();
    await expect(convertDocument(new Blob([new Uint8Array(bytes).buffer]),{format:'docx'},controller.signal)).rejects.toThrow();
  });
});

