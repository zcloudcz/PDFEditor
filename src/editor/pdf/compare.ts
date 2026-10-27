import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assertRenderedImages, PdfRenderValidationError } from './render-validation';

export const COMPARISON_LIMITS = { bytes: 50 * 1024 * 1024, pages: 200, pagePixels: 1_048_576, totalPixels: 120_000_000, textCharacters: 8_000_000 } as const;
export class ComparisonError extends Error { constructor(public readonly code: 'limit-exceeded' | 'invalid-pdf' | 'render-failed') { super(code); this.name = 'ComparisonError'; } }
export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
export interface PixelDifference { changedPixels: number; totalPixels: number; fraction: number; bounds: [number,number,number,number] | null }
export interface ComparedPage { kind: 'inserted' | 'deleted' | 'changed' | 'unchanged'; beforePage: number | null; afterPage: number | null; textChanged: boolean; visualChanged: boolean; geometryChanged: boolean; beforeDimensions: [number,number] | null; afterDimensions: [number,number] | null; beforeText: string; afterText: string; visual: PixelDifference | null }
export interface ComparisonReport { version: 1; beforePages: number; afterPages: number; renderMaxEdge: number; colorTolerance: number; pages: ComparedPage[] }
interface PageSignature { text: string; width: number; height: number; fingerprint: Uint8Array }
const COLOR_TOLERANCE = 12, MAX_EDGE = 1024;
const limit = (): never => { throw new ComparisonError('limit-exceeded'); };

/** Channel tolerance suppresses shade-only antialias noise; a real changed pixel remains reportable. */
export function comparePixels(a: PixelImage, b: PixelImage, tolerance = COLOR_TOLERANCE): PixelDifference {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255 || [a,b].some(image => !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > COMPARISON_LIMITS.pagePixels || image.data.length !== image.width * image.height * 4)) throw new ComparisonError('render-failed');
  const width = Math.max(a.width,b.width), height = Math.max(a.height,b.height); let changedPixels = 0, left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let changed = x >= a.width || x >= b.width || y >= a.height || y >= b.height;
    if (!changed) { const ai = (y * a.width + x) * 4, bi = (y * b.width + x) * 4; for (let c = 0; c < 4; c++) if (Math.abs(a.data[ai+c] - b.data[bi+c]) > tolerance) { changed = true; break; } }
    if (changed) { changedPixels++; left = Math.min(left,x); top = Math.min(top,y); right = Math.max(right,x); bottom = Math.max(bottom,y); }
  }
  return { changedPixels, totalPixels: width * height, fraction: changedPixels / (width * height), bounds: changedPixels ? [left,top,right-left+1,bottom-top+1] : null };
}

function signature(image: PixelImage): Uint8Array {
  const values = new Uint8Array(16 * 16 * 3);
  for (let gy = 0; gy < 16; gy++) for (let gx = 0; gx < 16; gx++) {
    const count = [0,0,0]; let pixels = 0;
    for (let y = Math.floor(gy * image.height / 16); y < Math.floor((gy+1) * image.height / 16); y++) for (let x = Math.floor(gx * image.width / 16); x < Math.floor((gx+1) * image.width / 16); x++) {
      const index = (y * image.width + x) * 4; for (let c=0;c<3;c++) count[c] += image.data[index+c]; pixels++;
    }
    for (let c=0;c<3;c++) values[(gy*16+gx)*3+c] = pixels ? Math.round(count[c]/pixels) : 255;
  }
  return values;
}
function samePage(a: PageSignature,b: PageSignature): boolean {
  if (Math.abs(a.width-b.width) > 0.1 || Math.abs(a.height-b.height) > 0.1 || a.text !== b.text) return false;
  let difference = 0; for(let i=0;i<a.fingerprint.length;i++) difference += Math.abs(a.fingerprint[i]-b.fingerprint[i]);
  return difference/a.fingerprint.length < .25;
}
function align(a: PageSignature[],b: PageSignature[]): Array<[number|null,number|null]> {
  const width=b.length+1, costs=new Float64Array((a.length+1)*width);
  for(let i=0;i<=a.length;i++)costs[i*width]=i*.8;for(let j=0;j<=b.length;j++)costs[j]=j*.8;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)costs[i*width+j]=Math.min(costs[(i-1)*width+j-1]+(samePage(a[i-1],b[j-1])?0:1),costs[(i-1)*width+j]+.8,costs[i*width+j-1]+.8);
  const pairs:Array<[number|null,number|null]>=[];let i=a.length,j=b.length;
  while(i||j){const value=costs[i*width+j];if(i&&j&&Math.abs(value-costs[(i-1)*width+j-1]-(samePage(a[i-1],b[j-1])?0:1))<1e-6){pairs.push([--i,--j]);}else if(j&&Math.abs(value-costs[i*width+j-1]-.8)<1e-6){pairs.push([null,--j]);}else{pairs.push([--i,null]);}}
  return pairs.reverse();
}

/** No source mutation, persistence or network service. PDF.js reads detached byte copies. */
export async function comparePdf(a: Uint8Array, b: Uint8Array, signal: AbortSignal, progress: (done: number,total: number) => void = () => {}): Promise<ComparisonReport> {
  signal.throwIfAborted();
  if ([a,b].some(bytes => !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > COMPARISON_LIMITS.bytes)) limit();
  if (typeof window !== 'undefined') GlobalWorkerOptions.workerSrc = workerUrl;
  const options = { isEvalSupported:false, enableXfa:false, useSystemFonts:false, stopAtErrors:true, verbosity:0,
    ...(typeof window !== 'undefined' ? { standardFontDataUrl:'/pdfjs-viewer/standard_fonts/', cMapUrl:'/pdfjs-viewer/cmaps/', cMapPacked:true, wasmUrl:'/pdfjs-viewer/wasm/' } : {}) };
  const first=getDocument({...options,data:a.slice()}),second=getDocument({...options,data:b.slice()});
  const destroy=()=>{void first.destroy().catch(()=>{});void second.destroy().catch(()=>{});};signal.addEventListener('abort',destroy,{once:true});
  let pixelBudget=0,textBudget=0,done=0,total=0;
  async function raster(doc:PDFDocumentProxy,index:number,edge:number):Promise<PixelImage>{
    signal.throwIfAborted();const page=await doc.getPage(index+1),original=page.getViewport({scale:1});
    if(!Number.isFinite(original.width)||!Number.isFinite(original.height)||original.width<=0||original.height<=0)throw new ComparisonError('render-failed');
    const viewport=page.getViewport({scale:Math.min(1,edge/Math.max(original.width,original.height))});
    const width=Math.max(1,Math.ceil(viewport.width)),height=Math.max(1,Math.ceil(viewport.height));
    pixelBudget+=width*height;if(pixelBudget>COMPARISON_LIMITS.totalPixels)limit();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new ComparisonError('render-failed');
    const render=page.render({canvas,canvasContext:context,viewport,background:'rgb(255,255,255)'}),abort=()=>render.cancel();signal.addEventListener('abort',abort,{once:true});
    try{await render.promise;signal.throwIfAborted();await assertRenderedImages(page,signal);const image=context.getImageData(0,0,canvas.width,canvas.height);return{width:canvas.width,height:canvas.height,data:image.data};}
    finally{signal.removeEventListener('abort',abort);canvas.width=canvas.height=0;page.cleanup();}
  }
  async function scan(doc:PDFDocumentProxy):Promise<PageSignature[]>{
    const result:PageSignature[]=[];
    for(let index=0;index<doc.numPages;index++){
      signal.throwIfAborted();const page=await doc.getPage(index+1),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
      const text=content.items.map(item=>'str'in item?item.str+('hasEOL'in item&&item.hasEOL?'\n':' '):'').join('').trim().normalize('NFC');
      textBudget+=text.length;if(text.length>1_000_000||textBudget>COMPARISON_LIMITS.textCharacters)limit();
      const image=await raster(doc,index,128);result.push({text,width:viewport.width,height:viewport.height,fingerprint:signature(image)});progress(++done,total);signal.throwIfAborted();
    }return result;
  }
  try{
    const [before,after]=await Promise.all([first.promise,second.promise]);signal.throwIfAborted();
    if(before.numPages>COMPARISON_LIMITS.pages||after.numPages>COMPARISON_LIMITS.pages)limit();total=before.numPages+after.numPages;progress(0,total);
    const left=await scan(before),right=await scan(after),pairs=align(left,right),pages:ComparedPage[]=[];total+=pairs.filter(pair=>pair[0]!==null&&pair[1]!==null).length;progress(done,total);
    for(const [i,j]of pairs){
      signal.throwIfAborted();const beforeText=i===null?'':left[i].text,afterText=j===null?'':right[j].text;
      let visual:PixelDifference|null=null;
      if(i!==null&&j!==null){visual=comparePixels(await raster(before,i,MAX_EDGE),await raster(after,j,MAX_EDGE));progress(++done,total);}
      const beforeDimensions:[number,number]|null=i===null?null:[left[i].width,left[i].height],afterDimensions:[number,number]|null=j===null?null:[right[j].width,right[j].height];
      const geometryChanged=beforeDimensions===null||afterDimensions===null||beforeDimensions.some((value,axis)=>Math.abs(value-afterDimensions[axis])>0.001);
      const textChanged=beforeText!==afterText,visualChanged=geometryChanged||visual===null||visual.changedPixels>0;
      pages.push({kind:i===null?'inserted':j===null?'deleted':textChanged||visualChanged?'changed':'unchanged',beforePage:i===null?null:i+1,afterPage:j===null?null:j+1,textChanged,visualChanged,geometryChanged,beforeDimensions,afterDimensions,beforeText,afterText,visual});
    }
    signal.throwIfAborted();return{version:1,beforePages:before.numPages,afterPages:after.numPages,renderMaxEdge:MAX_EDGE,colorTolerance:COLOR_TOLERANCE,pages};
  }catch(error){signal.throwIfAborted();if(error instanceof ComparisonError)throw error;if(error instanceof PdfRenderValidationError)throw new ComparisonError('render-failed');throw new ComparisonError('invalid-pdf');}
  finally{signal.removeEventListener('abort',destroy);await Promise.allSettled([first.destroy(),second.destroy()]);}
}
