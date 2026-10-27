import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import Tesseract from 'tesseract.js';
import { writeFileSync } from 'node:fs';
import { filterScanPixels, scanGeometry, DEFAULT_SCAN_PREPARATION } from '../src/editor/pdf/scan-processing.ts';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
// Executes the production filter and geometry, with the same locally pinned model/protocol.
GlobalFonts.registerFromPath(resolve('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'), 'Scan fixture');
const normalize = text => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
function distance(a,b) { let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)));row=next;}return row[b.length]; }
function rotate(input, options) { const g=scanGeometry(input.width,input.height,options), canvas=createCanvas(g.width,g.height),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,g.width,g.height);ctx.translate(g.width/2,g.height/2);ctx.rotate(g.angle);ctx.drawImage(input,-input.width/2,-input.height/2);ctx.resetTransform();return canvas; }
const results=[]; let peakRss=process.memoryUsage().rss;const timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},10);
try {
  for (const [language,lines] of [['ces',['Příliš žluťoučký kůň úpěl ďábelské ódy.','Český dokument obsahuje čísla 12345 a datum.']],['eng',['The quick brown fox jumps over the lazy dog.','All document processing stays on this device.']]]) {
    for(const kind of ['skew-noise','quarter-turn']) {
      const clean=createCanvas(1600,480),ctx=clean.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,480);ctx.fillStyle='#555';ctx.font='46px "Scan fixture"';lines.forEach((text,i)=>ctx.fillText(text,80,140+i*100));
      if(kind==='skew-noise') {let seed=7717;for(let i=0;i<5000;i++){seed=(1664525*seed+1013904223)>>>0;const x=seed%1600;seed=(1664525*seed+1013904223)>>>0;ctx.fillStyle='#222';ctx.fillRect(x,seed%480,1,1);}}
      const input=rotate(clean,{...DEFAULT_SCAN_PREPARATION,orientation:kind==='quarter-turn'?90:0,deskew:kind==='skew-noise'?3:0});
      for(const prepared of [false,true]) {
        const started=performance.now();let rendered=input;
        if(prepared){rendered=rotate(input,{...DEFAULT_SCAN_PREPARATION,orientation:kind==='quarter-turn'?270:0,deskew:kind==='skew-noise'?-3:0});const context=rendered.getContext('2d'),pixels=context.getImageData(0,0,rendered.width,rendered.height);pixels.data.set(await filterScanPixels(pixels.data,rendered.width,rendered.height,{...DEFAULT_SCAN_PREPARATION,contrast:1.5,denoise:true},new AbortController().signal));context.putImageData(pixels,0,0);}
        const worker=await Tesseract.createWorker(language,Tesseract.OEM.LSTM_ONLY,{langPath:resolve('public/ocr/models'),gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}},{debug_file:'/dev/null'});
        try {await worker.setParameters({tessedit_pageseg_mode:'3',user_defined_dpi:'216'});const {data}=await worker.recognize(rendered.toBuffer('image/png'),{rotateAuto:false},{text:true,hocr:true});const expected=normalize(lines.join(' ')),actual=normalize(data.text),words=expected.split(' ');results.push({language,fixture:kind,prepared,width:rendered.width,height:rendered.height,cer:distance([...expected],[...actual])/[...expected].length,wer:distance(words,actual.split(' '))/words.length,confidence:data.confidence,elapsedMs:Math.round(performance.now()-started)});}finally{await worker.terminate();}
      }
    }
  }
}finally{clearInterval(timer);peakRss=Math.max(peakRss,process.memoryUsage().rss);}
const report={generatedAt:new Date().toISOString(),engine:'tesseract.js 7.0.0 / core 7.0.0',modelsRevision:'87416418657359cb625c412a48b6e1d6d41c29bd',normalization:'NFC, lowercase, collapse whitespace, preserve punctuation; Levenshtein CER/WER',protocol:'Rendered synthetic raster; production filter/geometry; PSM3,216DPI,rotateAuto=false; original and processed independently recognized',memory:{peakProcessRssBytes:peakRss,samplingIntervalMs:10,scope:'Entire Node process including OCR threads; not browser peak or maximum-page bound',rasterBudget:'12M pixels per raster; source+prepared 96MB RGBA; filtering two temporary RGBA buffers adds up to 96MB; PNG/engine allocations additional. Pages serial; cancellation yields every64rows.'},limitations:['Synthetic single-column fixtures only; no accuracy guarantee for tables, real camera scans, faded/blurred pages.','Manual orientation/deskew; no automatic angle detection.','No source PDF replacement; preprocessing only changes recognition input.','Node evidence does not prove browser worker loading or browser peak memory.'],results};
writeFileSync('docs/validation/ocr-scan-benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({fixtures:results.length,preparedMaxCer:Math.max(...results.filter(r=>r.prepared).map(r=>r.cer)),preparedMaxWer:Math.max(...results.filter(r=>r.prepared).map(r=>r.wer)),peakProcessRssBytes:peakRss}));
if(results.filter(r=>r.prepared).some(r=>r.cer>0.25))throw new Error('Prepared synthetic OCR regression');
