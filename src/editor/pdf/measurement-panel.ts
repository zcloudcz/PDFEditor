import { getDocument } from 'pdfjs-dist';
import { applyAnnotationChanges } from './annotations';
import { pickPdfPlacement } from './placement';
import { measureGeometry, assertSimpleMeasurementPolygon } from './measurements';
import { panelButton, panelInput, type StandardPdfToolsApi } from './standard-tools';

export function mountMeasurementPanel(body:HTMLElement,api:StandardPdfToolsApi,close:()=>void):()=>void {
  const t=api.t??((value:string)=>value);let alive=true,busy=false;
  const explanation=document.createElement('p');explanation.textContent=t('Zadejte kalibraci: počet PDF bodů (1/72 palce) na jednu jednotku. Bez kalibrace nelze určit skutečné rozměry. Táhněte na stránce; Escape zruší měření. Plocha a obvod automaticky uzavírají nakreslený polygon.');
  const controls=document.createElement('fieldset'),scale=panelInput(controls,'PDF bodů na jednotku','',t,'number'),unit=panelInput(controls,'Jednotka měření','',t);scale.min='0';scale.step='any';unit.maxLength=30;
  const kind=document.createElement('select');kind.setAttribute('aria-label',t('Typ měření'));
  for(const [value,label]of [['length','Délka'],['perimeter','Obvod'],['area','Plocha']]){const option=document.createElement('option');option.value=value;option.textContent=t(label);kind.append(option);}controls.append(kind);
  const status=document.createElement('p');status.setAttribute('role','status');
  const start=panelButton('Změřit na stránce',()=>{void run();},t);controls.append(start);body.append(explanation,controls,status);
  if(!api.getPageSurface){start.disabled=true;status.textContent=t('Nejprve otevřete PDF stránku.');}
  async function run():Promise<void>{
    if(busy||!alive||!api.getPageSurface)return;const calibration={pointsPerUnit:Number(scale.value),unit:unit.value},mode=kind.value;
    try{measureGeometry([{x:0,y:0},{x:1,y:1}],calibration);}catch{status.textContent=t('Zadejte platnou kalibraci a jednotku.');return;}
    busy=true;controls.disabled=true;
    try{
      const snapshot=await api.readPdfSnapshot();if(!alive)return;
      const getSurface=api.getPageSurface;close();
      let message=t('Měření zrušeno. Dokument se nezměnil.');
      try{
        const placement=await pickPdfPlacement(snapshot.bytes,getSurface,'ink',undefined,t('Nakreslete měřenou geometrii na stránce. Escape zruší akci.'));
        if(placement){
          const loading=getDocument({data:snapshot.bytes.slice(),isEvalSupported:false,verbosity:0});let userUnit:number;
          try{const doc=await loading.promise;userUnit=(await doc.getPage(placement.pageIndex+1)).userUnit;}finally{await loading.destroy();}
          const raw=placement.inkPaths[0],points=Array.from({length:raw.length/2},(_,i)=>({x:raw[i*2]*userUnit,y:raw[i*2+1]*userUnit}));
          const selected=mode==='length'?[points[0],points[points.length-1]]:points;
          if(mode!=='length'&&points.length<3)throw new Error('invalid-geometry');
          if(mode!=='length')assertSimpleMeasurementPolygon(points);
          const measurement=measureGeometry(selected,calibration),value=mode==='area'?measurement.area:mode==='perimeter'?measurement.perimeter:measurement.length,label=mode==='area'?'Plocha':mode==='perimeter'?'Obvod':'Délka';
          const contents=`${t(label)}: ${Number(value.toPrecision(8))} ${calibration.unit}${mode==='area'?'²':''}; ${t('Kalibrace')}: ${calibration.pointsPerUnit} pt/${calibration.unit}`;
          const line=mode==='length'?[raw[0],raw[1],raw[raw.length-2],raw[raw.length-1]]:[...raw,raw[0],raw[1]];
          await api.runPdfOperation('Měření PDF',(bytes,signal)=>applyAnnotationChanges(bytes,[{kind:'add',annotation:{pageIndex:placement.pageIndex,subtype:'Ink',rect:placement.rect,contents,color:[0,.4,.8],inkPaths:[line]}}],signal),snapshot.revision);
          message=`${t('Měření uloženo jako PDF anotace.')} ${contents}`;
        }
      }catch{message=t('Měření se nezdařilo. Dokument se nezměnil.');}
      api.mountDocumentPanel('Měření PDF',(next,nextClose)=>{const cleanup=mountMeasurementPanel(next,api,nextClose),result=document.createElement('p');result.setAttribute('role','status');result.textContent=message;next.prepend(result);return cleanup;});
    }catch{if(alive)status.textContent=t('Měření se nezdařilo. Dokument se nezměnil.');}
    finally{busy=false;if(alive)controls.disabled=false;}
  }
  return()=>{alive=false;};
}
