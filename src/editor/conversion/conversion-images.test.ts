// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCanvas, Path2D, DOMMatrix, ImageData } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';
import { convertDocument } from './office-export';
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { pathToFileURL } = await import('node:url'), { resolve } = await import('node:path');
  return { default:pathToFileURL(resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href };
});
const originalHex=Object.getOwnPropertyDescriptor(Uint8Array.prototype,'toHex'),originalMap=Object.getOwnPropertyDescriptor(Map.prototype,'getOrInsertComputed');
beforeEach(()=>{
  vi.stubGlobal('Path2D',Path2D);vi.stubGlobal('DOMMatrix',DOMMatrix);vi.stubGlobal('ImageData',ImageData);
  vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
  if(!originalHex)Object.defineProperty(Uint8Array.prototype,'toHex',{configurable:true,value:function(this:Uint8Array){return Buffer.from(this).toString('hex');}});
  if(!originalMap)Object.defineProperty(Map.prototype,'getOrInsertComputed',{configurable:true,value:function<K,V>(this:Map<K,V>,key:K,make:(key:K)=>V){if(!this.has(key))this.set(key,make(key));return this.get(key);}});
});
afterEach(()=>{vi.unstubAllGlobals();if(!originalHex)Reflect.deleteProperty(Uint8Array.prototype,'toHex');if(!originalMap)Reflect.deleteProperty(Map.prototype,'getOrInsertComputed');});
async function imageFixture(){
  const doc=await PDFDocument.create(),page=doc.addPage([300,400]),canvas=createCanvas(10,10),ctx=canvas.getContext('2d');
  ctx.fillStyle='red';ctx.fillRect(0,0,10,10);
  const image=await doc.embedPng(canvas.toBuffer('image/png'));page.drawImage(image,{x:10,y:20,width:30,height:30});
  doc.registerFontkit(fontkit);const font=await doc.embedFont(await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'));
  page.drawText('Image fixture',{x:20,y:300,size:14,font});return doc;
}
it('writes actual source image PNG into editable DOCX',async()=>{
  const doc=await imageFixture(),out=await convertDocument(new Blob([new Uint8Array(await doc.save()).buffer]),{format:'docx'},new AbortController().signal);
  const zip=await JSZip.loadAsync(await out.files[0].blob.arrayBuffer()),image=await zip.file('word/media/image1.png')!.async('uint8array');
  expect([...image.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(out.report.preserved).toBe(1);expect(out.report.rasterized).toBe(0);
});
it('refuses a compressed JPEG image profile before extraction',async()=>{
  const doc=await PDFDocument.load(await (await imageFixture()).save());
  const image=doc.context.enumerateIndirectObjects().map(([,v])=>v).find(v=>v instanceof PDFRawStream&&v.dict.get(PDFName.of('Subtype'))===PDFName.of('Image'));
  if(!(image instanceof PDFRawStream))throw new Error('fixture');image.dict.set(PDFName.of('Filter'),PDFName.of('DCTDecode'));
  await expect(convertDocument(new Blob([new Uint8Array(await doc.save()).buffer]),{format:'docx'},new AbortController().signal)).rejects.toThrow();
});
it('rasterizes only after explicit fidelity selection and reports the loss of editability',async()=>{
  const doc=await imageFixture(),out=await convertDocument(new Blob([new Uint8Array(await doc.save()).buffer]),{format:'docx',mode:'fidelity'},new AbortController().signal);
  const zip=await JSZip.loadAsync(await out.files[0].blob.arrayBuffer());
  expect(zip.file('word/media/image1.png')).not.toBeNull();expect(out.report.rasterized).toBe(1);expect(out.report.editable).toBe(0);
});
