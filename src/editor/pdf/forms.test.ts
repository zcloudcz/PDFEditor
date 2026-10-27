// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyFormChanges, exportFormValues, importFormValues, readFormFields } from './forms';
const fontBytes = new Uint8Array(await readFile('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'));
async function fixture() { const doc = await PDFDocument.create(); const page = doc.addPage([400,500]); page.drawText('Preserved original', {x:20,y:450}); doc.setTitle('Keep metadata'); doc.catalog.set(PDFName.of('FutureData'),doc.context.obj({Keep:PDFString.of('Yes')})); return doc.save(); }
describe('standard PDF forms',()=>{
  it('preserves unchanged multiline text and exposes its multiline flag to the panel',async()=>{const doc=await PDFDocument.create(),page=doc.addPage([400,500]),field=doc.getForm().createTextField('multiline');field.enableMultiline();field.setText('Line one\nLine two');field.addToPage(page,{x:20,y:100,width:200,height:80});const original=await doc.save(),read=(await readFormFields(original))[0];expect(read.multiline).toBe(true);const output=await applyFormChanges(original,[{kind:'set-value',id:read.id,value:read.value}],{fontBytes});const parsed=await getDocument({data:output.slice()}).promise;try{const values=await parsed.getFieldObjects() as unknown as Record<string,Array<{value?:string}>>;expect(values.multiline.some(v=>v.value==='Line one\nLine two')).toBe(true);}finally{await parsed.destroy();}});
  it('rejects unsupported glyphs in existing choice options and moved text before generating replacement appearances',async()=>{
    const doc=await PDFDocument.create(),page=doc.addPage([400,500]),choice=doc.getForm().createDropdown('choice');choice.addOptions(['English']);choice.select('English');choice.addToPage(page,{x:20,y:100,width:150,height:30});choice.addOptions(['中文']);
    const text=doc.getForm().createTextField('text');text.setText('Original');text.addToPage(page,{x:20,y:200,width:150,height:30});text.setText('中文');const original=await doc.save({updateFieldAppearances:false}),copy=original.slice(),fields=await readFormFields(original);
    await expect(applyFormChanges(original,[{kind:'set-value',id:fields.find(f=>f.name==='choice')!.id,value:['中文']}],{fontBytes})).rejects.toMatchObject({code:'invalid-change'});
    await expect(applyFormChanges(original,[{kind:'set-value',id:fields.find(f=>f.name==='choice')!.id,value:['English']}],{fontBytes})).rejects.toMatchObject({code:'invalid-change'});
    await expect(applyFormChanges(original,[{kind:'move',id:fields.find(f=>f.name==='text')!.id,widgetIndex:0,rect:[40,240,150,30]}],{fontBytes})).rejects.toMatchObject({code:'invalid-change'});expect(original).toEqual(copy);
    const parsed=await getDocument({data:original.slice()}).promise;try{const annotations=await(await parsed.getPage(1)).getAnnotations();expect(annotations.find(a=>a.fieldName==='choice').fieldValue).toEqual(['English']);expect(annotations.find(a=>a.fieldName==='text').rect).toEqual([19.5,199.5,170.5,230.5]);}finally{await parsed.destroy();}
  });
  it('creates all widget kinds and independently reads Unicode/checkbox/radio/choice values',async()=>{
    const original=await fixture(), copy=original.slice(); let bytes=await applyFormChanges(original,[
      {kind:'create',name:'name',fieldKind:'text',pageIndex:0,rect:[20,350,180,25]},
      {kind:'create',name:'check',fieldKind:'checkbox',pageIndex:0,rect:[20,300,20,20]},
      {kind:'create',name:'radio',fieldKind:'radio',pageIndex:0,rect:[20,250,20,20],options:['A','B']},
      {kind:'create',name:'choice',fieldKind:'choice',pageIndex:0,rect:[20,200,100,25],options:['One','Two']},
    ],{fontBytes});
    const fields=await readFormFields(bytes); const id=(name:string)=>fields.find(f=>f.name===name)!.id;
    bytes=await applyFormChanges(bytes,[{kind:'set-value',id:id('name'),value:'Příliš žluťoučký kůň'},{kind:'set-value',id:id('check'),value:true},{kind:'set-value',id:id('radio'),value:'B'},{kind:'set-value',id:id('choice'),value:['Two']}],{fontBytes});
    const parsed=await getDocument({data:bytes.slice()}).promise;
    try { const values=await parsed.getFieldObjects() as unknown as Record<string, Array<{ value?: string; exportValues?: string }>>; expect(values!.name.some(v=>v.value==='Příliš žluťoučký kůň')).toBe(true); expect(values!.check.some(v=>v.value && v.value!=='Off')).toBe(true); expect(values!.choice.some(v=>v.value==='Two')).toBe(true); expect(values!.radio.some(v=>v.value==='1' && v.exportValues==='1')).toBe(true); const page=await parsed.getPage(1); expect((await page.getTextContent()).items.some((i:any)=>i.str==='Preserved original')).toBe(true); expect((await page.getAnnotations()).filter(a=>a.subtype==='Widget')).toHaveLength(5); } finally {await parsed.destroy();}
    expect(original).toEqual(copy); const reopened=await PDFDocument.load(bytes); expect(reopened.getTitle()).toBe('Keep metadata'); expect(reopened.catalog.lookup(PDFName.of('FutureData'),PDFDict).lookup(PDFName.of('Keep'),PDFString).decodeText()).toBe('Yes');
    expect((await readFormFields(bytes)).map(f=>f.id)).toEqual(fields.map(f=>f.id));
  });
  it('roundtrips empty values, required and read-only without overriding read-only input',async()=>{
    let bytes=await applyFormChanges(await fixture(),[{kind:'create',name:'text',fieldKind:'text',pageIndex:0,rect:[20,100,100,25],required:true}],{fontBytes}); const field=(await readFormFields(bytes))[0];
    bytes=await applyFormChanges(bytes,[{kind:'set-value',id:field.id,value:''},{kind:'properties',id:field.id,readOnly:true}],{fontBytes}); expect((await readFormFields(bytes))[0]).toMatchObject({value:'',readOnly:true,required:true}); await expect(applyFormChanges(bytes,[{kind:'set-value',id:field.id,value:'No'}],{fontBytes})).rejects.toMatchObject({code:'invalid-change'});
  });
  it('moves and removes widgets and exchanges ID-checked JSON values',async()=>{
    let bytes=await applyFormChanges(await fixture(),[{kind:'create',name:'text',fieldKind:'text',pageIndex:0,rect:[20,100,100,25]}],{fontBytes}); const fields=await readFormFields(bytes), id=fields[0].id;
    expect(importFormValues(exportFormValues(fields),fields)).toEqual([{kind:'set-value',id,value:''}]);
    bytes=await applyFormChanges(bytes,[{kind:'move',id,widgetIndex:0,rect:[40,150,120,30]}],{fontBytes}); expect((await readFormFields(bytes))[0].widgets[0].rect).toEqual([40,150,120,30]); bytes=await applyFormChanges(bytes,[{kind:'remove',id}],{fontBytes}); expect(await readFormFields(bytes)).toEqual([]);
  });
  it('rejects duplicate names, invalid bounds and values without mutating source',async()=>{
    const bytes=await applyFormChanges(await fixture(),[{kind:'create',name:'text',fieldKind:'text',pageIndex:0,rect:[20,100,100,25]}],{fontBytes}), copy=bytes.slice();
    await expect(applyFormChanges(bytes,[{kind:'create',name:'text',fieldKind:'checkbox',pageIndex:0,rect:[20,20,20,20]}],{fontBytes})).rejects.toMatchObject({code:'invalid-change'});
    await expect(applyFormChanges(bytes,[{kind:'create',name:'outside',fieldKind:'checkbox',pageIndex:0,rect:[399,20,20,20]}],{fontBytes})).rejects.toMatchObject({code:'invalid-change'}); expect(bytes).toEqual(copy);
  });
  it.each(['XFA','AA','JS'])('rejects active %s structures',async key=>{ const doc=await PDFDocument.create();doc.addPage(); doc.getForm().createTextField('test'); doc.catalog.lookup(PDFName.of('AcroForm'),PDFDict).set(PDFName.of(key),PDFString.of('active')); await expect(readFormFields(await doc.save({updateFieldAppearances:false}))).rejects.toMatchObject({code:'unsupported-structure'}); });
});




