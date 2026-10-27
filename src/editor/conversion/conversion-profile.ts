import { OPS, Util, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { loadPrintDocument } from '../pdf/preflight';
import { assertRenderedImages } from '../pdf/render-validation';
import type { DataTable } from '../data/table';
import { PDFDict, PDFName, PDFStream } from 'pdf-lib';

export interface ConversionRequest { format: 'docx'|'xlsx'|'csv'|'pptx'; mode?: 'editable'|'fidelity'; pages?: readonly number[]; tables?: readonly DataTable[] }
export interface ConversionReport { profile: string; preserved: number; editable: number; rasterized: number; limitations: string[] }
export interface ConversionResult { files: { name: string; blob: Blob }[]; report: ConversionReport }
export class ConversionError extends Error { constructor(public readonly code: string) { super(code); this.name='ConversionError'; } }
export interface TextBlock { text: string; x: number; y: number; width: number; height: number }
export interface ImageBlock { png: string; x: number; y: number; width: number; height: number }
export interface ConversionPage { index: number; width: number; height: number; text: TextBlock[]; images: ImageBlock[]; raster?: string }
export const CONVERSION_PROFILE = 'bounded-lossless-pdf-v1';
export const CONVERSION_LIMITS = { bytes: 20*1024*1024, pages: 40, textBlocks: 10000, textUnits: 1000000, pixels: 16000000, images: 100, outputBytes: 50*1024*1024 } as const;
export const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/g,'').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'\uFFFD').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function selectedPages(count: number, requested?: readonly number[]): number[] {
  const pages = requested ? [...requested] : Array.from({length:count},(_,i)=>i);
  if (!pages.length || pages.length>CONVERSION_LIMITS.pages || new Set(pages).size!==pages.length || pages.some(i=>!Number.isInteger(i)||i<0||i>=count)) throw new ConversionError('invalid-page-selection');
  return pages;
}
function canvas(width: number, height: number) {
  if (![width,height].every(v=>Number.isFinite(v)&&v>0) || Math.ceil(width)*Math.ceil(height)>CONVERSION_LIMITS.pixels) throw new ConversionError('image-limit');
  const element=document.createElement('canvas'); element.width=Math.ceil(width); element.height=Math.ceil(height);
  const context=element.getContext('2d'); if(!context) throw new ConversionError('canvas-unavailable');
  return {element,context};
}
async function raster(page: PDFPageProxy, signal: AbortSignal): Promise<string> {
  const viewport=page.getViewport({scale:1.5}), {element,context}=canvas(viewport.width,viewport.height);
  const render=page.render({canvasContext:context,canvas:element,viewport}), abort=()=>render.cancel(); signal.addEventListener('abort',abort,{once:true});
  try { signal.throwIfAborted(); await render.promise; await assertRenderedImages(page,signal); return element.toDataURL('image/png'); }
  finally {signal.removeEventListener('abort',abort); element.width=element.height=0;}
}
async function imageData(page: PDFPageProxy, id: unknown, signal: AbortSignal): Promise<string> {
  if(typeof id!=='string') throw new ConversionError('unsupported-image');
  const store=id.startsWith('g_')?page.commonObjs:page.objs;
  const value: unknown=store.has(id)?store.get(id):await new Promise((resolve,reject)=>{
    const finish=(v:unknown,e?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);e?reject(e):resolve(v);};
    const abort=()=>finish(null,signal.reason),timer=setTimeout(()=>finish(null,new ConversionError('image-decode-failed')),10000);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}store.get(id,(v:unknown)=>finish(v));
  });
  if(!value || typeof value!=='object' || !('width'in value) || !('height'in value) || typeof value.width!=='number' || typeof value.height!=='number')throw new ConversionError('image-decode-failed');
  const {element,context}=canvas(value.width,value.height);
  try {
    if('bitmap'in value && typeof ImageBitmap!=='undefined' && value.bitmap instanceof ImageBitmap) context.drawImage(value.bitmap,0,0);
    else {
      if(!('data'in value) || !ArrayBuffer.isView(value.data))throw new ConversionError('unsupported-image');
      const bytes=new Uint8Array(value.data.buffer,value.data.byteOffset,value.data.byteLength), pixels=value.width*value.height;
      const rgba=context.createImageData(value.width,value.height);
      if(bytes.length===pixels*4)rgba.data.set(bytes);
      else if(bytes.length===pixels*3)for(let i=0;i<pixels;i++){rgba.data[i*4]=bytes[i*3];rgba.data[i*4+1]=bytes[i*3+1];rgba.data[i*4+2]=bytes[i*3+2];rgba.data[i*4+3]=255;}
      else throw new ConversionError('unsupported-image');
      context.putImageData(rgba,0,0);
    }
    return element.toDataURL('image/png');
  } finally {element.width=element.height=0;}
}
/** Validates compressed streams before PDF.js; no active PDF or external resource execution. */
export async function readConversionPages(bytes: Uint8Array, requested: readonly number[]|undefined, mode: 'editable'|'fidelity', signal: AbortSignal): Promise<ConversionPage[]> {
  signal.throwIfAborted(); if(!bytes.length||bytes.length>CONVERSION_LIMITS.bytes)throw new ConversionError('input-limit');
  const checked=await loadPrintDocument(bytes,signal), indices=selectedPages(checked.getPageCount(),requested);
  if(mode==='editable')for(const [,object] of checked.context.enumerateIndirectObjects()){
    const dict=object instanceof PDFStream?object.dict:object;
    if(dict instanceof PDFDict && dict.get(PDFName.of('Subtype'))===PDFName.of('Image') && ['Mask','SMask','ImageMask','Decode'].some(key=>dict.has(PDFName.of(key))))throw new ConversionError('masked-image-requires-fidelity');
  }
  const pdfjs=await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  const loading=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,enableXfa:false,useSystemFonts:false,stopAtErrors:true,verbosity:0,
    ...(typeof window!=='undefined'?{standardFontDataUrl:'/pdfjs-viewer/standard_fonts/',cMapUrl:'/pdfjs-viewer/cmaps/',cMapPacked:true,wasmUrl:'/pdfjs-viewer/wasm/'}:{})});
  const abort=()=>{void loading.destroy().catch(()=>{});}; signal.addEventListener('abort',abort,{once:true});
  let blocks=0,units=0,imageCount=0,encodedImageUnits=0;
  const boundedImage=(png:string)=>{encodedImageUnits+=png.length;if(encodedImageUnits>CONVERSION_LIMITS.outputBytes)throw new ConversionError('output-limit');return png;};
  try {
    const source=await loading.promise, pages:ConversionPage[]=[];
    for(const index of indices){
      signal.throwIfAborted(); const page=await source.getPage(index+1), viewport=page.getViewport({scale:1});
      if(![viewport.width,viewport.height].every(v=>Number.isFinite(v)&&v>0&&v<=14400))throw new ConversionError('page-limit');
      const result:ConversionPage={index,width:viewport.width,height:viewport.height,text:[],images:[]};
      if(mode==='fidelity') result.raster=boundedImage(await raster(page,signal));
      else {
        const content=await page.getTextContent();
        for(const item of content.items){
          if(!('str'in item)||!item.str.trim())continue;
          if(++blocks>CONVERSION_LIMITS.textBlocks||(units+=item.str.length)>CONVERSION_LIMITS.textUnits)throw new ConversionError('text-limit');
          if(item.dir==='rtl'||/[\u0590-\u08ff]/.test(item.str))throw new ConversionError('rtl-requires-fidelity');
          const m=Util.transform(viewport.transform,item.transform), height=Math.hypot(m[2],m[3]);
          if(Math.abs(m[1])>0.01||Math.abs(m[2])>0.01||!m.every(Number.isFinite)||height<=0||!Number.isFinite(item.width)||item.width<0)throw new ConversionError('rotated-text-requires-fidelity');
          if(item.str.includes('\uFFFD'))throw new ConversionError('text-mapping-unavailable');
          const width=item.width*Math.hypot(viewport.transform[0],viewport.transform[1]);
          result.text.push({text:item.str,x:m[4],y:m[5]-height,width,height});
        }
        const ops=await page.getOperatorList(); if(ops.fnArray.length>100000)throw new ConversionError('operator-limit');
        let matrix=[1,0,0,1,0,0];const stack:number[][]=[];
        for(let i=0;i<ops.fnArray.length;i++){
          signal.throwIfAborted();const op=ops.fnArray[i],args=ops.argsArray[i];
          if(op===OPS.save){if(stack.length>64)throw new ConversionError('operator-limit');stack.push([...matrix]);}
          else if(op===OPS.restore){matrix=stack.pop()??[1,0,0,1,0,0];}
          else if(op===OPS.transform)matrix=Util.transform(matrix,args);
          else if(op===OPS.paintImageXObject){
            if(++imageCount>CONVERSION_LIMITS.images)throw new ConversionError('image-limit');
            const m=Util.transform(viewport.transform,matrix);if(Math.abs(m[1])>0.01||Math.abs(m[2])>0.01)throw new ConversionError('rotated-image-requires-fidelity');
            if(!m.every(Number.isFinite)||m[0]<=0||m[3]>=0)throw new ConversionError('mirrored-image-requires-fidelity');
            result.images.push({png:boundedImage(await imageData(page,args[0],signal)),x:Math.min(m[4],m[4]+m[0]),y:Math.min(m[5],m[5]+m[3]),width:Math.abs(m[0]),height:Math.abs(m[3])});
          }else if([OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObjectGroup,OPS.paintFormXObjectBegin,OPS.paintFormXObjectEnd].includes(op))throw new ConversionError('complex-image-requires-fidelity');
        }
        if(!result.text.length)throw new ConversionError('no-editable-text');
      }
      pages.push(result);page.cleanup();
    }
    return pages;
  }finally{signal.removeEventListener('abort',abort);await loading.destroy();}
}
