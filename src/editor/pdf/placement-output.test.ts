// @vitest-environment node
import {expect,it} from 'vitest';
import {degrees,PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {mapPlacement} from './placement';
import {applyAnnotationChanges} from './annotations';
it.each([
  [0,[40,120,100,150]], [90,[60,60,100,150]], [180,[100,90,100,150]], [270,[80,150,100,150]],
] as Array<[number,number[]]>)('places standard highlight against independent PDF.js CropBox/UserUnit geometry at rotation %i',async(rotation,expected)=>{
  const doc=await PDFDocument.create();const page=doc.addPage([300,400]);page.setCropBox(20,30,200,300);page.setRotation(degrees(rotation));page.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));const bytes=await doc.save();
  const parsed=await getDocument({data:bytes.slice()}).promise;let placement:ReturnType<typeof mapPlacement>;
  try{const independent=await parsed.getPage(1);expect(independent.userUnit).toBe(2);placement=mapPlacement([[.1,.2],[.6,.7]],independent.getViewport({scale:1}),0,'rectangle');expect(placement!.rect).toEqual(expected);}finally{await parsed.destroy();}
  const output=await applyAnnotationChanges(bytes,[{kind:'add',annotation:{pageIndex:0,subtype:'Highlight',contents:'Rotated highlight',rect:placement!.rect,quadPoints:placement!.quadPoints}}]);const reopened=await getDocument({data:output.slice()}).promise;
  try{const annotations=await(await reopened.getPage(1)).getAnnotations();expect(annotations[0].rect).toEqual([expected[0],expected[1],expected[0]+expected[2],expected[1]+expected[3]]);expect(annotations[0].hasAppearance).toBe(true);}finally{await reopened.destroy();}
});
