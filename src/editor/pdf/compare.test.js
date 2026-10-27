// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb } from 'pdf-lib';
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'));
import { comparePdf, comparePixels } from './compare';

afterEach(() => vi.unstubAllGlobals());
async function fixture(labels) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) { const page=doc.addPage([200,200]); if(typeof label==='string')page.drawText(label,{x:20,y:100,size:15,font}); else { const image=createCanvas(100,100),ctx=image.getContext('2d');ctx.fillStyle=label?'#000000':'#ff0000';ctx.fillRect(0,0,100,100);const png=await doc.embedPng(image.toBuffer('image/png'));page.drawImage(png,{x:30,y:30,width:100,height:100}); } }
  return doc.save();
}
function raster(){vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});}
describe('local PDF comparison with independent PDF.js renders', () => {
  it.each(['media','crop','user-unit','rotation'])('reports physical %s differences even when normalized pixels match',async mode=>{
    raster();async function geometry(changed){const doc=await PDFDocument.create(),page=doc.addPage(mode==='rotation'?[2000,3000]:[4000,4000]);
      if(mode==='media')page.setSize(changed?3000:2000,changed?3000:2000);
      if(mode==='crop')page.setCropBox(20,30,changed?3000:2000,changed?3000:2000);
      if(mode==='user-unit')page.node.set(PDFName.of('UserUnit'),PDFNumber.of(changed?2:1));
      if(mode==='rotation')page.setRotation(degrees(changed?90:0));return doc.save();}
    const report=await comparePdf(await geometry(false),await geometry(true),new AbortController().signal),page=report.pages[0];
    expect(page).toMatchObject({kind:'changed',geometryChanged:true,visualChanged:true,textChanged:false});
    expect(page.beforeDimensions).not.toEqual(page.afterDimensions);
    if(mode!=='rotation')expect(page.visual.changedPixels).toBe(0);
  });
  it.each(['DCTDecode','JPXDecode'])('refuses a failed %s image decode instead of certifying equality with a blank page',async filter=>{
    raster();const doc=await PDFDocument.create(),page=doc.addPage([200,200]),image=doc.context.register(doc.context.stream(new Uint8Array([1,2,3,4]),{Type:'XObject',Subtype:'Image',Width:100,Height:100,BitsPerComponent:8,ColorSpace:'DeviceRGB',Filter:filter}));
    const name=page.node.newXObject('Image',image);page.node.addContentStream(doc.context.register(doc.context.flateStream(`q 100 0 0 100 20 20 cm ${name} Do Q`)));
    const blank=await PDFDocument.create();blank.addPage([200,200]);
    await expect(comparePdf(await doc.save(),await blank.save(),new AbortController().signal)).rejects.toMatchObject({code:'render-failed'});
  });
  it('aligns an inserted first page without marking the later pages changed', async () => {
    raster();const a=await fixture(['first','second']), b=await fixture(['inserted','first','second']),copy=a.slice();
    const report=await comparePdf(a,b,new AbortController().signal);
    expect(report.pages.map(p=>p.kind)).toEqual(['inserted','unchanged','unchanged']);
    expect(report.pages[1]).toMatchObject({beforePage:1,afterPage:2,textChanged:false,visualChanged:false});expect(a).toEqual(copy);
  });
  it('reports changed text and renders, deleted pages and JSON-safe local details', async () => {
    raster();const report=await comparePdf(await fixture(['old','keep','delete']),await fixture(['new','keep']),new AbortController().signal);
    expect(report.pages.map(p=>p.kind)).toEqual(['changed','unchanged','deleted']);
    expect(report.pages[0]).toMatchObject({textChanged:true,visualChanged:true,beforeText:'old',afterText:'new'});
    expect(JSON.parse(JSON.stringify(report)).pages).toHaveLength(3);
  });
  it('detects image-only changes and aligns inserted image pages', async () => {
    raster(); const report=await comparePdf(await fixture([true]),await fixture([false,true]),new AbortController().signal);
    expect(report.pages.map(p=>p.kind)).toEqual(['inserted','unchanged']);
    const changed=await comparePdf(await fixture([true]),await fixture([false]),new AbortController().signal);
    expect(changed.pages[0]).toMatchObject({kind:'changed',textChanged:false,visualChanged:true});
  });
  it('ignores small antialias shade noise but detects real pixels', () => {
    const a={width:2,height:1,data:new Uint8ClampedArray([100,100,100,255,0,0,0,255])};
    expect(comparePixels(a,{...a,data:new Uint8ClampedArray([106,106,106,255,0,0,0,255])}).changedPixels).toBe(0);
    expect(comparePixels(a,{...a,data:new Uint8ClampedArray([140,140,140,255,0,0,0,255])}).changedPixels).toBe(1);
  });
  it('tolerates antialias-sized shade differences in actual PDF.js text renders', async () => {
    raster();async function grey(shade){const doc=await PDFDocument.create(),page=doc.addPage([200,200]),font=await doc.embedFont(StandardFonts.Helvetica);page.drawText('same text',{font,size:20,x:20,y:100,color:rgb(shade,shade,shade)});return doc.save();}
    const report=await comparePdf(await grey(.4),await grey(.42),new AbortController().signal);
    expect(report.pages[0]).toMatchObject({kind:'unchanged',textChanged:false,visualChanged:false});
  });
  it('uses visual anchors when repeated page text is identical',async()=>{
    raster();async function repeated(shades){const doc=await PDFDocument.create();for(const shade of shades){const page=doc.addPage([200,200]);page.drawText('same header',{x:20,y:170,size:12});page.drawRectangle({x:20,y:20,width:100,height:100,color:rgb(shade,shade,shade)});}return doc.save();}
    const report=await comparePdf(await repeated([.2,.5]),await repeated([.2,.5,.8]),new AbortController().signal);
    expect(report.pages.map(page=>page.kind)).toEqual(['unchanged','unchanged','inserted']);
  });
  it('bounds files/pages/pixel work and aborts without changing source', async () => {
    raster();const abort=new AbortController();abort.abort();
    await expect(comparePdf(new Uint8Array([1]),new Uint8Array([1]),abort.signal)).rejects.toMatchObject({name:'AbortError'});
    await expect(comparePdf(new Uint8Array(50*1024*1024+1),new Uint8Array([1]),new AbortController().signal)).rejects.toMatchObject({code:'limit-exceeded'});
    const many=await PDFDocument.create();for(let n=0;n<201;n++)many.addPage([10,10]);
    await expect(comparePdf(await many.save(),await fixture(['one']),new AbortController().signal)).rejects.toMatchObject({code:'limit-exceeded'});
    const during=new AbortController();await expect(comparePdf(await fixture(['one','two']),await fixture(['one','three']),during.signal,()=>during.abort())).rejects.toMatchObject({name:'AbortError'});
  });
  it('enforces the cumulative independent rendering pixel budget on real PDFs', async () => {
    raster();const pdf=await PDFDocument.create();for(let n=0;n<61;n++)pdf.addPage([1024,1024]);const bytes=await pdf.save();
    await expect(comparePdf(bytes,bytes,new AbortController().signal)).rejects.toMatchObject({code:'limit-exceeded'});
  });
});
