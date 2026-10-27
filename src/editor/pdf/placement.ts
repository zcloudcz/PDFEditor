import { getDocument } from 'pdfjs-dist';
import type { StandardPdfToolsApi } from './standard-tools';
export interface PdfPlacement {pageIndex:number;rect:[number,number,number,number];quadPoints:number[];inkPaths:number[][]}
interface ViewportMapping {width:number;height:number;convertToPdfPoint(x:number,y:number):number[]}
/** Map screen-normalized points through PDF.js: crop offsets, rotation and UserUnit are already in its transform. */
export function mapPlacement(points:readonly [number,number][],viewport:ViewportMapping,pageIndex:number,mode:'rectangle'|'note'|'ink'):PdfPlacement|null {
  if(points.length<1||points.length>10000||points.some(p=>p.some(v=>!Number.isFinite(v)||v<0||v>1)))return null;
  const source=points.map(([x,y])=>viewport.convertToPdfPoint(x*viewport.width,y*viewport.height));
  let xs=source.map(p=>p[0]),ys=source.map(p=>p[1]);
  if(mode==='note') {const [x,y]=points[points.length-1];const end=viewport.convertToPdfPoint(Math.min(1,x+24/viewport.width)*viewport.width,Math.min(1,y+24/viewport.height)*viewport.height);xs=[source[source.length-1][0],end[0]];ys=[source[source.length-1][1],end[1]];}
  let minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys);
  if(mode==='ink'){const corners=[viewport.convertToPdfPoint(0,0),viewport.convertToPdfPoint(viewport.width,viewport.height)];minX=Math.max(Math.min(...corners.map(p=>p[0])),minX-1);maxX=Math.min(Math.max(...corners.map(p=>p[0])),maxX+1);minY=Math.max(Math.min(...corners.map(p=>p[1])),minY-1);maxY=Math.min(Math.max(...corners.map(p=>p[1])),maxY+1);}
  if(maxX-minX<0.5||maxY-minY<0.5)return null;
  const first=points[0],last=points[points.length-1],left=Math.min(first[0],last[0])*viewport.width,right=Math.max(first[0],last[0])*viewport.width,top=Math.min(first[1],last[1])*viewport.height,bottom=Math.max(first[1],last[1])*viewport.height;
  return {pageIndex,rect:[minX,minY,maxX-minX,maxY-minY],quadPoints:[...viewport.convertToPdfPoint(left,top),...viewport.convertToPdfPoint(right,top),...viewport.convertToPdfPoint(left,bottom),...viewport.convertToPdfPoint(right,bottom)],inkPaths:[source.flat()]};
}
export async function pickPdfPlacement(bytes:Uint8Array,getSurface:NonNullable<StandardPdfToolsApi['getPageSurface']>,mode:'rectangle'|'note'|'ink',signal?:AbortSignal,instruction='Umístěte prvek na stránku. Escape zruší akci.'):Promise<PdfPlacement|null> {
  signal?.throwIfAborted();const surface=getSurface();if(!surface||!surface.container.isConnected)return null;
  const loading=getDocument({data:bytes.slice(),isEvalSupported:false});
  let viewport:ViewportMapping;
  try {const doc=await loading.promise;if(surface.pageIndex<0||surface.pageIndex>=doc.numPages)return null;const page=await doc.getPage(surface.pageIndex+1);viewport=page.getViewport({scale:1});}
  finally{await loading.destroy();}
  signal?.throwIfAborted();if(!surface.container.isConnected)return null;
  return new Promise(resolve=>{
    const container=surface.container,oldCursor=container.style.cursor;container.style.cursor='crosshair';let pointer:number|null=null,points:[number,number][]=[];
    const preview=document.createElement('div');preview.setAttribute('aria-hidden','true');Object.assign(preview.style,{position:'fixed',border:'2px dashed #0284c7',background:'rgba(2,132,199,.15)',pointerEvents:'none',zIndex:'2147483647'});document.body.append(preview);
    const hint=document.createElement('p');hint.setAttribute('role','status');hint.textContent=instruction;Object.assign(hint.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',padding:'12px',background:'#0f172a',color:'white',zIndex:'2147483647',pointerEvents:'none'});document.body.append(hint);
    const valid=()=>{const current=getSurface();return container.isConnected&&current?.container===container&&current.pageIndex===surface.pageIndex;};
    const clean=()=>{container.style.cursor=oldCursor;preview.remove();hint.remove();container.removeEventListener('pointerdown',down,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);signal?.removeEventListener('abort',cancel);observer.disconnect();};
    const finish=(result:PdfPlacement|null)=>{clean();resolve(result);};
    const cancel=()=>finish(null);const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}};
    const point=(event:PointerEvent):[number,number]=>{const r=container.getBoundingClientRect();return[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))];};
    const show=()=>{const r=container.getBoundingClientRect(),a=points[0],b=points[points.length-1];Object.assign(preview.style,{left:`${r.left+Math.min(a[0],b[0])*r.width}px`,top:`${r.top+Math.min(a[1],b[1])*r.height}px`,width:`${Math.abs(a[0]-b[0])*r.width}px`,height:`${Math.abs(a[1]-b[1])*r.height}px`});};
    const down=(event:PointerEvent)=>{if(event.button!==0||pointer!==null)return;event.preventDefault();event.stopImmediatePropagation();if(!valid()){cancel();return;}pointer=event.pointerId;points=[point(event)];show();};
    const move=(event:PointerEvent)=>{if(pointer!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();if(!valid()||points.length>=10000){cancel();return;}if(mode==='ink')points.push(point(event));else points=[points[0],point(event)];show();};
    const up=(event:PointerEvent)=>{if(pointer!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();if(!valid()){cancel();return;}if(mode==='ink')points.push(point(event));else points=[points[0],point(event)];finish(mapPlacement(points,viewport,surface.pageIndex,mode));};
    const observer=new MutationObserver(()=>{if(!valid())cancel();});observer.observe(document.body,{childList:true,subtree:true});
    container.addEventListener('pointerdown',down,true);window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);signal?.addEventListener('abort',cancel,{once:true});
  });
}
