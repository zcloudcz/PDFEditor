import { expect, it } from 'vitest';
import { OPS, type PDFPageProxy } from 'pdfjs-dist';
import { assertRenderedImages } from './render-validation';

function page(op:number,args:unknown[],objects:Record<string,unknown>={},common:Record<string,unknown>={}):Pick<PDFPageProxy,'getOperatorList'|'objs'|'commonObjs'>{
  const store=(values:Record<string,unknown>)=>({get:(id:string,callback?:(value:unknown)=>void)=>{callback?.(values[id]);return values[id];},has:(id:string)=>id in values});
  return {getOperatorList:async()=>({fnArray:[op],argsArray:[args]}),objs:store(objects),commonObjs:store(common)} as unknown as Pick<PDFPageProxy,'getOperatorList'|'objs'|'commonObjs'>;
}
const image={width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])};
it.each([OPS.paintImageXObject,OPS.paintImageXObjectRepeat])('fails closed on a null decoded image for op %s',async op=>{
  await expect(assertRenderedImages(page(op,['img_1'],{img_1:null}))).rejects.toMatchObject({code:'render-failed'});
  await expect(assertRenderedImages(page(op,['g_img_1'],{},{g_img_1:null}))).rejects.toMatchObject({code:'render-failed'});
});
it('accepts resolved local/global image data and rejects unresolved images',async()=>{
  await expect(assertRenderedImages(page(OPS.paintImageXObject,['img_1'],{img_1:image}))).resolves.toBeUndefined();
  await expect(assertRenderedImages(page(OPS.paintImageXObject,['g_img_1'],{},{g_img_1:image}))).resolves.toBeUndefined();
  await expect(assertRenderedImages(page(OPS.paintImageXObject,['missing']))).rejects.toMatchObject({code:'render-failed'});
});
it.each([OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectRepeat])('verifies image mask references for op %s',async op=>{
  await expect(assertRenderedImages(page(op,[{width:1,height:1,data:'mask_1'}],{mask_1:null}))).rejects.toMatchObject({code:'render-failed'});
});
it('validates inline images, grouped inline images and grouped masks',async()=>{
  for(const op of [OPS.paintInlineImageXObject,OPS.paintInlineImageXObjectGroup]){
    await expect(assertRenderedImages(page(op,[image]))).resolves.toBeUndefined();
    await expect(assertRenderedImages(page(op,[null]))).rejects.toMatchObject({code:'render-failed'});
  }
  await expect(assertRenderedImages(page(OPS.paintImageMaskXObjectGroup,[[{width:1,height:1,data:'mask_1'}]],{mask_1:null}))).rejects.toMatchObject({code:'render-failed'});
});
it('honors cancellation before retrieving an operator list',async()=>{const abort=new AbortController();abort.abort();await expect(assertRenderedImages(page(OPS.paintImageXObject,['img_1']),abort.signal)).rejects.toMatchObject({name:'AbortError'});});
