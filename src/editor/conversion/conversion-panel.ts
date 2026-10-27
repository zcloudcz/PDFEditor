import { exportPdf } from '../studio/exports';
import type { LayoutToolsApi } from '../studio/layout-tools';
import { panelButton, panelCloseGuard } from '../pdf/standard-tools';
import { mountDataPanel } from '../data/data-panel';
import type { DataTable } from '../data/table';
import { convertDocument } from './office-export';
import { extractTables } from './table-extraction';
import type { ConversionRequest, ConversionReport } from './conversion-profile';

export function setupConversionTools(api: LayoutToolsApi): void {
  api.registerDocumentAction('Office a tabulky', () => api.mountDocumentPanel('Office a tabulky', body => mountConversionPanel(body, api)));
}
export function mountConversionPanel(body: HTMLElement, api: LayoutToolsApi): () => void {
  const t = api.t ?? ((s: string) => s), guard = panelCloseGuard(body), controls = document.createElement('fieldset');
  const status = document.createElement('p'), editor = document.createElement('div'); status.setAttribute('role', 'status');
  for (const message of ['Převod používá lokální omezený profil. Upravitelný režim může změnit rozložení a vynechat vektorovou kresbu. Režim věrného obrazu výslovně převádí stránky na obrázky.', 'Import dokumentů Office vyžaduje samostatný auditovaný lokální převodník; v tomto režimu není dostupný.']) {
    const p = document.createElement('p'); p.textContent = t(message); body.append(p);
  }
  function select(label: string, options: [string, string][]) {
    const wrapper = document.createElement('label'), caption = document.createElement('span'), input = document.createElement('select'); caption.textContent = t(label);
    for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = t(text); input.append(option); }
    wrapper.append(caption, input); controls.append(wrapper); return input;
  }
  const format = select('Formát', [['docx','DOCX'],['xlsx','XLSX'],['csv','CSV'],['pptx','PPTX']]);
  const mode = select('Režim', [['editable','Upravitelný obsah'],['fidelity','Věrný obraz stránky (rastrování)']]);
  const tableSelect = select('Zkontrolované tabulky', []);
  let alive = true, running: AbortController | undefined, tableRevision = -1, tables: DataTable[] = [], report: ConversionReport | undefined;
  let disposeTable: (() => void) | undefined;
  const download = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000); };
  const cancel = panelButton('Zrušit operaci', () => running?.abort(), t); cancel.disabled = true;
  const reportButton = panelButton('Stáhnout report převodu', () => { if (report) download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'conversion-report.json'); },t); reportButton.disabled = true;
  async function ensureCurrent(revision: number, signal: AbortSignal) {
    signal.throwIfAborted(); const current = await api.readProjectSnapshot(); signal.throwIfAborted();
    if (!alive || current.revision !== revision) throw new Error('stale');
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (!alive || running) return;
    const controller = new AbortController(); running = controller; controls.disabled = true; cancel.disabled = false; guard.setBusy(true);
    report = undefined; reportButton.disabled = true;
    try { await action(controller.signal); }
    catch { if (alive) status.textContent = t(controller.signal.aborted ? 'Operace zrušena.' : 'Operace se nezdařila.'); }
    finally { running = undefined; if (alive) { controls.disabled = false; cancel.disabled = true; guard.setBusy(false); } }
  }
  function showTable() {
    disposeTable?.(); editor.replaceChildren(); const index = Number(tableSelect.value); if (!tables[index]) return;
    disposeTable = mountDataPanel(editor,{getTable:()=>tables[index],onTableChange:table=>{tables[index]=table;},onError:()=>{status.textContent=t('Operace se nezdařila.');},labels:{cell:t('Buňka'),previous:t('Předchozí'),next:t('Další'),page:t('Stránka')}});
  }
  tableSelect.addEventListener('change',showTable);
  controls.append(panelButton('Vyhledat tabulky',()=>{void run(async signal=>{
    const snapshot=await api.readProjectSnapshot(), bytes=await exportPdf(snapshot.project); signal.throwIfAborted();
    const candidates=await extractTables(bytes,undefined,signal); await ensureCurrent(snapshot.revision,signal);
    tables=candidates;tableRevision=snapshot.revision;tableSelect.replaceChildren();
    tables.forEach((table,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=table.id;tableSelect.append(option);});
    showTable();status.textContent=t('Před převodem tabulky zkontrolujte a opravte buňky.');
  });},t),editor);
  controls.append(panelButton('Převést a stáhnout',()=>{void run(async signal=>{
    const snapshot=await api.readProjectSnapshot(), selectedFormat=format.value as ConversionRequest['format'];
    const request:ConversionRequest={format:selectedFormat,mode:mode.value as 'editable'|'fidelity'};
    if(selectedFormat==='xlsx'||selectedFormat==='csv'){
      const table=tables[Number(tableSelect.value)];if(!table||tableRevision!==snapshot.revision)throw new Error('tables-require-review');
      request.tables=[structuredClone(table)];
    }
    const bytes=await exportPdf(snapshot.project);signal.throwIfAborted();
    const output=await convertDocument(new Blob([bytes.slice().buffer as ArrayBuffer],{type:'application/pdf'}),request,signal);
    await ensureCurrent(snapshot.revision,signal);report=output.report;
    status.textContent=`${t('Převod dokončen.')} ${t('Zachované prvky')}: ${report.preserved}; ${t('Upravitelné prvky')}: ${report.editable}; ${t('Rastrované stránky')}: ${report.rasterized}.`;
    for(const file of output.files)download(file.blob,file.name);reportButton.disabled=false;
  });},t),reportButton);
  body.append(controls,cancel,status);
  return ()=>{alive=false;running?.abort();disposeTable?.();tableSelect.removeEventListener('change',showTable);guard.dispose();};
}
