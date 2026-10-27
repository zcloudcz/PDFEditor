import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mountOcrPanel } from './ocr-panel';
import type { StandardPdfToolsApi } from './standard-tools';
import { recognizePages } from './ocr-service';

vi.mock('./ocr-service', () => ({ recognizePages: vi.fn() }));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('OCR panel transaction cancellation', () => {
  it('previews confidence and corrections without a PDF mutation, then applies corrected lines with the captured revision', async () => {
    const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
    const applyOcrReconstruction=vi.fn().mockResolvedValue(undefined),runPdfOperation=vi.fn();
    vi.mocked(recognizePages).mockResolvedValue({pdfBytes:bytes,pages:[{pageIndex:0,text:'bad',confidence:65,width:200,height:300,toDisplay:(x,y)=>[x,y],blocks:{width:200,height:300,dpi:72,lines:[{bbox:{x0:10,y0:10,x1:110,y1:30},baseline:{slope:0,intercept:0},textangle:0,direction:'ltr',injectWordBreaks:true,words:[{text:'bad',confidence:65,bbox:{x0:10,y0:10,x1:110,y1:30}}]}]}}]});
    const body=document.createElement('div');document.body.append(body);
    const cleanup=mountOcrPanel(body,{readPdfSnapshot:async()=>({bytes,revision:7}),runPdfOperation,registerDocumentAction:vi.fn(),mountDocumentPanel:vi.fn(),applyOcrReconstruction});
    const button=(text:string)=>[...body.querySelectorAll('button')].find(item=>item.textContent===text)!;
    button('Náhled a oprava OCR').click();await vi.waitFor(()=>expect(body.querySelector('[data-low-confidence]')).not.toBeNull());
    expect(runPdfOperation).not.toHaveBeenCalled();expect(applyOcrReconstruction).not.toHaveBeenCalled();
    const correction=body.querySelector<HTMLTextAreaElement>('[data-low-confidence] textarea')!;correction.value='corrected';correction.dispatchEvent(new Event('input'));
    button('Použít editovatelnou rekonstrukci').click();await vi.waitFor(()=>expect(applyOcrReconstruction).toHaveBeenCalled());
    expect(applyOcrReconstruction.mock.calls[0][0]).toMatchObject({revision:7,pages:[{lines:[{text:'corrected',confidence:65}]}]});cleanup();
  });
  async function mount() {
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    let finish!: () => void;
    const run = vi.fn((_label: string, _prepare: (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>, _revision?: number, _signal?: AbortSignal) => new Promise<void>(resolve => { finish = resolve; }));
    const api: StandardPdfToolsApi = {
      readPdfSnapshot: vi.fn(async () => ({ bytes, revision: 5 })), runPdfOperation: run,
      registerDocumentAction: vi.fn(() => document.createElement('button')), mountDocumentPanel: vi.fn(),
    };
    const body = document.createElement('div'); document.body.append(body);
    const cleanup = mountOcrPanel(body, api);
    const button = (text: string) => [...body.querySelectorAll('button')].find(item => item.textContent === text)!;
    button('Spustit OCR').click(); await vi.waitFor(() => expect(run).toHaveBeenCalled());
    return { run, body, button, finish: () => finish(), cleanup };
  }
  it('passes the local abort signal through the host and reports a late successful commit accurately', async () => {
    const panel = await mount();
    const signal = panel.run.mock.calls[0][3];
    expect(signal).toBeInstanceOf(AbortSignal);
    panel.button('Zrušit OCR').click(); expect(signal?.aborted).toBe(true);
    panel.finish();
    await vi.waitFor(() => expect(panel.body.querySelector('[role=status]')?.textContent).toBe('OCR dokončeno. Zkontrolujte rozpoznaný text.'));
    panel.cleanup();
  });
});
