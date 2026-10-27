import { afterEach, expect, it, vi } from 'vitest';
import { mountComparisonPanel } from './comparison-panel';
import { comparePdf } from './compare';
import type { StandardPdfToolsApi } from './standard-tools';
vi.mock('./compare',()=>({COMPARISON_LIMITS:{bytes:50*1024*1024},comparePdf:vi.fn()}));
afterEach(()=>{document.body.replaceChildren();vi.clearAllMocks();});
function setup(){
  const body=document.createElement('div');document.body.append(body);
  const api:StandardPdfToolsApi={readPdfSnapshot:vi.fn(async()=>({bytes:new Uint8Array([1]),revision:3})),runPdfOperation:vi.fn(),registerDocumentAction:vi.fn(),mountDocumentPanel:vi.fn()};
  const dispose=mountComparisonPanel(body,api),file=body.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(file,'files',{value:[{size:2,arrayBuffer:async()=>new Uint8Array([2,3]).buffer}]});
  return{body,api,dispose};
}
function click(body:HTMLElement,label:string){Array.from(body.querySelectorAll('button')).find(button=>button.textContent===label)!.click();}
it('shows local changed text without HTML and keeps comparison out of mutation history',async()=>{
  const s=setup();vi.mocked(comparePdf).mockResolvedValue({version:1,beforePages:1,afterPages:1,renderMaxEdge:1024,colorTolerance:12,pages:[{kind:'changed',beforePage:1,afterPage:1,beforeText:'<script>private</script>',afterText:'new',textChanged:true,visualChanged:true,geometryChanged:false,beforeDimensions:[200,200],afterDimensions:[200,200],visual:{changedPixels:1,totalPixels:100,fraction:.01,bounds:[0,0,1,1]}}]});
  click(s.body,'Porovnat PDF');await vi.waitFor(()=>expect(s.body.querySelectorAll('textarea')).toHaveLength(2));expect(s.body.querySelector('script')).toBeNull();expect(s.body.querySelector('textarea')!.value).toBe('<script>private</script>');expect(s.api.runPdfOperation).not.toHaveBeenCalled();expect(s.body.textContent).toContain('Vizuální změna');
});
it('aborts pending work on close and does not expose a late report',async()=>{
  const s=setup();let signal:AbortSignal|undefined;
  vi.mocked(comparePdf).mockImplementation(async(_a,_b,currentSignal)=>{signal=currentSignal;return new Promise((_resolve,reject)=>currentSignal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));});
  click(s.body,'Porovnat PDF');await vi.waitFor(()=>expect(signal).toBeDefined());s.dispose();expect(signal!.aborted).toBe(true);await Promise.resolve();expect(s.body.querySelector('textarea')).toBeNull();expect(s.api.runPdfOperation).not.toHaveBeenCalled();
});
