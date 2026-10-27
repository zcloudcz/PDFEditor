import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { PdfNavigationError } from './navigation';
import { loadBoundedObjectDocument as loadNavigationDocument } from './bounded-objects';
export interface PdfLayer { id: string; name: string; visible: boolean; exportState: 'ON' | 'OFF' | 'Unchanged' }
export type LayerChange = { id: string; name?: string; visible?: boolean; exportState?: PdfLayer['exportState'] } | { kind: 'order'; ids: readonly string[] };
const key = PDFName.of;
function fail(): never { throw new PdfNavigationError('unsupported-structure'); }
function check(signal?: AbortSignal): void { signal?.throwIfAborted(); }
function parse(doc: PDFDocument) {
 const raw = doc.catalog.get(key('OCProperties'));
 if (!raw) return null;
 const props = doc.context.lookup(raw); if (!(props instanceof PDFDict)) return fail();
 // Automatic usage application, radio groups, locked layers, alternate configs and nested orders need separate UI semantics.
 if (props.has(key('Configs'))) fail();
 const groups = props.lookupMaybe(key('OCGs'),PDFArray), config = props.lookupMaybe(key('D'),PDFDict);
 if (!groups || !config || groups.size()>1000 || ['AS','RBGroups','Locked'].some(k=>config.has(key(k)))) fail();
 const base = config.get(key('BaseState')) ?? key('ON'); if (base !== key('ON') && base !== key('OFF')) fail();
 const entries = groups.asArray().map(ref=>{
  if (!(ref instanceof PDFRef)) return fail();
  const dict=doc.context.lookup(ref); if (!(dict instanceof PDFDict) || dict.lookup(key('Type'))!==key('OCG')) return fail();
  const name=dict.lookup(key('Name')); if (!(name instanceof PDFString || name instanceof PDFHexString) || name.decodeText().length>1000) return fail();
  const usage=dict.lookupMaybe(key('Usage'),PDFDict), exp=usage?.lookupMaybe(key('Export'),PDFDict)?.get(key('ExportState'));
  if(exp && exp!==key('ON') && exp!==key('OFF')) return fail();
  return { ref, dict, id:ref.toString(), name:name.decodeText(), visible:base===key('ON'), exportState:(exp instanceof PDFName?exp.decodeText():'Unchanged') as PdfLayer['exportState'] };
 });
 if(new Set(entries.map(e=>e.id)).size!==entries.length) fail();
 const refs=(name:string)=>{
  const raw=config.get(key(name)); if(!raw) return [];
  const array=doc.context.lookup(raw); if(!(array instanceof PDFArray) || array.size()>1000) return fail();
  const ids=array.asArray().map(ref=>{if(!(ref instanceof PDFRef) || !entries.some(e=>e.id===ref.toString()))return fail();return ref.toString();});
  if(new Set(ids).size!==ids.length) fail(); return ids;
 };
 const on=refs('ON'),off=refs('OFF'); if(on.some(id=>off.includes(id))) fail();
 for(const entry of entries){if(on.includes(entry.id))entry.visible=true;if(off.includes(entry.id))entry.visible=false;}
 const order=refs('Order'); if(order.length && order.length!==entries.length) fail();
 const ordered=order.length?order.map(id=>entries.find(e=>e.id===id)!):entries;
 return {config,entries:ordered};
}
export async function inspectOptionalContent(bytes:Uint8Array,signal?:AbortSignal):Promise<PdfLayer[]> {
 check(signal);const doc=await loadNavigationDocument(bytes);check(signal);
 return parse(doc)?.entries.map(({id,name,visible,exportState})=>({id,name,visible,exportState}))??[];
}
export async function editOptionalContent(bytes:Uint8Array,changes:readonly LayerChange[],signal?:AbortSignal):Promise<Uint8Array>{
 if(!Array.isArray(changes) || changes.length>2000) throw new PdfNavigationError('invalid-change');
 changes=changes.map(change=>'kind' in change?{...change,ids:[...change.ids]}:{...change});
 check(signal);const doc=await loadNavigationDocument(bytes);check(signal);const parsed=parse(doc);
 if(!parsed || !Array.isArray(changes) || changes.length>2000) throw new PdfNavigationError('invalid-change');
 let entries=parsed.entries;
 for(const change of changes){
  check(signal);
  if('kind' in change){
   if(change.kind!=='order' || !Array.isArray(change.ids) || change.ids.length!==entries.length || new Set(change.ids).size!==entries.length) throw new PdfNavigationError('invalid-change');
   entries=change.ids.map((id:string)=>{const entry=entries.find(e=>e.id===id);if(!entry)throw new PdfNavigationError('invalid-change');return entry;});
  }else{
   const entry=entries.find(e=>e.id===change.id);if(!entry)throw new PdfNavigationError('invalid-change');
   if(change.name!==undefined){if(typeof change.name!=='string'|| !change.name.trim() || change.name.length>1000 || /[\u0000-\u001f\u007f]/.test(change.name))throw new PdfNavigationError('invalid-change');entry.dict.set(key('Name'),PDFHexString.fromText(change.name));}
   if(change.visible!==undefined){if(typeof change.visible!=='boolean')throw new PdfNavigationError('invalid-change');entry.visible=change.visible;}
   if(change.exportState!==undefined){
    if(!['ON','OFF','Unchanged'].includes(change.exportState))throw new PdfNavigationError('invalid-change');
    const previous=entry.dict.lookupMaybe(key('Usage'),PDFDict);
    const usage=previous?previous.clone():doc.context.obj({});
    const oldExport=usage.lookupMaybe(key('Export'),PDFDict);
    const exp=oldExport?oldExport.clone():doc.context.obj({});
    if(change.exportState==='Unchanged')exp.delete(key('ExportState'));
    else exp.set(key('ExportState'),key(change.exportState));
    if(exp.keys().length)usage.set(key('Export'),exp);else usage.delete(key('Export'));
    if(usage.keys().length)entry.dict.set(key('Usage'),usage);else entry.dict.delete(key('Usage'));
   }
  }
 }
 parsed.config.set(key('Order'),doc.context.obj(entries.map(e=>e.ref)));
 parsed.config.set(key('ON'),doc.context.obj(entries.filter(e=>e.visible).map(e=>e.ref)));
 parsed.config.set(key('OFF'),doc.context.obj(entries.filter(e=>!e.visible).map(e=>e.ref)));
 check(signal);const output=await doc.save({updateFieldAppearances:false});check(signal);return output;
}
