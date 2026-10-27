import { applyFormChanges, exportFormValues, exportFormValuesFdf, exportFormValuesXfdf, importFormValues, importFormValuesFdf, importFormValuesXfdf, readFormFields } from './forms';
import { pickPdfPlacement } from './placement';
import type { FormChange, FormKind } from './form-types';
import { downloadStandardFile, panelButton, panelCloseGuard, panelInput, showStandardFailure, type StandardPdfToolsApi } from './standard-tools';
export function mountFormPanel(body: HTMLElement, api: StandardPdfToolsApi,close:()=>void=()=>{}): () => void {
  const t = api.t ?? ((s: string): string => s); let alive = true, busy = false;
  const status = document.createElement('p'); status.setAttribute('role', 'status'); body.append(status);
  const content = document.createElement('div'); content.className='studio-page-manager'; body.append(content);
  const guard=panelCloseGuard(body);
  const run = async (operation: () => Promise<void>) => { if (busy||!alive) return; busy = true;guard.setBusy(true); body.setAttribute('aria-busy', 'true'); content.inert = true; try { await operation(); } catch { if (alive) status.textContent = t('Operace se nezdařila.'); } finally { busy = false;guard.setBusy(false); content.inert = false; body.removeAttribute('aria-busy'); } };
  const refresh = async () => {
    const snapshot = await api.readPdfSnapshot(), fields = await readFormFields(snapshot.bytes); if (!alive) return; content.replaceChildren(); status.textContent = t('Hodnoty se ukládají do standardních PDF polí.');
    const apply = (changes: FormChange[]): void => { void run(async () => { await api.runPdfOperation('PDF formuláře', (bytes, signal) => applyFormChanges(bytes, changes, { signal }), snapshot.revision); await refresh(); }); };
    for (const field of fields) {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = field.name; row.append(legend); content.append(row);
      if (field.kind === 'unsupported') { const info = document.createElement('p'); info.textContent = t('Nepodporovaný typ pole'); row.append(info); continue; }
      const label = document.createElement('label'); label.textContent = t('Hodnota');
      let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (field.kind === 'radio' || field.kind === 'choice') { const select = document.createElement('select'); for (const value of ['', ...field.options]) { const o = document.createElement('option'); o.value = value; o.textContent = value; select.append(o); } select.multiple=!!field.multiSelect;if(select.multiple){for(const option of select.options)option.selected=Array.isArray(field.value)&&field.value.includes(option.value);}else select.value = Array.isArray(field.value) ? field.value[0] ?? '' : String(field.value); input = select; }
      else if(field.kind==='text'&&field.multiline){const control=document.createElement('textarea');control.value=String(field.value);input=control;}
      else { const control = document.createElement('input'); control.type = field.kind === 'checkbox' ? 'checkbox' : 'text'; if (field.kind === 'checkbox') control.checked = field.value === true; else control.value = String(field.value); input = control; }
      input.disabled = field.readOnly; input.required = field.required; label.append(input); row.append(label);
      const save = panelButton('Uložit hodnotu', () => apply([{ kind: 'set-value', id: field.id, value: input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : field.kind === 'choice' && input instanceof HTMLSelectElement ? Array.from(input.selectedOptions).map(o=>o.value).filter(Boolean) : input.value }]), t); save.disabled = field.readOnly; row.append(save);
      const ro = panelInput(row, 'Pouze pro čtení', '', t, 'checkbox'), required = panelInput(row, 'Povinné pole', '', t, 'checkbox'); ro.checked = field.readOnly; required.checked = field.required;
      row.append(panelButton('Uložit vlastnosti', () => apply([{ kind: 'properties', id: field.id, readOnly: ro.checked, required: required.checked }]), t), panelButton('Smazat pole', () => apply([{ kind: 'remove', id: field.id }]), t));
      field.widgets.forEach((widget, widgetIndex) => {
        const coords = panelInput(row, 'Obdélník PDF v bodech (x,y,šířka,výška)', widget.rect.join(','), t);
        row.append(panelButton('Přesunout pole', () => apply([{ kind: 'move', id: field.id, widgetIndex, rect: coords.value.split(',').map(Number) as [number,number,number,number] }]), t));
      });
    }
    const create = document.createElement('fieldset'); content.append(create); const name = panelInput(create, 'Název nového pole', '', t), page = panelInput(create, 'Stránka', '1', t, 'number'), rect = panelInput(create, 'Obdélník PDF v bodech (x,y,šířka,výška)', '40,40,150,24', t), choices = panelInput(create, 'Volby oddělené čárkou', 'Ano,Ne', t);
    const type = document.createElement('select'); type.setAttribute('aria-label', t('Typ pole')); for (const [value, label] of [['text','Text'], ['checkbox','Zaškrtávací pole'], ['radio','Přepínače'], ['choice','Výběr']]) { const o = document.createElement('option'); o.value = value; o.textContent = t(label); type.append(o); } create.append(type);
    const draft=()=>({kind:'create' as const,name:name.value,fieldKind:type.value as FormKind,pageIndex:Number(page.value)-1,rect:rect.value.split(',').map(Number) as [number,number,number,number],options:choices.value.split(',').map(s=>s.trim())});
    create.append(panelButton('Vytvořit pole', () => apply([draft()]), t));
    if(api.getPageSurface)create.append(panelButton('Umístit na stránku',()=>{const change=draft();close();void(async()=>{let failed=false;try{const placement=await pickPdfPlacement(snapshot.bytes,api.getPageSurface!,'rectangle',undefined,t('Umístěte prvek na stránku. Escape zruší akci.'));if(placement)await api.runPdfOperation('PDF formuláře',(bytes,signal)=>applyFormChanges(bytes,[{...change,pageIndex:placement.pageIndex,rect:placement.rect}],{signal}),snapshot.revision);}catch{failed=true;}finally{api.mountDocumentPanel('PDF formuláře',(next,nextClose)=>{const cleanup=mountFormPanel(next,api,nextClose);if(failed)showStandardFailure(next,t);return cleanup;});}})();},t));
    const tabsPage=panelInput(content,'Stránka','1',t,'number');content.append(panelButton('Pořadí polí po řádcích',()=>apply([{kind:'tab-order',pageIndex:Number(tabsPage.value)-1,order:'row'}]),t),panelButton('Pořadí polí po sloupcích',()=>apply([{kind:'tab-order',pageIndex:Number(tabsPage.value)-1,order:'column'}]),t));
    content.append(panelButton('Export hodnot JSON', () => downloadStandardFile(exportFormValues(fields), 'application/json', 'form-values.json'), t),panelButton('Export hodnot FDF',()=>downloadStandardFile(exportFormValuesFdf(fields),'application/vnd.fdf','form-values.fdf'),t),panelButton('Export hodnot XFDF',()=>downloadStandardFile(exportFormValuesXfdf(fields),'application/vnd.adobe.xfdf','form-values.xfdf'),t));
    const upload = panelInput(content, 'Import hodnot JSON/FDF/XFDF', '', t, 'file'); upload.accept = '.json,.fdf,.xfdf'; upload.addEventListener('change', () => void run(async () => { const file = upload.files?.[0]; if (!file) return;if(file.size>1024*1024)throw new Error('limit-exceeded');const changes=file.name.toLowerCase().endsWith('.fdf')?await importFormValuesFdf(new Uint8Array(await file.arrayBuffer()),fields):file.name.toLowerCase().endsWith('.xfdf')?importFormValuesXfdf(await file.text(),fields):importFormValues(await file.text(), fields); await api.runPdfOperation('PDF formuláře', (bytes, signal) => applyFormChanges(bytes, changes, { signal }), snapshot.revision); await refresh(); }));
  };
  void run(refresh); return () => { alive = false;guard.dispose(); };
}



