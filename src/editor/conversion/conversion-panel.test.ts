import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountConversionPanel } from './conversion-panel';
import type { LayoutToolsApi } from '../studio/layout-tools';
import type { StudioProject } from '../studio/types';
import { exportPdf } from '../studio/exports';
import { convertDocument } from './office-export';
import type { ConversionResult } from './conversion-profile';
vi.mock('../studio/exports', () => ({exportPdf: vi.fn(async () => new Uint8Array([1, 2]))}));
vi.mock('./office-export', () => ({convertDocument: vi.fn()}));
vi.mock('./table-extraction', () => ({extractTables: vi.fn(async () => [])}));
const result: ConversionResult = {files:[{name:'converted.docx',blob:new Blob(['Office'])}],report:{profile:'test',preserved:1,editable:2,rasterized:0,limitations:[]}};
let revision = 1;
let anchor: ReturnType<typeof vi.spyOn>;
const project: StudioProject = {version:1,name:'Synthetic',pages:[{id:'page',name:'Page',width:600,height:800,background:'#ffffff',objects:[]}]};
function fixture() {
  const body = document.createElement('div'); document.body.append(body);
  const api = {readProjectSnapshot:async()=>({project:structuredClone(project),revision,view:{selectedIds:[] as string[]}})} as unknown as LayoutToolsApi;
  return {body, dispose:mountConversionPanel(body,api), start:()=>[...body.querySelectorAll('button')].find(b=>b.textContent==='Převést a stáhnout')!.click()};
}
beforeEach(()=>{revision=1;vi.mocked(convertDocument).mockReset();vi.mocked(convertDocument).mockResolvedValue(result);vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()});anchor=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});});
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('converts the merged project and reports editable and rasterized counts',async()=>{
  const f=fixture();f.start();await vi.waitFor(()=>expect(f.body.textContent).toContain('Převod dokončen.'));
  expect(exportPdf).toHaveBeenCalledWith(project);expect(anchor).toHaveBeenCalledTimes(1);
  expect(f.body.textContent).toContain('Upravitelné prvky: 2');expect(f.body.textContent).toContain('Rastrované stránky: 0');f.dispose();
});
it('does not download a result after another document revision replaces the source',async()=>{
  let finish!:(r:ConversionResult)=>void;vi.mocked(convertDocument).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const f=fixture();f.start();await vi.waitFor(()=>expect(convertDocument).toHaveBeenCalledTimes(1));revision++;finish(result);
  await vi.waitFor(()=>expect(f.body.textContent).toContain('Operace se nezdařila.'));expect(anchor).not.toHaveBeenCalled();f.dispose();
});
it('aborts pending conversion and never downloads after panel disposal',async()=>{
  let finish!:(r:ConversionResult)=>void;vi.mocked(convertDocument).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const f=fixture();f.start();await vi.waitFor(()=>expect(convertDocument).toHaveBeenCalledTimes(1));f.dispose();
  expect(vi.mocked(convertDocument).mock.calls[0][2].aborted).toBe(true);finish(result);await new Promise(resolve=>setTimeout(resolve,0));expect(anchor).not.toHaveBeenCalled();
});
