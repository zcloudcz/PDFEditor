import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertEditorModules,
  editorAssets,
} from '../../scripts/editor-assets.mjs';

describe('editor build dependency boundary', () => {
  it('rejects unsupported engines and marketing bootstrap', () => {
    for (const id of [
      'C:/repo/node_modules/@neslinesli93/qpdf-wasm/index.js',
      '/repo/src/js/main.ts',
      '/repo/src/js/utils/pymupdf-loader.ts',
      '/repo/node_modules/tesseract.js/dist/index.js',
    ]) {
      expect(() => assertEditorModules([id])).toThrow();
    }
  });
  it('permits native editor and PDF.js worker', () => {
    expect(() =>
      assertEditorModules([
        '/repo/src/js/editcore/app.js',
        '/repo/node_modules/bentopdf-pdfium/editcore.js',
        '/repo/node_modules/pdfjs-dist/build/pdf.worker.mjs',
      ])
    ).not.toThrow();
  });
});

it('emits pinned local PDF.js runtime assets and every directory license with resolvable origins', () => {
  const plugin=editorAssets(process.cwd()),emitted:Array<{fileName:string;source:unknown}>=[];
  plugin.generateBundle.call({emitFile:(item:{fileName:string;source:unknown})=>emitted.push(item)}, {}, {});
  const inventory=JSON.parse(String(emitted.find(item=>item.fileName==='source-inventory.json')!.source));
  expect(inventory.packages.find((item:{name:string})=>item.name==='pdfjs-dist')).toMatchObject({version:'5.5.207',declaredLicense:'Apache-2.0'});
  for(const directory of ['standard_fonts','cmaps','wasm']) {
    const sourceDirectory=path.resolve('node_modules/pdfjs-dist',directory);
    for(const license of fs.readdirSync(sourceDirectory).filter(file=>file.startsWith('LICENSE'))){
      const output=emitted.find(item=>item.fileName===`pdfjs-viewer/${directory}/${license}`);
      expect(output).toBeDefined();expect(Buffer.from(output!.source as Uint8Array)).toEqual(fs.readFileSync(path.join(sourceDirectory,license)));
    }
  }
  for(const file of ['standard_fonts/FoxitSerif.pfb','cmaps/Adobe-Japan1-UCS2.bcmap','wasm/openjpeg.wasm','wasm/jbig2.wasm','wasm/qcms_bg.wasm','wasm/openjpeg_nowasm_fallback.js']){
    expect(inventory.curatedAssets[`pdfjs-viewer/${file}`]).toBe(`node_modules/pdfjs-dist/${file}`);
    expect(emitted.some(item=>item.fileName===`pdfjs-viewer/${file}`)).toBe(true);
  }
  expect(emitted.some(item=>item.fileName==='licenses/packages/pdfjs-dist/LICENSE')).toBe(true);
  for(const source of Object.values(inventory.curatedAssets) as string[])expect(fs.existsSync(path.resolve(source))).toBe(true);
  expect(inventory.curatedAssets['pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf']).toBe('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf');
  expect(Object.keys(inventory.curatedAssets).some(file=>file.includes('web/viewer'))).toBe(false);
});

it('serves local decoder assets with WASM MIME and declines unknown paths',()=>{
  const plugin=editorAssets(process.cwd());let middleware:((req:{url:string},res:{setHeader:(name:string,value:string)=>void;end:(value:unknown)=>void},next:()=>void)=>void)|undefined;
  plugin.configureServer({middlewares:{use:(handler:typeof middleware)=>{middleware=handler;}}});
  const headers:Record<string,string>={},responses:unknown[]=[];let declined=false;
  const response={setHeader:(name:string,value:string)=>{headers[name]=value;},end:(value:unknown)=>{responses.push(value);}};
  middleware!({url:'/pdfjs-viewer/wasm/openjpeg.wasm'},response,()=>{declined=true;});
  expect(headers['Content-Type']).toBe('application/wasm');expect(responses).toHaveLength(1);expect(declined).toBe(false);
  middleware!({url:'/pdfjs-viewer/../package.json'},response,()=>{declined=true;});expect(declined).toBe(true);
});

it('emits only allowlisted public files and retains CSS font notices', () => {
  const plugin = editorAssets(process.cwd());
  const emitted: Array<{ fileName: string; source: unknown }> = [];
  plugin.generateBundle.call(
    {
      emitFile: (item: { fileName: string; source: unknown }) =>
        emitted.push(item),
    },
    {},
    {}
  );
  expect(emitted.map((item) => item.fileName)).toContain(
    'pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'
  );
  expect(emitted.map((item) => item.fileName)).toContain(
    'licenses/packages/@phosphor-icons/web/LICENSE'
  );
  for (const file of ['ocr/tesseract-worker.min.js', 'ocr/core/tesseract-core-lstm.wasm.js', 'ocr/core/tesseract-core-simd-lstm.wasm.js', 'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js', 'ocr/models/ces.traineddata', 'ocr/models/eng.traineddata', 'licenses/ocr/tessdata-fast-LICENSE']) expect(emitted.map(item => item.fileName)).toContain(file);
  const inventory = JSON.parse(
    String(
      emitted.find((item) => item.fileName === 'source-inventory.json')!.source
    )
  );
  const publicFiles = Object.values(inventory.curatedAssets).filter(
    (value: string) => value.startsWith('public/')
  );
  expect(publicFiles.sort()).toEqual([
    'public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf',
    'public/pdfjs-viewer/standard_fonts/LiberationSans-Bold.ttf',
    'public/pdfjs-viewer/standard_fonts/LiberationSans-Italic.ttf',
    'public/pdfjs-viewer/standard_fonts/LiberationSans-BoldItalic.ttf',
    'public/pdfjs-viewer/standard_fonts/LICENSE_LIBERATION',
    'public/ocr/models/ces.traineddata',
    'public/ocr/models/eng.traineddata',
    'public/fonts/noto/NotoSansArabic-Regular.ttf',
    'public/fonts/noto/NotoSansArabic-Bold.ttf',
    'public/fonts/noto/NotoSansDevanagari-Regular.ttf',
    'public/fonts/noto/NotoSansDevanagari-Bold.ttf',
    'public/fonts/noto/NotoSansCJKjp-Regular.otf',
  ].sort());
});
