// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { editOptionalContent, inspectOptionalContent } from './layers';
import { buildPortfolio, listPortfolio, editPortfolio, extractPortfolioItem } from './portfolio';
import { inspectEmbeddedMedia, extractEmbeddedMedia } from './embedded-media';
const key = PDFName.of;
it.each(['OFF', 'Unchanged'] as const)('isolates shared OCG usage and preserves Export keys when setting %s', async exportState => {
 const {doc,a,b}=await layersFixture();
 const exp=doc.context.register(doc.context.obj({ExportState:'ON',CreatorInfo:PDFString.of('Retain')}));
 const usage=doc.context.register(doc.context.obj({Export:exp,Print:{PrintState:'OFF'}}));
 for(const ref of [a,b])doc.context.lookup(ref,PDFDict).set(key('Usage'),usage);
 const output=await editOptionalContent(await doc.save(),[{id:a.toString(),exportState}]);
 const parsed=await PDFDocument.load(output);
 const selected=parsed.context.lookup(a,PDFDict).lookup(key('Usage'),PDFDict).lookup(key('Export'),PDFDict);
 const other=parsed.context.lookup(b,PDFDict).lookup(key('Usage'),PDFDict).lookup(key('Export'),PDFDict);
 expect(selected.get(key('ExportState'))).toBe(exportState==='Unchanged'?undefined:key(exportState));
 expect(selected.lookup(key('CreatorInfo'),PDFString).decodeText()).toBe('Retain');
 expect(other.get(key('ExportState'))).toBe(key('ON'));
});
async function layersFixture() {
 const doc = await PDFDocument.create(); const page = doc.addPage(); page.drawText('Retained text');
 const a = doc.context.register(doc.context.obj({ Type:'OCG', Name:PDFString.of('First') }));
 const b = doc.context.register(doc.context.obj({ Type:'OCG', Name:PDFString.of('Second') }));
 page.node.set(key('Resources'), doc.context.obj({ Properties:{ Layer:a } }));
 doc.catalog.set(key('OCProperties'), doc.context.obj({ OCGs:[a,b], D:{ BaseState:'ON', Order:[a,b], OFF:[b] } }));
 return {doc,a,b};
}
describe('T18 bounded advanced PDF objects', () => {
 it('changes OCG names/order/visibility/export state without losing membership', async () => {
  const {doc,a,b}=await layersFixture(); const input=await doc.save();
  const output=await editOptionalContent(input,[{id:a.toString(),name:'Česká vrstva',visible:false,exportState:'OFF'},{id:b.toString(),visible:true},{kind:'order',ids:[b.toString(),a.toString()]}]);
  expect((await inspectOptionalContent(output)).map(l=>[l.name,l.visible,l.exportState])).toEqual([['Second',true,'Unchanged'],['Česká vrstva',false,'OFF']]);
  const parsed=await PDFDocument.load(output);
  expect(parsed.getPage(0).node.lookup(key('Resources'),PDFDict).lookup(key('Properties'),PDFDict).get(key('Layer'))?.toString()).toBe(a.toString());
  const independent=await getDocument({data:output.slice()}).promise;
  try { const config=await independent.getOptionalContentConfig(); expect(Array.from(config!).map(([,g])=>[g.name,g.visible])).toContainEqual(['Česká vrstva',false]); } finally {await independent.destroy();}
 });
 it('refuses hierarchical, automatic and duplicate layer orders atomically',async()=>{
  const {doc,a}=await layersFixture(); const props=doc.catalog.lookup(key('OCProperties'),PDFDict); const d=props.lookup(key('D'),PDFDict);
  d.set(key('AS'),doc.context.obj([])); const input=await doc.save(); const copy=input.slice();
  await expect(editOptionalContent(input,[{id:a.toString(),visible:false}])).rejects.toThrow(); expect(input).toEqual(copy);
  d.delete(key('AS')); d.set(key('Order'),doc.context.obj([[a]])); await expect(inspectOptionalContent(await doc.save())).rejects.toThrow();
 });
 it('builds safe portfolio, independently extracts bytes and removes item',async()=>{
  const bytes=new Uint8Array([0,1,2,255]); const output=await buildPortfolio([{filename:'data.bin',bytes,mimeType:'application/octet-stream',description:'Český popis'}]);
  const items=await listPortfolio(output); expect(items[0].description).toBe('Český popis'); expect((await extractPortfolioItem(output,items[0].id)).bytes).toEqual(bytes);
  const independent=await getDocument({data:output.slice()}).promise; try{const attachments=await independent.getAttachments();expect(attachments!['data.bin'].content).toEqual(bytes);}finally{await independent.destroy();}
  expect(await listPortfolio(await editPortfolio(output,{kind:'remove',id:items[0].id}))).toEqual([]);
 });
 it('rejects duplicate/path portfolio imports and abort without changing input',async()=>{
  await expect(buildPortfolio([{filename:'../x',bytes:new Uint8Array([1])}])).rejects.toThrow();
  await expect(buildPortfolio([{filename:'x',bytes:new Uint8Array([1])},{filename:'x',bytes:new Uint8Array([2])}])).rejects.toThrow();
  const controller=new AbortController();controller.abort();await expect(buildPortfolio([],controller.signal)).rejects.toMatchObject({name:'AbortError'});
 });
 it.each(['Sound','Movie','3D','RichMedia'])('inventories %s and extracts only explicit supported embedded subtype',async subtype=>{
  const doc=await PDFDocument.create();const page=doc.addPage(); const raw=new Uint8Array([1,2,3,4]);
  const stream=doc.context.register(doc.context.flateStream(raw,{Type:subtype==='3D'?'3D':subtype==='Sound'?'Sound':'EmbeddedFile',R:8000,Subtype:subtype==='3D'?'U3D':'audio/wav'}));
  const spec=doc.context.obj({Type:'Filespec',F:PDFString.of('local.bin'),EF:{F:stream}});
  const annotation=doc.context.obj({Type:'Annot',Subtype:subtype,Rect:[0,0,20,20]});
  if(subtype==='Sound') annotation.set(key('Sound'),stream);
  if(subtype==='Movie') annotation.set(key('Movie'),doc.context.obj({F:spec}));
  if(subtype==='3D') annotation.set(key('3DD'),stream);
  page.node.set(key('Annots'),doc.context.obj([doc.context.register(annotation)]));
  const input=await doc.save();const inventory=await inspectEmbeddedMedia(input);expect(inventory).toHaveLength(1);expect(inventory[0].subtype).toBe(subtype);
  if(subtype==='RichMedia'){expect(inventory[0].extractable).toBe(false);await expect(extractEmbeddedMedia(input,inventory[0].id)).rejects.toThrow();}
  else expect((await extractEmbeddedMedia(input,inventory[0].id)).bytes).toEqual(raw);
  expect(await doc.save()).toBeDefined();
 });
});

it('T18 cancel and caller-owned mutation do not leak partial layer or portfolio changes',async()=>{
 const {doc,a}=await layersFixture();const input=await doc.save();const before=input.slice();const controller=new AbortController();
 const changes=[{id:a.toString(),name:'Captured'}];const pending=editOptionalContent(input,changes);changes[0].name='Late mutation';
 expect((await inspectOptionalContent(await pending))[0].name).toBe('Captured');expect(input).toEqual(before);
 controller.abort();await expect(editOptionalContent(input,[{id:a.toString(),visible:false}],controller.signal)).rejects.toMatchObject({name:'AbortError'});
 const data=new Uint8Array([7,8]);const build=buildPortfolio([{filename:'data.bin',bytes:data}]);data.fill(0);const output=await build;const entries=await listPortfolio(output);
 expect((await extractPortfolioItem(output,entries[0].id)).bytes).toEqual(new Uint8Array([7,8]));
});
it('T18 rejects encrypted and signed input through common guard',async()=>{
 const {doc}=await layersFixture();doc.context.trailerInfo.Encrypt=doc.context.register(doc.context.obj({Filter:'Standard',V:1,R:2}));const encrypted=await doc.save();
 await expect(inspectOptionalContent(encrypted)).rejects.toMatchObject({code:'unsupported-structure'});
 await expect(inspectEmbeddedMedia(encrypted)).rejects.toMatchObject({code:'unsupported-structure'});
 delete doc.context.trailerInfo.Encrypt;
 const sig=doc.context.register(doc.context.obj({Type:'Sig',Filter:'Adobe.PPKLite',ByteRange:[0,1,2,3],Contents:PDFString.of('fixture')}));
 const field=doc.context.register(doc.context.obj({FT:'Sig',T:PDFString.of('Signature'),V:sig}));doc.catalog.set(key('AcroForm'),doc.context.obj({Fields:[field]}));const signed=await doc.save();
 await expect(inspectEmbeddedMedia(signed)).rejects.toMatchObject({code:'unsupported-structure'});
 await expect(listPortfolio(signed)).rejects.toMatchObject({code:'unsupported-structure'});
});
it('T18 validates exact layer order and retains usage settings and media references',async()=>{
 const {doc,a,b}=await layersFixture();const group=doc.context.lookup(a,PDFDict);group.set(key('Usage'),doc.context.obj({Print:{PrintState:'OFF'},Export:{ExportState:'ON',CreatorInfo:PDFString.of('Keep')}}));
 const sound=doc.context.register(doc.context.flateStream(new Uint8Array([9]),{Type:'Sound',R:8000}));doc.getPage(0).node.set(key('Annots'),doc.context.obj([doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Sound',Rect:[0,0,10,10],Sound:sound}))]));
 const input=await doc.save();await expect(editOptionalContent(input,[{kind:'order',ids:[a.toString(),a.toString()]}])).rejects.toThrow();
 const output=await editOptionalContent(input,[{id:b.toString(),visible:true},{id:a.toString(),exportState:'OFF'}]);const parsed=await PDFDocument.load(output);
 const usage=parsed.context.lookup(a,PDFDict).lookup(key('Usage'),PDFDict);expect(usage.lookup(key('Print'),PDFDict).get(key('PrintState'))).toBe(key('OFF'));
 expect(usage.lookup(key('Export'),PDFDict).lookup(key('CreatorInfo'),PDFString).decodeText()).toBe('Keep');
 const inventory=await inspectEmbeddedMedia(output);expect((await extractEmbeddedMedia(output,inventory[0].id)).bytes).toEqual(new Uint8Array([9]));
});
it.each(['PRC','Unknown'])('T18 guards 3D stream subtype %s',async format=>{
 const doc=await PDFDocument.create();const page=doc.addPage();const stream=doc.context.register(doc.context.flateStream(new Uint8Array([1]),{Type:'3D',Subtype:format}));
 page.node.set(key('Annots'),doc.context.obj([doc.context.register(doc.context.obj({Type:'Annot',Subtype:'3D',Rect:[0,0,10,10],'3DD':stream}))]));const input=await doc.save();const inventory=await inspectEmbeddedMedia(input);
 expect(inventory[0].extractable).toBe(format==='PRC');if(format==='PRC')expect((await extractEmbeddedMedia(input,inventory[0].id)).filename).toMatch(/\.prc$/);else await expect(extractEmbeddedMedia(input,inventory[0].id)).rejects.toThrow();
});
it('T18 inventories external Movie and Screen without fetching or executing actions',async()=>{
 const doc=await PDFDocument.create();const page=doc.addPage();page.node.set(key('Annots'),doc.context.obj(['Movie','Screen'].map(subtype=>doc.context.register(doc.context.obj({Type:'Annot',Subtype:subtype,Rect:[0,0,10,10],Movie:{F:PDFString.of('https://example.invalid/movie')},A:{S:'JavaScript',JS:PDFString.of('throw 1')}})))));
 const input=await doc.save();const inventory=await inspectEmbeddedMedia(input);expect(inventory.map(e=>e.extractable)).toEqual([false,false]);
 for(const item of inventory)await expect(extractEmbeddedMedia(input,item.id)).rejects.toMatchObject({code:'unsupported-structure'});
});
it('T18 rejects unsupported collection schemas instead of discarding metadata',async()=>{
 const input=await buildPortfolio([{filename:'data',bytes:new Uint8Array([1])}]);const doc=await PDFDocument.load(input);doc.catalog.lookup(key('Collection'),PDFDict).set(key('Schema'),doc.context.obj({Custom:{Subtype:'S'}}));
 const original=await doc.save();const before=original.slice();await expect(editPortfolio(original,{kind:'import',filename:'another',bytes:new Uint8Array([2])})).rejects.toThrow();expect(original).toEqual(before);
});
it('T18 clears removed initial portfolio selection and updates description metadata',async()=>{
 let input=await buildPortfolio([{filename:'data',bytes:new Uint8Array([1])}]);let doc=await PDFDocument.load(input);doc.catalog.lookup(key('Collection'),PDFDict).set(key('D'),PDFString.of('data'));input=await doc.save();const [entry]=await listPortfolio(input);
 input=await editPortfolio(input,{kind:'metadata',id:entry.id,description:'Updated'});expect((await listPortfolio(input))[0].description).toBe('Updated');
 const output=await editPortfolio(input,{kind:'remove',id:entry.id});doc=await PDFDocument.load(output);expect(doc.catalog.lookup(key('Collection'),PDFDict).has(key('D'))).toBe(false);
});
it('T18 portfolio Unicode filename survives independent PDF.js extraction',async()=>{
 const input=await buildPortfolio([{filename:'Příloha_日本.bin',bytes:new Uint8Array([9,10]),description:'Příliš žluťoučký'}]);const independent=await getDocument({data:input.slice()}).promise;
 try{const items=await independent.getAttachments();expect(items!['Příloha_日本.bin'].content).toEqual(new Uint8Array([9,10]));}finally{await independent.destroy();}
 expect((await listPortfolio(input))[0].filename).toBe('Příloha_日本.bin');
});
it('T18 bounds decoded media despite a small compressed stream',async()=>{
 const doc=await PDFDocument.create();const page=doc.addPage();const stream=doc.context.register(doc.context.flateStream(new Uint8Array(20*1024*1024+1),{Type:'3D',Subtype:'U3D'}));
 page.node.set(key('Annots'),doc.context.obj([doc.context.register(doc.context.obj({Type:'Annot',Subtype:'3D',Rect:[0,0,10,10],'3DD':stream}))]));const input=await doc.save();const [entry]=await inspectEmbeddedMedia(input);
 await expect(extractEmbeddedMedia(input,entry.id)).rejects.toMatchObject({code:'limit-exceeded'});
});
it('T18 refuses nested portfolio name trees without modifying the input',async()=>{
 const doc=await PDFDocument.create();doc.addPage();const tree=doc.context.register(doc.context.obj({Names:[]}));doc.catalog.set(key('Names'),doc.context.obj({EmbeddedFiles:{Kids:[tree]}}));const input=await doc.save();const copy=input.slice();
 await expect(listPortfolio(input)).rejects.toMatchObject({code:'unsupported-structure'});await expect(editPortfolio(input,{kind:'import',filename:'safe',bytes:new Uint8Array([1])})).rejects.toThrow();expect(input).toEqual(copy);
});
it('T18 layer edit preserves unknown annotation keys/actions/references without execution',async()=>{
 const {doc,a}=await layersFixture();const unknown=doc.context.register(doc.context.obj({Retain:PDFString.of('Opaque reference')}));const action=doc.context.register(doc.context.obj({S:'JavaScript',JS:PDFString.of('globalThis.__t18Executed = true')}));
 const annotation=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'RichMedia',Rect:[0,0,10,10],Opaque:unknown,A:action}));doc.getPage(0).node.set(key('Annots'),doc.context.obj([annotation]));
 const output=await editOptionalContent(await doc.save(),[{id:a.toString(),name:'New'}]);const parsed=await PDFDocument.load(output);const retained=parsed.context.lookup(annotation,PDFDict);
 expect(retained.get(key('Opaque'))?.toString()).toBe(unknown.toString());expect(retained.get(key('A'))?.toString()).toBe(action.toString());expect(parsed.context.lookup(action,PDFDict).lookup(key('JS'),PDFString).decodeText()).toContain('__t18Executed');
 expect((globalThis as any).__t18Executed).toBeUndefined();expect((await inspectEmbeddedMedia(output))[0].extractable).toBe(false);
});

it('T18 importing into a normal PDF creates Collection and preserves pages, layers and metadata through native save',async()=>{
 const {doc}=await layersFixture();doc.setTitle('Retained portfolio title');doc.catalog.set(key('OpaqueMetadata'),doc.context.obj({Keep:PDFString.of('Retain metadata')}));
 const input=await doc.save();const original=input.slice();const layersBefore=await inspectOptionalContent(input);const data=new Uint8Array([1,2,3,42]);
 const output=await editPortfolio(input,{kind:'import',filename:'Příloha.bin',bytes:data,mimeType:'application/octet-stream'});
 const parsed=await PDFDocument.load(output);const collection=parsed.catalog.lookup(key('Collection'),PDFDict);
 expect(collection.get(key('Type'))).toBe(key('Collection'));expect(collection.get(key('View'))).toBe(key('D'));
 expect(parsed.getTitle()).toBe('Retained portfolio title');expect(parsed.getPageCount()).toBe(1);expect(parsed.catalog.lookup(key('OpaqueMetadata'),PDFDict).lookup(key('Keep'),PDFString).decodeText()).toBe('Retain metadata');
 expect(await inspectOptionalContent(output)).toEqual(layersBefore);expect(input).toEqual(original);
 const {createEngine}=await import('../../tests/helpers/editcore-harness');const engine=await createEngine();
 try{
  engine.open(output);const saved=await engine.saveSpliced({incremental:false});expect(saved).not.toBeNull();
  const native=await PDFDocument.load(saved!);expect(native.catalog.lookup(key('Collection'),PDFDict).get(key('View'))).toBe(key('D'));
  expect(await inspectOptionalContent(saved!)).toEqual(layersBefore);expect(native.getTitle()).toBe('Retained portfolio title');
  const reader=await getDocument({data:saved!.slice()}).promise;try{expect(reader.numPages).toBe(1);expect((await reader.getAttachments())!['Příloha.bin'].content).toEqual(data);}finally{await reader.destroy();}
 }finally{engine.close();}
});
it('T18 cancelling normal-PDF portfolio creation leaves the source unchanged',async()=>{
 const {doc}=await layersFixture();const input=await doc.save();const original=input.slice();const controller=new AbortController();
 const pending=editPortfolio(input,{kind:'import',filename:'data.bin',bytes:new Uint8Array([1])},controller.signal);controller.abort();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(input).toEqual(original);expect((await PDFDocument.load(input)).catalog.has(key('Collection'))).toBe(false);
});
it('T18 importing preserves an existing Collection view and initial selection',async()=>{
 const original=await buildPortfolio([{filename:'first.bin',bytes:new Uint8Array([1])}]);const doc=await PDFDocument.load(original);const collection=doc.catalog.lookup(key('Collection'),PDFDict);collection.set(key('View'),key('T'));collection.set(key('D'),PDFString.of('first.bin'));
 const output=await editPortfolio(await doc.save(),{kind:'import',filename:'second.bin',bytes:new Uint8Array([2])});const parsed=await PDFDocument.load(output);const retained=parsed.catalog.lookup(key('Collection'),PDFDict);
 expect(retained.get(key('View'))).toBe(key('T'));expect(retained.lookup(key('D'),PDFString).decodeText()).toBe('first.bin');expect(await listPortfolio(output)).toHaveLength(2);
});
