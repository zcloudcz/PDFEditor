import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_PREPARATION as defaults, filterScanPixels, scanGeometry } from './scan-processing';
import { proposeOcrReconstruction } from './ocr-reconstruction';
describe('bounded reversible OCR input processing', () => {
  it('maps orientation and deskew back to source without clipping corners', () => {
    for (const orientation of [0,90,180,270] as const) for (const deskew of [-5,0,5]) {
      const g = scanGeometry(300,200,{...defaults,orientation,deskew});
      const c = Math.cos(g.angle), s = Math.sin(g.angle);
      for (const [x,y] of [[0,0],[300,0],[300,200],[0,200],[150,100]]) {
        const dx=x-150,dy=y-100, px=c*dx-s*dy+g.width/2,py=s*dx+c*dy+g.height/2;
        expect(px).toBeGreaterThanOrEqual(-1e-8); expect(py).toBeGreaterThanOrEqual(-1e-8); expect(px).toBeLessThanOrEqual(g.width+1e-8); expect(py).toBeLessThanOrEqual(g.height+1e-8);
        expect(g.toOriginal(px,py)[0]).toBeCloseTo(x); expect(g.toOriginal(px,py)[1]).toBeCloseTo(y);
      }
    }
  });
  it('removes isolated dust while preserving connected strokes and original input', async () => {
    const data=new Uint8ClampedArray(7*7*4).fill(255);
    const ink=(x:number,y:number)=>{ const i=(y*7+x)*4;data[i]=data[i+1]=data[i+2]=0;}; ink(1,1);ink(4,3);ink(4,4);
    const before=data.slice();const result=await filterScanPixels(data,7,7,{...defaults,denoise:true},new AbortController().signal);
    expect(result[(1*7+1)*4]).toBe(255);expect(result[(3*7+4)*4]).toBe(0);expect(result[(4*7+4)*4]).toBe(0);expect(data).toEqual(before);
  });
  it('yields and honors cancellation without modifying input', async () => {
    const abort=new AbortController(),data=new Uint8ClampedArray(256*256*4).fill(255),before=data.slice();
    const pending=filterScanPixels(data,256,256,defaults,abort.signal);abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(data).toEqual(before);
  });
  it('rejects invalid options and oversized allocation before work', () => {
    expect(()=>scanGeometry(4000,4000,defaults)).toThrow('scan-limit');expect(()=>scanGeometry(200,200,{...defaults,deskew:6})).toThrow();expect(()=>scanGeometry(200,200,{...defaults,contrast:NaN})).toThrow();
  });
  it('proposes rotated correction boxes and refuses cropped/outside text', () => {
    const geometry=scanGeometry(300,200,{...defaults,orientation:90});
    const page={pageIndex:0,text:'test',confidence:90,width:300,height:200,toDisplay:geometry.toOriginal,rotation:-90,blocks:{width:200,height:300,dpi:216,lines:[{bbox:{x0:20,y0:20,x1:120,y1:40},baseline:{slope:0,intercept:0},textangle:0,direction:'ltr' as const,injectWordBreaks:true,words:[{text:'test',confidence:74,bbox:{x0:20,y0:20,x1:120,y1:40}}]}]}};
    const line=proposeOcrReconstruction(2,[page]).pages[0].lines[0];expect(line).toMatchObject({text:'test',width:100,height:20,confidence:74,rotation:-90});
    page.blocks.lines[0].bbox.x0=-30;expect(()=>proposeOcrReconstruction(2,[page])).toThrow('ocr-proposal-outside-page');
  });
});
