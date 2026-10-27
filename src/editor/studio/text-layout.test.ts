import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import JSZip from 'jszip';
import { getTextRuns, layoutText, prepareTextFonts, textRunFamily } from './text-layout';
import { exportPdf, exportPptx, exportSvg } from './exports';
import { parseProject, serializeProject } from './project-io';
import type { StudioObject, StudioProject } from './types';
const text = (changes: Partial<StudioObject> = {}): StudioObject => ({ id:'text', name:'Text', kind:'text', x:10, y:10, width:100, height:100, rotation:0, opacity:1, fill:'#000000', stroke:'none', strokeWidth:0, locked:false, text:'abc\ndef', fontSize:10, ...changes });
const project = (object: StudioObject): StudioProject => ({ version:1,name:'Test',pages:[{id:'p',name:'Page',width:300,height:200,background:'#ffffff',objects:[object]}] });
const measured = (value: string, _family: string, size: number) => value.length * size;

describe('shared text layout', () => {
  it('adds paragraph spacing only for explicit paragraph breaks, not wrapping', () => {
    const result = layoutText(text({ text: 'aa bb\ncc', fontSize: 10, width: 25, wrapText: true, paragraphSpacing: 7 }), measured);
    expect(result.lines.map(line => line.y)).toEqual([10, 22, 41]);
    expect(result.height).toBe(41);
  });
  it('retains manual legacy lines and baseline spacing', () => {
    expect(layoutText(text(), measured).lines.map(line => line.y)).toEqual([10,22]);
    expect(layoutText(text({text:'long word',width:15}), measured).lines).toHaveLength(1);
  });
  it('wraps without discarding spaces or styled text', () => {
    const result=layoutText(text({text:'ab cd',width:30,wrapText:true}),measured);
    expect(result.lines).toHaveLength(2);
    expect(result.lines.flatMap(line=>line.runs).map(run=>run.text).join('')).toBe('ab cd');
  });
  it('hangs wrapping spaces on an exact-fit word without making a blank line', () => {
    const result=layoutText(text({text:'aa bb',fontSize:1,width:2,wrapText:true}),measured);
    expect(result.lines.map(line=>line.runs.map(run=>run.text).join(''))).toEqual(['aa ','bb']);
    expect(result.lines.map(line=>line.width)).toEqual([2,2]);
    expect(result.overflow).toBe(false);
  });
  it('preserves explicit blank lines and safely splits long words', () => {
    const result=layoutText(text({text:'aa\n\nbbbbb',fontSize:1,width:2,wrapText:true}),measured);
    expect(result.lines.map(line=>line.runs.map(run=>run.text).join(''))).toEqual(['aa','','bb','bb','b']);
  });
  it.each(['a '.repeat(50000), 'a'.repeat(100000)])('bounds shaping work for a 100k character input', content => {
    let measuredCharacters=0;
    const count=(value:string)=>{measuredCharacters+=value.length;return value.length;};
    layoutText(text({text:content,fontSize:1,width:100,wrapText:true}),count);
    expect(measuredCharacters).toBeLessThan(content.length*100);
  });
  it('retains kerning across appended tokens and computes final exact widths',()=>{
    const kerned=(value:string)=>value.length-(value.match(/AV/g)?.length??0)*0.25;
    const object=text({text:'AV',fontSize:1,fontFamily:'Liberation Sans',textRuns:[{text:'A'},{text:'V'}]});
    expect(layoutText(object,kerned).lines[0].width).toBe(1.75);
  });
  it('aligns text within the box, keeping geometry unchanged', () => {
    const object=text({verticalAlign:'bottom',textAlign:'right'}), original=structuredClone(object);
    const result=layoutText(object,measured);
    expect(result.lines.map(line=>line.y)).toEqual([88,100]);
    expect(result.lines[0].runs[0].x).toBe(70);
    expect(object).toEqual(original);
  });
  it('honors explicit false style overrides and mixed sizes/colors', () => {
    const object=text({text:'ab',fontFamily:'Liberation Sans BoldItalic',textRuns:[{text:'a',bold:false,fontSize:20,color:'#ff0000'},{text:'b',italic:false}]});
    const runs=getTextRuns(object);
    expect(textRunFamily(object,runs[0])).toBe('Liberation Sans Italic');
    expect(textRunFamily(object,runs[1])).toBe('Liberation Sans Bold');
    const result=layoutText(object,measured);
    expect(result.lines[0].y).toBe(20);
    expect(result.lines[0].width).toBe(30);
    expect(result.lines[0].runs[0].color).toBe('#ff0000');
  });
  it('reports overflowing text without clipping it',()=> {
    const result=layoutText(text({height:5,verticalAlign:'middle'}),measured);
    expect(result.overflow).toBe(true); expect(result.lines[0].y).toBe(10);
  });
  it('validates and roundtrips run styles, rejecting stale run text',()=>{
    const value=project(text({text:'hi',textRuns:[{text:'hi',bold:true,italic:true,underline:true,fontSize:20,color:'#abcdef'}],verticalAlign:'middle',lineHeight:1.5,wrapText:true}));
    expect(parseProject(serializeProject(value))).toEqual(value);
    value.pages[0].objects[0].text='different'; expect(()=>serializeProject(value)).toThrow();
  });
  it.each([{lineHeight:0},{verticalAlign:'invalid'},{textRuns:[{text:'abc\ndef',color:'url(x)'}]},{textRuns:[{text:'abc\ndef',fontSize:Infinity}]}])('rejects invalid style %j', changes=> {
    const value:unknown={...text(),...changes};
    expect(()=>parseProject(JSON.stringify({ ...project(text()),pages:[{...project(text()).pages[0],objects:[value]}]}))).toThrow();
  });
});

describe('styled text export',()=>{
  beforeAll(async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async input=>new Response(await readFile(`public${String(input)}`)));
    await prepareTextFonts();
  });
  afterAll(()=>vi.restoreAllMocks());
  const styled=()=>text({text:'Český text',width:150,verticalAlign:'bottom',textRuns:[{text:'Český ',bold:true,italic:true,underline:true,fontSize:18,color:'#ff0000'},{text:'text',fontSize:10}]});
  it('uses real combined bold italic metrics and SVG spans',async()=>{
    const svg=await exportSvg(project(styled()),'p');
    expect(svg).toContain('Liberation Sans BoldItalic');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain('font-size="18"'); expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('y="100"');
  });
  it('embeds multiple font faces and draws underline in PDF',async()=>{
    const doc=await PDFDocument.load(await exportPdf(project(styled())));
    const page=doc.getPage(0), fonts=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict);
    expect(fonts.keys().length).toBe(2);
    const contents=page.node.Contents();
    expect(contents).toBeDefined();
    const streams=doc.context.enumerateIndirectObjects().filter(([,value])=>value instanceof PDFRawStream).map(([,value])=>new TextDecoder().decode(decodePDFRawStream(value as PDFRawStream).decode()));
    expect(streams.some(stream=>stream.includes(' m\n')&&stream.includes(' l\n'))).toBe(true);
  });
  it('preserves editable rich runs and vertical anchoring in PPTX',async()=>{
    const zip=await JSZip.loadAsync(await exportPptx(project(styled())));
    const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('anchor="b"'); expect(xml).toContain('b="1" i="1" u="sng"');
    expect(xml).toContain('sz="1800"'); expect(xml).toContain('val="ff0000"');
    expect(xml).toContain('Český ');
  });
  it('keeps paragraph spacing and character spacing editable in PPTX', async () => {
    const zip = await JSZip.loadAsync(await exportPptx(project(text({ tracking: 0.5, paragraphSpacing: 8 }))));
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('spc="50"'); expect(xml).toContain('<a:spcBef><a:spcPts val="800"/>');
  });
  it('rejects unsupported glyphs instead of exporting missing characters',async()=>{
    const value=project(text({text:'漢字'}));
    await expect(exportPdf(value)).rejects.toThrow();
    await expect(exportSvg(value,'p')).rejects.toThrow();
    await expect(exportPptx(value)).rejects.toThrow();
  });
});
