import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyAnnotationChanges, exportAnnotationsXfdf, importAnnotationsXfdf, readAnnotations } from './annotations';
import { applyFormChanges, exportFormValues, exportFormValuesFdf, exportFormValuesXfdf, importFormValues, importFormValuesFdf, importFormValuesXfdf } from './forms';
import type {FormField} from './form-types';
it('roundtrips XFDF Unicode contents, markup geometry, ink, colors, threaded replies and resolution', async () => {
  const doc = await PDFDocument.create(); doc.addPage([400,500]); const initial = await doc.save();
  let bytes = await applyAnnotationChanges(initial,[{kind:'add',annotation:{subtype:'Highlight',pageIndex:0,rect:[20,20,100,20],quadPoints:[20,40,120,40,20,20,120,20],contents:'Český <komentář> & poznámka',color:[1,0,0]}}]);
  const id=(await readAnnotations(bytes))[0].id;
  bytes=await applyAnnotationChanges(bytes,[{kind:'resolve',id,resolved:true},{kind:'add',annotation:{subtype:'Text',pageIndex:0,rect:[20,20,20,20],contents:'Odpověď',replyTo:id}},{kind:'add',annotation:{subtype:'Ink',pageIndex:0,rect:[30,60,100,20],contents:'Ink',inkPaths:[[30,60,80,80,130,60]]}}]);
  const changes=importAnnotationsXfdf(exportAnnotationsXfdf(await readAnnotations(bytes))), roundtrip=await readAnnotations(await applyAnnotationChanges(initial,changes));
  expect(roundtrip[0]).toMatchObject({subtype:'Highlight',contents:'Český <komentář> & poznámka',resolved:true,color:[1,0,0],quadPoints:[20,40,120,40,20,20,120,20]});expect(roundtrip[1].replyTo).toBe(roundtrip[0].id);expect(roundtrip[2].inkPaths).toEqual([[30,60,80,80,130,60]]);
});
it('rejects dangerous XML and duplicate or cyclic thread identities',()=>{
  expect(()=>importAnnotationsXfdf('<!DOCTYPE xfdf [<!ENTITY x SYSTEM "file:///a">]><xfdf><annots/></xfdf>')).toThrow();
  expect(()=>importAnnotationsXfdf('<xfdf><annots><text name="a" inreplyto="b" page="0" rect="0,0,20,20"/><text name="b" inreplyto="a" page="0" rect="0,0,20,20"/></annots></xfdf>')).toThrow();
  expect(()=>importAnnotationsXfdf('<xfdf><annots><text name="a" page="0" rect="0,0,20,20"/><text name="a" page="0" rect="0,0,20,20"/></annots></xfdf>')).toThrow();
});
it('stores standards-defined row and column tab traversal',async()=>{const doc=await PDFDocument.create();doc.addPage();const bytes=await applyFormChanges(await doc.save(),[{kind:'tab-order',pageIndex:0,order:'column'}]);expect((await PDFDocument.load(bytes)).getPage(0).node.toString()).toContain('/Tabs /C');});
it('roundtrips Unicode, empty values and multi-choice through FDF and XFDF by validated unique names',async()=>{
  const fields:FormField[]=[{id:'1 0 R',name:'České jméno',kind:'text',value:'Příliš žluťoučký <kůň>',options:[],readOnly:false,required:false,widgets:[]},{id:'2 0 R',name:'check',kind:'checkbox',value:true,options:[],readOnly:false,required:false,widgets:[]},{id:'3 0 R',name:'choices',kind:'choice',value:['One','Two'],options:['One','Two'],readOnly:false,required:false,widgets:[]},{id:'4 0 R',name:'empty',kind:'text',value:'',options:[],readOnly:false,required:false,widgets:[]}];
  const expected=fields.map(f=>({kind:'set-value',id:f.id,value:f.value}));expect(await importFormValuesFdf(new TextEncoder().encode(exportFormValuesFdf(fields)),fields)).toEqual(expected);expect(importFormValuesXfdf(exportFormValuesXfdf(fields),fields)).toEqual(expected);
  expect(()=>importFormValuesXfdf('<xfdf><fields><field name="unknown"><value>x</value></field></fields></xfdf>',fields)).toThrow();
});
it('exchange preserves read-only fields unchanged and refuses attempts to overwrite their values',async()=>{const fields:FormField[]=[{id:'1 0 R',name:'locked',kind:'text',value:'Keep',options:[],readOnly:true,required:false,widgets:[]}];expect(importFormValues(exportFormValues(fields),fields)).toEqual([]);expect(importFormValuesXfdf(exportFormValuesXfdf(fields),fields)).toEqual([]);expect(await importFormValuesFdf(new TextEncoder().encode(exportFormValuesFdf(fields)),fields)).toEqual([]);expect(()=>importFormValuesXfdf(exportFormValuesXfdf([{...fields[0],value:'Changed'}]),fields)).toThrow();});
