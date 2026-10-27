import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import { PdfNavigationError } from './navigation';
import { loadBoundedObjectDocument as loadNavigationDocument, decodeObjectStream } from './bounded-objects';
export interface MediaDescriptor { id:string; pageIndex:number; subtype:'Sound'|'Movie'|'3D'|'RichMedia'|'Screen'; format:string; extractable:boolean; reason?:string }
const key=PDFName.of, maxMedia=20*1024*1024;
interface Entry { descriptor:MediaDescriptor; stream?:PDFRawStream }
function fail():never{throw new PdfNavigationError('unsupported-structure');}
function parse(doc:PDFDocument):Entry[]{
 const entries:Entry[]=[];let annotationCount=0;
 for(const [pageIndex,page] of doc.getPages().entries()){
  const raw=page.node.get(key('Annots'));if(!raw)continue;
  const annots=doc.context.lookup(raw);if(!(annots instanceof PDFArray)||annots.size()>10000)fail();
  annotationCount+=annots.size();if(annotationCount>10000)throw new PdfNavigationError('limit-exceeded');
  for(const [index,rawAnnot] of annots.asArray().entries()){
   const annot=doc.context.lookup(rawAnnot);if(!(annot instanceof PDFDict))fail();
   const subtype=annot.lookup(key('Subtype'));if(!(subtype instanceof PDFName))fail();
   const name=subtype.decodeText();if(!['Sound','Movie','3D','RichMedia','Screen'].includes(name))continue;
   if(entries.length>=100)throw new PdfNavigationError('limit-exceeded');
   const descriptor:MediaDescriptor={id:`media:${pageIndex}:${index}`,pageIndex,subtype:name as MediaDescriptor['subtype'],format:'unknown',extractable:false};
   let stream:PDFRawStream|undefined;
   const unsupported=(reason:string)=>{descriptor.reason=reason;};
   if(name==='Sound'){
    const object=annot.lookup(key('Sound'));if(!(object instanceof PDFRawStream) || object.dict.lookup(key('Type'))!==key('Sound'))fail();
    const rate=object.dict.lookup(key('R'));
    if(!(rate instanceof PDFNumber)||!Number.isFinite(rate.asNumber())||rate.asNumber()<=0)fail();
    stream=object;descriptor.format='PDF sound stream';descriptor.extractable=true;
   }else if(name==='3D'){
    const object=annot.lookup(key('3DD'));
    if(!(object instanceof PDFRawStream))unsupported('3D reference dictionaries are preserved; extraction is unsupported');
    else{
     if(object.dict.lookup(key('Type'))!==key('3D'))fail();
     const format=object.dict.lookup(key('Subtype'));
     if(format!==key('U3D')&&format!==key('PRC'))unsupported('Unsupported 3D stream subtype');
     else{stream=object;descriptor.format=(format as PDFName).decodeText();descriptor.extractable=true;}
    }
   }else if(name==='Movie'){
    const movie=annot.lookup(key('Movie'));if(!(movie instanceof PDFDict))fail();const file=movie.lookup(key('F'));
    if(file instanceof PDFString||file instanceof PDFHexString)unsupported('External movie reference; no file access is performed');
    else if(file instanceof PDFDict){
     const ef=file.lookupMaybe(key('EF'),PDFDict);
     // Only the unambiguous embedded F stream is supported; UF-only/platform alternatives remain intact.
     if(!ef)unsupported('External movie reference; no file access is performed');
     else{const object=ef.lookup(key('F'));if(!(object instanceof PDFRawStream))fail();if(object.dict.lookup(key('Type'))!==key('EmbeddedFile'))fail();stream=object;descriptor.format='Embedded movie bytes';descriptor.extractable=true;}
    }else fail();
   }else unsupported('Inventory only; active rendition/rich-media content is preserved and never executed');
   if(stream && stream.getContentsSize()>maxMedia)throw new PdfNavigationError('limit-exceeded');
   entries.push({descriptor,stream});
  }
 }
 return entries;
}
export async function inspectEmbeddedMedia(bytes:Uint8Array,signal?:AbortSignal):Promise<MediaDescriptor[]>{signal?.throwIfAborted();const doc=await loadNavigationDocument(bytes);signal?.throwIfAborted();return parse(doc).map(entry=>entry.descriptor);}
export async function extractEmbeddedMedia(bytes:Uint8Array,id:string,signal?:AbortSignal):Promise<{bytes:Uint8Array;filename:string;mimeType:string}>{
 signal?.throwIfAborted();const doc=await loadNavigationDocument(bytes);signal?.throwIfAborted();const entry=parse(doc).find(e=>e.descriptor.id===id);
 if(!entry)throw new PdfNavigationError('invalid-change');if(!entry.stream||!entry.descriptor.extractable)fail();
 const decoded=decodeObjectStream(doc,entry.stream);signal?.throwIfAborted();
 const extension=entry.descriptor.format==='U3D'?'u3d':entry.descriptor.format==='PRC'?'prc':entry.descriptor.subtype==='Sound'?'pcm':'bin';
 // PDF Sound streams are raw sample data, not a WAV container. Extraction never creates a playable URL.
 return {bytes:new Uint8Array(decoded),filename:`embedded-${entry.descriptor.pageIndex+1}-${id.split(':')[2]}.${extension}`,mimeType:'application/octet-stream'};
}
