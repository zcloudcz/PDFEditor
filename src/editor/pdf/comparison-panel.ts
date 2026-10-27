import { comparePdf, COMPARISON_LIMITS, type ComparisonReport } from './compare';
import { downloadStandardFile, panelButton, panelInput, type StandardPdfToolsApi } from './standard-tools';

export function mountComparisonPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const t=api.t??((value:string)=>value);let alive=true,controller:AbortController|undefined,report:ComparisonReport|undefined,index=0;
  const explanation=document.createElement('p');explanation.textContent=t('Porovnání probíhá lokálně a nemění dokument. Nejvýše 200 stránek a 50 MiB na PDF. Náhledy do 1024 px mohou vynechat velmi drobné změny.');
  const controls=document.createElement('fieldset'),file=panelInput(controls,'Druhé PDF pro porovnání','',t,'file');file.accept='.pdf,application/pdf';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const result=document.createElement('section');result.setAttribute('aria-label',t('Změny dokumentu'));
  const cancel=panelButton('Zrušit porovnání',()=>controller?.abort(),t);cancel.disabled=true;
  const start=panelButton('Porovnat PDF',()=>{void run();},t);controls.append(start);body.append(explanation,controls,cancel,status,result);
  const kindLabels={inserted:'Vložená stránka',deleted:'Smazaná stránka',changed:'Změněná stránka',unchanged:'Beze změny'};
  function show():void {
    if(!report||!alive)return;result.replaceChildren();
    const changes=report.pages.filter(page=>page.kind!=='unchanged'),summary=document.createElement('p');summary.textContent=`${t('Počet změněných stránek')}: ${changes.length} / ${report.pages.length}`;result.append(summary);
    result.append(panelButton('Stáhnout report JSON',()=>{if(report)downloadStandardFile(JSON.stringify(report,null,2),'application/json','comparison.json');},t));
    if(!changes.length)return;index=Math.max(0,Math.min(index,changes.length-1));const page=changes[index];
    const previous=panelButton('Předchozí změna',()=>{index--;show();},t),next=panelButton('Další změna',()=>{index++;show();},t);previous.disabled=index===0;next.disabled=index===changes.length-1;result.append(previous,next);
    const title=document.createElement('h3');title.textContent=`${index+1}/${changes.length} · ${t(kindLabels[page.kind])} · ${t('Původní stránka')}: ${page.beforePage??'—'} → ${t('Nová stránka')}: ${page.afterPage??'—'}`;result.append(title);
    if(page.visual){const visual=document.createElement('p');visual.textContent=`${t('Vizuální změna')}: ${(page.visual.fraction*100).toFixed(3)} % · ${t('Oblast změny v pixelech')}: ${page.visual.bounds?.join(', ')??'—'}`;result.append(visual);}
    if(page.geometryChanged&&page.beforeDimensions&&page.afterDimensions){const geometry=document.createElement('p');geometry.textContent=`${t('Vizuální změna')}: ${page.beforeDimensions.map(value=>Number(value.toFixed(3))).join(' × ')} pt → ${page.afterDimensions.map(value=>Number(value.toFixed(3))).join(' × ')} pt`;result.append(geometry);}
    for(const [label,text] of [['Původní text',page.beforeText],['Nový text',page.afterText]]){const wrapper=document.createElement('label'),caption=document.createElement('span'),area=document.createElement('textarea');caption.textContent=t(label);area.readOnly=true;area.value=text;wrapper.append(caption,area);result.append(wrapper);}
  }
  async function run():Promise<void>{
    if(!alive||controller)return;const chosen=file.files?.[0];if(!chosen){status.textContent=t('Vyberte druhé lokální PDF.');return;}
    if(chosen.size>COMPARISON_LIMITS.bytes){status.textContent=t('PDF překračuje limit porovnání.');return;}
    const abort=new AbortController();controller=abort;controls.disabled=true;cancel.disabled=false;report=undefined;result.replaceChildren();body.setAttribute('aria-busy','true');status.textContent=t('Probíhá lokální porovnání…');
    try{
      const snapshot=await api.readPdfSnapshot();abort.signal.throwIfAborted();const second=new Uint8Array(await chosen.arrayBuffer());abort.signal.throwIfAborted();
      const compared=await comparePdf(snapshot.bytes,second,abort.signal,(done,total)=>{if(alive)status.textContent=`${t('Porovnáno kroků')}: ${done}/${total}`;});
      if(alive){report=compared;index=0;show();status.textContent=t('Porovnání dokončeno. Report patří zachycené revizi dokumentu.');}
    }catch{if(alive)status.textContent=abort.signal.aborted?t('Porovnání zrušeno. Dokument se nezměnil.'):t('Porovnání se nezdařilo. Zkontrolujte platnost PDF a limity.');}
    finally{controller=undefined;if(alive){controls.disabled=false;cancel.disabled=true;body.removeAttribute('aria-busy');}}
  }
  return()=>{alive=false;controller?.abort();report=undefined;};
}
