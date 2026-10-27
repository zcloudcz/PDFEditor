import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { editAttachments, exportAttachment, listAttachments, type PdfAttachment, type AttachmentChange } from './attachments';
import { PdfNavigationError } from './navigation';
import { loadBoundedObjectDocument as loadNavigationDocument } from './bounded-objects';
export interface PortfolioItem { filename:string; bytes:Uint8Array; mimeType?:string; description?:string }
export interface PortfolioEntry extends PdfAttachment { description:string }
export type PortfolioChange = AttachmentChange | {kind:'metadata';id:string;description:string};
const key=PDFName.of;
function descriptionValid(value:string):void{if(typeof value!=='string'||value.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new PdfNavigationError('invalid-change');}
function spec(doc:PDFDocument,id:string):PDFDict{const match=/^(\d+) (\d+) R$/.exec(id);if(!match)throw new PdfNavigationError('invalid-change');const value=doc.context.lookup(PDFRef.of(Number(match[1]),Number(match[2])));if(!(value instanceof PDFDict))throw new PdfNavigationError('invalid-change');return value;}
function collection(doc:PDFDocument):void{
 const raw=doc.catalog.get(key('Collection'));if(!raw)return;
 const value=doc.context.lookup(raw);if(!(value instanceof PDFDict))throw new PdfNavigationError('unsupported-structure');
 // Custom collection schemas/sorts/folders require field-aware authoring; preserve by refusing edits.
 if(value.keys().some(k=>!['Type','View','D'].includes(k.decodeText())))throw new PdfNavigationError('unsupported-structure');
 const view=value.get(key('View'));if(view && !['D','T','H'].some(v=>view===key(v)))throw new PdfNavigationError('unsupported-structure');
}
export async function listPortfolio(bytes:Uint8Array,signal?:AbortSignal):Promise<PortfolioEntry[]>{
 bytes=bytes.slice();
 signal?.throwIfAborted();const doc=await loadNavigationDocument(bytes);collection(doc);const entries=await listAttachments(bytes);signal?.throwIfAborted();
 return entries.map(entry=>{const value=spec(doc,entry.id).lookup(key('Desc'));if(value && !(value instanceof PDFString||value instanceof PDFHexString))throw new PdfNavigationError('unsupported-structure');return {...entry,description:value instanceof PDFString||value instanceof PDFHexString?value.decodeText():''};});
}
export async function extractPortfolioItem(bytes:Uint8Array,id:string,signal?:AbortSignal){signal?.throwIfAborted();bytes=bytes.slice();await listPortfolio(bytes,signal);const result=await exportAttachment(bytes,id);signal?.throwIfAborted();return result;}
export async function editPortfolio(bytes:Uint8Array,change:PortfolioChange,signal?:AbortSignal):Promise<Uint8Array>{
 change=change.kind==='import'?{...change,bytes:change.bytes.slice()}:{...change};
 signal?.throwIfAborted();const input=bytes.slice();const entries=await listPortfolio(input,signal);
 if(change.kind==='metadata'){
  if(!entries.some(e=>e.id===change.id))throw new PdfNavigationError('invalid-change');descriptionValid(change.description);
  const doc=await loadNavigationDocument(input);spec(doc,change.id).set(key('Desc'),PDFHexString.fromText(change.description));
  const output=await doc.save({updateFieldAppearances:false});signal?.throwIfAborted();return output;
 }
 const output=await editAttachments(input,change);signal?.throwIfAborted();
 if(change.kind==='import'){
  const doc=await loadNavigationDocument(output);signal?.throwIfAborted();
  if(!doc.catalog.has(key('Collection'))){
   doc.catalog.set(key('Collection'),doc.context.obj({Type:'Collection',View:'D'}));
   const saved=await doc.save({updateFieldAppearances:false});signal?.throwIfAborted();return saved;
  }
  return output;
 }
 // Removing the selected initial file must not retain a dangling Collection/D filename.
 if(change.kind==='remove'){
  const doc=await loadNavigationDocument(output);const col=doc.catalog.lookupMaybe(key('Collection'),PDFDict);const initial=col?.lookup(key('D'));
  if(initial instanceof PDFString||initial instanceof PDFHexString){if(entries.find(e=>e.id===change.id)?.filename===initial.decodeText())col?.delete(key('D'));}
  const saved=await doc.save({updateFieldAppearances:false});signal?.throwIfAborted();return saved;
 }
 return output;
}
export async function buildPortfolio(items:readonly PortfolioItem[],signal?:AbortSignal):Promise<Uint8Array>{
 signal?.throwIfAborted();if(!Array.isArray(items)||items.length>100)throw new PdfNavigationError('limit-exceeded');
 // Capture caller-owned bytes before the first asynchronous operation.
 let total=0;
 const captured=items.map(item=>{if(!(item.bytes instanceof Uint8Array))throw new PdfNavigationError('invalid-change');total+=item.bytes.length;if(item.bytes.length>20*1024*1024||total>50*1024*1024)throw new PdfNavigationError('limit-exceeded');if(item.description!==undefined)descriptionValid(item.description);return {...item,bytes:item.bytes.slice()};});
 const doc=await PDFDocument.create();doc.addPage();doc.catalog.set(key('Collection'),doc.context.obj({Type:'Collection',View:'D'}));
 let output=await doc.save();
 for(const item of captured){signal?.throwIfAborted();output=await editPortfolio(output,{kind:'import',filename:item.filename,bytes:item.bytes,mimeType:item.mimeType},signal);if(item.description){const entry=(await listPortfolio(output,signal)).find(e=>e.filename===item.filename)!;output=await editPortfolio(output,{kind:'metadata',id:entry.id,description:item.description},signal);}}
 signal?.throwIfAborted();return output;
}
