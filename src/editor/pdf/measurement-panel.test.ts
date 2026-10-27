import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mountMeasurementPanel } from './measurement-panel';
import { pickPdfPlacement } from './placement';
import { getDocument } from 'pdfjs-dist';
import type { StandardPdfToolsApi } from './standard-tools';
vi.mock('./placement',()=>({pickPdfPlacement:vi.fn()}));
vi.mock('pdfjs-dist',()=>({getDocument:vi.fn()}));
afterEach(()=>{document.body.replaceChildren();vi.clearAllMocks();});

describe('measurement panel shared transaction',()=>{
  async function setup(){
    const doc=await PDFDocument.create();doc.addPage([200,300]);const bytes=await doc.save();let output:Uint8Array|undefined;
    const body=document.createElement('div');document.body.append(body);const close=vi.fn(),mount=vi.fn();
    const api:StandardPdfToolsApi={readPdfSnapshot:vi.fn(async()=>({bytes,revision:7})),runPdfOperation:vi.fn(async(_label,prepare,revision)=>{expect(revision).toBe(7);output=await prepare(bytes,new AbortController().signal);}),registerDocumentAction:vi.fn(),mountDocumentPanel:mount,getPageSurface:()=>null};
    const dispose=mountMeasurementPanel(body,api,close);return{body,api,close,mount,dispose,getOutput:()=>output,bytes};
  }
  const start=(body:HTMLElement)=>Array.from(body.querySelectorAll('button')).find(button=>button.textContent==='Změřit na stránce')!.click();
  function calibrate(body:HTMLElement){body.querySelector<HTMLInputElement>('input[type=number]')!.value='10';body.querySelector<HTMLInputElement>('input[type=text]')!.value='cm';}
  it('requires calibration before closing or mutating the document',async()=>{const s=await setup();start(s.body);await Promise.resolve();expect(s.close).not.toHaveBeenCalled();expect(s.api.runPdfOperation).not.toHaveBeenCalled();expect(s.body.textContent).toContain('Zadejte platnou kalibraci');});
  it('captures on the existing surface and writes a real Ink annotation with explicit calibration',async()=>{
    const s=await setup();calibrate(s.body);
    vi.mocked(pickPdfPlacement).mockResolvedValue({pageIndex:0,rect:[19,19,32,42],quadPoints:[],inkPaths:[[20,20,50,60]]});
    vi.mocked(getDocument).mockReturnValue({promise:Promise.resolve({getPage:async()=>({userUnit:2})}),destroy:async()=>{}} as unknown as ReturnType<typeof getDocument>);
    start(s.body);await vi.waitFor(()=>expect(s.api.runPdfOperation).toHaveBeenCalledTimes(1));await vi.waitFor(()=>expect(s.getOutput()).toBeDefined());
    expect(s.close).toHaveBeenCalledOnce();const output=await PDFDocument.load(s.getOutput()!);const annotation=output.getPage(0).node.Annots()!.lookup(0);
    expect(annotation.toString()).toContain('/Subtype /Ink');expect(annotation.toString()).toContain('/InkList');expect(annotation.toString()).toContain('/Contents');
    const input=await PDFDocument.load(s.bytes);expect(input.getPage(0).node.Annots()).toBeUndefined();
  });
  it('Escape/cancel produces no operation and reopens the task panel',async()=>{const s=await setup();calibrate(s.body);vi.mocked(pickPdfPlacement).mockResolvedValue(null);start(s.body);await vi.waitFor(()=>expect(s.mount).toHaveBeenCalled());expect(s.api.runPdfOperation).not.toHaveBeenCalled();});
});
