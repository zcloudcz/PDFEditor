// @vitest-environment node
import { describe,expect,it,vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { degrees, PDFDocument, PDFName, PDFDict, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyAnnotationChanges,readAnnotations } from './annotations';
import type { AnnotationDraft, AnnotationKind } from './annotation-types';
import { inspect } from '../../tests/helpers/editor-pdf-inspect.js';
const draft=(subtype:AnnotationKind):AnnotationDraft=>({pageIndex:0,subtype,rect:[20,20,120,30],contents:subtype==='Stamp'?'APPROVED':'Český komentář',author:'Tester',quadPoints:['Highlight','Underline','StrikeOut'].includes(subtype)?[20,50,140,50,20,20,140,20]:undefined,inkPaths:subtype==='Ink'?[[20,20,70,40,140,30]]:undefined});
async function fixture(){const doc=await PDFDocument.create();const page=doc.addPage([400,500]);page.setRotation(degrees(90));page.drawText('Preserved original',{x:20,y:450});doc.getForm().createCheckBox('untouched').addToPage(page,{x:200,y:200,width:20,height:20});return doc.save();}
describe('standard PDF annotations',()=>{
  it('embeds local Unicode font for Czech stamp appearance readable by PDF.js',async()=>{
    const font=await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf');
    const fetchMock=vi.fn(async()=>({ok:true,arrayBuffer:async()=>font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength)}));
    vi.stubGlobal('fetch',fetchMock);
    try{
      const original=await fixture(),copy=original.slice(),stamp={...draft('Stamp'),contents:'Razítko T06'};
      const output=await applyAnnotationChanges(original,[{kind:'add',annotation:stamp}]);
      const reader=await getDocument({data:output.slice()}).promise;
      try{const annot=(await(await reader.getPage(1)).getAnnotations()).find(a=>a.subtype==='Stamp');expect(annot).toMatchObject({hasAppearance:true,contentsObj:{str:'Razítko T06'}});}
      finally{await reader.destroy();}
      const before=(await inspect(original,true,1,undefined)).pixels!,after=(await inspect(output,true,1,undefined)).pixels!;
      expect(after.data.reduce((count,value,index)=>count+(value!==before.data[index]?1:0),0)).toBeGreaterThan(100);
      const pdf=await PDFDocument.load(output),annots=pdf.getPage(0).node.Annots()!,dict=pdf.context.lookup(annots.get(annots.size()-1),PDFDict),ap=dict.lookup(PDFName.of('AP'),PDFDict);
      expect(ap.has(PDFName.of('N'))).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(original).toEqual(copy);
    }finally{vi.unstubAllGlobals();}
  });
  it('removes the complete Text+Popup pair without leaving a comment visible to PDF.js',async()=>{const doc=await PDFDocument.create(),page=doc.addPage([400,500]);const note=doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[20,20,40,40],P:page.ref,Contents:PDFString.of('Remove me')}),noteRef=doc.context.register(note),popup=doc.context.obj({Type:'Annot',Subtype:'Popup',Rect:[40,40,200,200],P:page.ref,Parent:noteRef,Open:true}),popupRef=doc.context.register(popup);note.set(PDFName.of('Popup'),popupRef);page.node.addAnnot(noteRef);page.node.addAnnot(popupRef);const original=await doc.save(),output=await applyAnnotationChanges(original,[{kind:'remove',id:noteRef.toString()}]);const parsed=await getDocument({data:output.slice()}).promise;try{const annotations=await(await parsed.getPage(1)).getAnnotations();expect(annotations).toEqual([]);}finally{await parsed.destroy();}});
  it('rejects deleting a thread containing an unsupported reply subtype and leaves all reader-visible comments intact',async()=>{const doc=await PDFDocument.create(),page=doc.addPage([400,500]);const noteRef=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[20,20,40,40],P:page.ref,Contents:PDFString.of('Keep parent')}));const reply=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'FreeText',Rect:[50,50,150,80],P:page.ref,IRT:noteRef,Contents:PDFString.of('Keep unsupported reply'),DA:PDFString.of('/Helv 12 Tf 0 g')}));page.node.addAnnot(noteRef);page.node.addAnnot(reply);const original=await doc.save(),copy=original.slice();await expect(applyAnnotationChanges(original,[{kind:'remove',id:noteRef.toString()}])).rejects.toMatchObject({code:'unsupported-structure'});expect(original).toEqual(copy);const parsed=await getDocument({data:original.slice()}).promise;try{const annotations=await(await parsed.getPage(1)).getAnnotations();expect(annotations.map(a=>a.subtype)).toEqual(['Text','FreeText']);expect(annotations.map(a=>a.contentsObj.str)).toEqual(['Keep parent','Keep unsupported reply']);}finally{await parsed.destroy();}});
  it('renders highlight transparently over real text, preserving underlying dark text pixels',async()=>{
    const doc=await PDFDocument.create();const page=doc.addPage([400,500]);page.drawText('TEXT UNDER HIGHLIGHT',{x:20,y:200,size:18});const original=await doc.save();const bytes=await applyAnnotationChanges(original,[{kind:'add',annotation:{subtype:'Highlight',pageIndex:0,rect:[15,195,280,28],quadPoints:[15,223,295,223,15,195,295,195],contents:'Highlight'}}]);
    const before=(await inspect(original,true,1,undefined)).pixels!,after=(await inspect(bytes,true,1,undefined)).pixels!;let darkBefore=0,darkAfter=0,yellow=0;for(let i=0;i<before.data.length;i+=4){if(before.data[i]<60&&before.data[i+1]<60&&before.data[i+2]<60)darkBefore++;if(after.data[i]<60&&after.data[i+1]<60&&after.data[i+2]<60)darkAfter++;if(after.data[i]>200&&after.data[i+1]>150&&after.data[i+2]<230)yellow++;}expect(darkBefore).toBeGreaterThan(100);expect(darkAfter).toBeGreaterThanOrEqual(darkBefore*.98);expect(yellow).toBeGreaterThan(1000);
  });
  it.each(['Highlight','Underline','StrikeOut','Text','Ink','Stamp'] as AnnotationKind[])('writes %s with appearance read by independent PDF.js and preserves original widgets',async subtype=>{
    const before=await fixture(), copy=before.slice(), bytes=await applyAnnotationChanges(before,[{kind:'add',annotation:draft(subtype)}]); const annotations=await readAnnotations(bytes);expect(annotations[0].subtype).toBe(subtype);expect(before).toEqual(copy);
    const parsed=await getDocument({data:bytes.slice()}).promise;try{ const page=await parsed.getPage(1);expect(page.rotate).toBe(90); const annots=await page.getAnnotations();expect(annots.map(a=>a.subtype)).toContain(subtype);expect(annots.map(a=>a.subtype)).toContain('Widget');expect(annots.find(a=>a.subtype===subtype).hasAppearance).toBe(true);expect((await page.getTextContent()).items.some((i:any)=>i.str==='Preserved original')).toBe(true);const ops=await page.getOperatorList();expect(ops.fnArray.length).toBeGreaterThan(0); }finally{await parsed.destroy();}
    const doc=await PDFDocument.load(bytes), array=doc.getPage(0).node.Annots()!, ref=array.get(array.size()-1);expect(doc.context.lookup(ref,PDFDict).has(PDFName.of('AP'))).toBe(true);
  });
  it('edits comments, threads replies, resolves and removes the thread by reference',async()=>{
    let bytes=await applyAnnotationChanges(await fixture(),[{kind:'add',annotation:draft('Text')}]);const id=(await readAnnotations(bytes))[0].id;
    bytes=await applyAnnotationChanges(bytes,[{kind:'comment',id,contents:'Edited'},{kind:'resolve',id,resolved:true},{kind:'add',annotation:{...draft('Text'),replyTo:id,contents:'Reply'}}]);const annots=await readAnnotations(bytes);expect(annots[0]).toMatchObject({id,contents:'Edited',resolved:true});expect(annots[1].replyTo).toBe(id);
    bytes=await applyAnnotationChanges(bytes,[{kind:'remove',id}]);expect(await readAnnotations(bytes)).toEqual([]);expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(1);
  });
  it('rejects malformed quads, unsupported text glyphs in stamps and cancelled operations atomically',async()=>{
    const bytes=await fixture(),copy=bytes.slice(); await expect(applyAnnotationChanges(bytes,[{kind:'add',annotation:{...draft('Highlight'),quadPoints:[0,0]}}])).rejects.toMatchObject({code:'invalid-change'});
    const font=await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength)})));
    try{await expect(applyAnnotationChanges(bytes,[{kind:'add',annotation:{...draft('Stamp'),contents:'😀'}}])).rejects.toMatchObject({code:'invalid-change'});}
    finally{vi.unstubAllGlobals();}
    const abort=new AbortController();abort.abort();await expect(applyAnnotationChanges(bytes,[{kind:'add',annotation:draft('Text')}],abort.signal)).rejects.toThrow();expect(bytes).toEqual(copy);
  });
});

