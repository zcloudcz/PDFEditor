import JSZip from 'jszip';
import { validateDataTable } from '../data/table';
import { CONVERSION_LIMITS, CONVERSION_PROFILE, ConversionError, readConversionPages, xml, type ConversionPage, type ConversionRequest, type ConversionResult, type ConversionReport, type TextBlock } from './conversion-profile';

const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels=(entries:{id:string;type:string;target:string}[])=>`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(e=>`<Relationship Id="${e.id}" Type="${rel}/${e.type}" Target="${e.target}"/>`).join('')}</Relationships>`;
const pngBytes=(data:string)=>Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));
async function xlsx(tables:NonNullable<ConversionRequest['tables']>):Promise<Uint8Array> {
  const zip=new JSZip(),s='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const column=(index:number)=>{let result='';do{result=String.fromCharCode(65+index%26)+result;index=Math.floor(index/26)-1;}while(index>=0);return result;};
  for(const [i,table] of tables.entries()){
    const rows=[table.columns.map(c=>c.label),...table.rows];
    zip.file(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="${s}"><sheetData>${rows.map((row,r)=>`<row r="${r+1}">${row.map((cell,c)=>cell===null?'':`<c r="${column(c)}${r+1}"${typeof cell==='number'?'':' t="inlineStr"'}>${typeof cell==='number'?`<v>${cell}</v>`:`<is><t xml:space="preserve">${xml(cell)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
  }
  zip.file('xl/workbook.xml',`<workbook xmlns="${s}" xmlns:r="${rel}"><sheets>${tables.map((_,i)=>`<sheet name="Table ${i+1}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',rels(tables.map((_,i)=>({id:`rId${i+1}`,type:'worksheet',target:`worksheets/sheet${i+1}.xml`}))));
  zip.file('_rels/.rels',rels([{id:'rId1',type:'officeDocument',target:'xl/workbook.xml'}]));
  zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
const paragraph=(blocks:TextBlock[])=>`<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${blocks.map(b=>`<w:r><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/><w:sz w:val="${Math.max(2,Math.min(800,Math.round(b.height*2)))}"/></w:rPr><w:t xml:space="preserve">${xml(b.text)} </w:t></w:r>`).join('')}</w:p>`;
function lines(blocks:TextBlock[]):TextBlock[][] {
  const rows:TextBlock[][]=[];
  for(const block of [...blocks].sort((a,b)=>a.y-b.y||a.x-b.x)){
    const row=rows.find(r=>Math.abs(r[0].y-block.y)<Math.min(r[0].height,block.height)*0.35);
    if(row)row.push(block);else rows.push([block]);
  }
  return rows.map(row=>row.sort((a,b)=>a.x-b.x));
}
/** Two-column heuristic only when several baseline pairs straddle a clear central gutter. */
export function detectColumns(page:ConversionPage):1|2 {
  return lines(page.text).filter(row=>row.some(b=>b.x+b.width<page.width*0.48)&&row.some(b=>b.x>=page.width*0.5)).length>=3?2:1;
}
async function docx(pages:ConversionPage[]):Promise<Uint8Array> {
  const zip=new JSZip(),imageRels:{id:string;type:string;target:string}[]=[];let body='',imageIndex=0;
  const picture=(png:string,width:number,height:number)=>{
    const id=++imageIndex,rid=`rId${id}`;zip.file(`word/media/image${id}.png`,pngBytes(png));imageRels.push({id:rid,type:'image',target:`media/image${id}.png`});
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(width*12700)}" cy="${Math.round(height*12700)}"/><wp:docPr id="${id}" name="Image ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width*12700)}" cy="${Math.round(height*12700)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };
  for(const [i,page] of pages.entries()){
    const cols=page.raster?1:detectColumns(page);
    if(page.raster)body+=picture(page.raster,page.width,page.height);
    else {
      const left=page.text.filter(b=>cols===1||b.x<page.width*0.5),right=cols===2?page.text.filter(b=>b.x>=page.width*0.5):[];
      body+=lines(left).map(paragraph).join('');
      if(right.length)body+='<w:p><w:r><w:br w:type="column"/></w:r></w:p>'+lines(right).map(paragraph).join('');
      for(const image of page.images){const scale=Math.min(1,(page.width-72)/image.width,(page.height-72)/image.height);if(scale<=0)throw new ConversionError('page-too-small');body+=picture(image.png,image.width*scale,image.height*scale);}
    }
    const section=`<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${Math.round(page.width*20)}" w:h="${Math.round(page.height*20)}"/><w:pgMar w:top="${page.raster?0:720}" w:right="${page.raster?0:720}" w:bottom="${page.raster?0:720}" w:left="${page.raster?0:720}" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:num="${cols}" w:space="360"/></w:sectPr>`;
    body+=i===pages.length-1?section:`<w:p><w:pPr>${section}</w:pPr></w:p>`;
  }
  zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}" xmlns:r="${rel}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`);
  zip.file('_rels/.rels',rels([{id:'rId1',type:'officeDocument',target:'word/document.xml'}]));
  zip.file('word/_rels/document.xml.rels',rels(imageRels));
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function pptx(pages:ConversionPage[]):Promise<Uint8Array> {
  if(pages.some(page=>page.width!==pages[0].width||page.height!==pages[0].height))throw new ConversionError('mixed-slide-sizes');
  const {exportPptx}=await import('../studio/exports');
  return exportPptx({version:1,name:'PDF conversion',pages:pages.map(page=>({id:`page-${page.index}`,name:'Page',width:page.width,height:page.height,background:'#ffffff',objects:[
    ...(page.raster?[{png:page.raster,x:0,y:0,width:page.width,height:page.height}]:page.images).map((b,i)=>({id:`image-${i}`,name:'Image',kind:'image' as const,x:b.x,y:b.y,width:b.width,height:b.height,rotation:0,opacity:1,fill:'none',stroke:'none',strokeWidth:0,locked:false,src:b.png})),
    ...page.text.map((b,i)=>({id:`text-${i}`,name:'Text',kind:'text' as const,x:b.x,y:b.y,width:Math.max(1,b.width+2),height:b.height*1.3,rotation:0,opacity:1,fill:'#000000',stroke:'none',strokeWidth:0,locked:false,text:b.text,fontSize:b.height,fontFamily:'Liberation Sans',wrapText:false}))
  ]}))});
}
export async function convertDocument(input:Blob, request:ConversionRequest, signal:AbortSignal):Promise<ConversionResult> {
  signal.throwIfAborted();
  if(!['docx','xlsx','csv','pptx'].includes(request.format)||request.mode!==undefined&&!['editable','fidelity'].includes(request.mode))throw new ConversionError('unsupported-request');
  if(input.size>CONVERSION_LIMITS.bytes||input.size===0)throw new ConversionError('input-limit');
  const bytes=new Uint8Array(await input.arrayBuffer()),report:ConversionReport={profile:CONVERSION_PROFILE,preserved:0,editable:0,rasterized:0,limitations:[
    'Only raw/Flate PDF streams without predictors are accepted; JPEG/JPX input refuses.',
    'No macro, formula, external-link, comment, bookmark, signature or accessibility semantics are transferred.'
  ]};
  let output:Uint8Array|string,mime:string;
  if(request.format==='xlsx'||request.format==='csv'){
    // Review is a mandatory seam: caller edits candidates through the existing DataTable editor.
    if(!request.tables?.length||request.tables.length>40)throw new ConversionError('tables-require-review');
    await readConversionPages(bytes,request.pages,'editable',signal);
    let tableBytes=0;
    for(const table of request.tables){validateDataTable(table);tableBytes+=new TextEncoder().encode(JSON.stringify(table)).length;if(tableBytes>5*1024*1024)throw new ConversionError('table-limit');}
    report.limitations.push('Heuristic table candidates require manual cell review; merged cells and formulas are not inferred.');
    report.editable=request.tables.reduce((n,t)=>n+t.rows.length*t.columns.length,0);
    if(request.format==='csv'){
      if(request.tables.length!==1)throw new ConversionError('csv-requires-one-table');
      const table=request.tables[0],cell=(value:string|number|null)=>{let text=String(value??'');if(typeof value==='string'&&/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
      output=[table.columns.map(c=>c.label),...table.rows].map(row=>row.map(cell).join(',')).join('\r\n');mime='text/csv;charset=utf-8';
      report.limitations.push('CSV text starting with formula markers is apostrophe-prefixed for spreadsheet safety.');
    }else{
      output=await xlsx(request.tables);mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
  }else{
    const mode=request.mode??'editable',pages=await readConversionPages(bytes,request.pages,mode,signal);
    if(mode==='fidelity'){
      report.preserved=pages.length;report.rasterized=pages.length;
      report.limitations.push('Explicit fidelity mode rasterizes every selected page at 108 DPI; page content is not editable.');
    }else{
      report.editable=pages.reduce((n,p)=>n+p.text.length,0);report.preserved=pages.reduce((n,p)=>n+p.images.length,0);
      report.limitations.push('Font substitution: Liberation Sans; source fonts are not embedded.','Text colors, vector artwork, clipping and effects are not retained in editable mode.','Paragraph/column detection is heuristic; DOCX images follow text rather than preserving absolute placement.','Unmapped source glyphs can be missing even when text extraction succeeds; review output.');
    }
    output=request.format==='docx'?await docx(pages):await pptx(pages);
    mime=request.format==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  signal.throwIfAborted();const blob=new Blob([typeof output==='string'?output:output.slice().buffer as ArrayBuffer],{type:mime});
  if(blob.size>CONVERSION_LIMITS.outputBytes)throw new ConversionError('output-limit');
  return {files:[{name:`converted.${request.format}`,blob}],report};
}
