import { OPS, type PDFPageProxy } from 'pdfjs-dist';

export class PdfRenderValidationError extends Error {
  readonly code = 'render-failed';
  constructor() { super('render-failed'); this.name = 'PdfRenderValidationError'; }
}
type RenderedPage = Pick<PDFPageProxy,'getOperatorList'|'objs'|'commonObjs'>;
const fail = (): never => { throw new PdfRenderValidationError(); };

/** Run after render.promise, before cleanup: PDF.js can resolve failed asynchronous decodes with null. */
export async function assertRenderedImages(page: RenderedPage, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  async function image(value: unknown): Promise<void> {
    if (typeof value === 'string') {
      const store = value.startsWith('g_') ? page.commonObjs : page.objs;
      const decoded: unknown = store.has(value) ? store.get(value) : await new Promise<unknown>((resolve,reject)=>{
        const finish=(result:unknown,error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result);};
        const abort=()=>finish(undefined,signal?.reason??new PdfRenderValidationError()),timer=setTimeout(()=>finish(undefined,new PdfRenderValidationError()),10000);
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}store.get(value,(data:unknown)=>finish(data));
      });
      await image(decoded); return;
    }
    if (!value || typeof value !== 'object' || !('width' in value) || !('height' in value) || typeof value.width !== 'number' || typeof value.height !== 'number' || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) fail();
    const decoded = value as { bitmap?: unknown; data?: unknown };
    if (decoded.bitmap) return;
    if (typeof decoded.data === 'string') { await image(decoded.data); return; }
    if (!ArrayBuffer.isView(decoded.data)) fail();
  }
  let visited=0;
  async function inspect(value:unknown,depth:number):Promise<void> {
    if (!value || typeof value!=='object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
    if (++visited > 100000 || depth > 64) fail();
    if (Array.isArray(value)) { for(const child of value) await inspect(child,depth+1); return; }
    if ('fnArray'in value && 'argsArray'in value && Array.isArray(value.fnArray) && Array.isArray(value.argsArray)) {
      if(value.fnArray.length!==value.argsArray.length)fail();
      for(let index=0;index<value.fnArray.length;index++){
        signal?.throwIfAborted();const operation:unknown=value.fnArray[index],rawArgs:unknown=value.argsArray[index],args=Array.isArray(rawArgs)?rawArgs:[];
        if(typeof operation==='number'&&[OPS.paintImageXObject,OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObject,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectRepeat].includes(operation))await image(args[0]);
        else if(operation===OPS.paintImageMaskXObjectGroup){if(!Array.isArray(args[0]))fail();for(const mask of args[0])await image(mask);}
        for(const child of args)await inspect(child,depth+1);
      }
      return;
    }
    for(const child of Object.values(value))await inspect(child,depth+1);
  }
  try { await inspect(await page.getOperatorList(),0); signal?.throwIfAborted(); }
  catch { signal?.throwIfAborted(); throw new PdfRenderValidationError(); }
}
