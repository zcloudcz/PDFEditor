import { mountFormPanel } from './form-panel';
import { mountAnnotationPanel } from './annotation-panel';
export interface StandardPdfToolsApi {
  readPdfSnapshot(): Promise<{ bytes: Uint8Array; revision: number }>;
  runPdfOperation(label: string, prepare: (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>, expectedRevision?: number, signal?: AbortSignal): Promise<void>;
  registerDocumentAction(label: string, callback: () => void): HTMLButtonElement;
  mountDocumentPanel(title: string, mount: (body: HTMLElement, close: () => void) => (() => void) | void): void;
  t?: (message: string) => string;
  getPageSurface?(): {container:HTMLElement;pageIndex:number;width:number;height:number;zoom:number}|null;
}
export function setupStandardPdfTools(api: StandardPdfToolsApi): void {
  api.registerDocumentAction('PDF formuláře', () => api.mountDocumentPanel('PDF formuláře', (body,close) => mountFormPanel(body, api,close)));
  api.registerDocumentAction('PDF komentáře', () => api.mountDocumentPanel('PDF komentáře', (body,close) => mountAnnotationPanel(body, api,close)));
}
export function panelButton(label: string, action: () => void, t: (s: string) => string): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = t(label); button.className = 'studio-button'; button.addEventListener('click', action); return button;
}
export function panelInput(body: HTMLElement, label: string, value: string, t: (s: string) => string, type = 'text'): HTMLInputElement {
  const wrapper = document.createElement('label'), span = document.createElement('span'), input = document.createElement('input'); span.textContent = t(label); input.type = type; input.value = value; wrapper.append(span, input); body.append(wrapper); return input;
}
export function downloadStandardFile(content: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function panelCloseGuard(body:HTMLElement):{setBusy(busy:boolean):void;dispose():void} {
  const dialog=body.closest('dialog'),button=dialog?.querySelector<HTMLButtonElement>(':scope > button');let busy=false;
  const cancel=(event:Event)=>{if(busy)event.preventDefault();};dialog?.addEventListener('cancel',cancel);
  return {setBusy(value){busy=value;if(button)button.disabled=value;},dispose(){dialog?.removeEventListener('cancel',cancel);if(button)button.disabled=false;}};
}
export function showStandardFailure(body:HTMLElement,t:(message:string)=>string):void {const alert=document.createElement('p');alert.setAttribute('role','alert');alert.textContent=t('Operace se nezdařila.');body.prepend(alert);}
