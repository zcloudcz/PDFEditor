import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const forbidden =
  /(?:\/src\/(?:js\/)?main\.ts$|\/node_modules\/(?:@neslinesli93\/qpdf-wasm|@matbee\/libreoffice-converter|tesseract\.js|wasm-vips|coherentpdf)\/|\/utils\/(?:pymupdf-loader|cpdf-helper|wasm-provider|tesseract-runtime)\.)/;
export function assertEditorModules(ids) {
  for (const id of ids) {
    if (forbidden.test(id.replaceAll('\\', '/')))
      throw new Error(`Unsupported editor dependency: ${id}`);
  }
}

export function editorAssets(root) {
  const curated = new Map([
    [
      'pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf',
      'public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf',
    ],
    ['pdfjs-viewer/standard_fonts/LiberationSans-Bold.ttf', 'public/pdfjs-viewer/standard_fonts/LiberationSans-Bold.ttf'],
    ['pdfjs-viewer/standard_fonts/LiberationSans-Italic.ttf', 'public/pdfjs-viewer/standard_fonts/LiberationSans-Italic.ttf'],
    ['pdfjs-viewer/standard_fonts/LiberationSans-BoldItalic.ttf', 'public/pdfjs-viewer/standard_fonts/LiberationSans-BoldItalic.ttf'],
    [
      'licenses/LICENSE_LIBERATION',
      'public/pdfjs-viewer/standard_fonts/LICENSE_LIBERATION',
    ],
    ['licenses/BentoPDF-LICENSE', 'LICENSE'],
    ['licenses/native-LICENSE', 'bentopdf-pdfium-viewer/LICENSE'],
    ['licenses/native-NOTICE', 'bentopdf-pdfium-viewer/NOTICE'],
    [
      'licenses/LICENSE.embedpdf-mit',
      'bentopdf-pdfium-viewer/licenses/LICENSE.embedpdf-mit',
    ],
    [
      'licenses/LICENSE.harfbuzz',
      'bentopdf-pdfium-viewer/licenses/LICENSE.harfbuzz',
    ],
    [
      'licenses/PDFium-LICENSE',
      'bentopdf-pdfium-viewer/packages/pdfium/pdfium-src/LICENSE',
    ],
    [
      'licenses/PDFium-NOTICE',
      'bentopdf-pdfium-viewer/packages/pdfium/pdfium-src/NOTICE',
    ],
    ['licenses/source-provenance.md', 'docs/legal/source-provenance.md'],
    ['ocr/tesseract-worker.min.js', 'node_modules/tesseract.js/dist/worker.min.js'],
    ['ocr/tesseract-worker.min.js.LICENSE.txt', 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'],
    ['ocr/core/tesseract-core-lstm.wasm.js', 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'],
    ['ocr/core/tesseract-core-simd-lstm.wasm.js', 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'],
    ['ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js', 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'],
    ['ocr/models/ces.traineddata', 'public/ocr/models/ces.traineddata'],
    ['ocr/models/eng.traineddata', 'public/ocr/models/eng.traineddata'],
    ['licenses/ocr/tessdata-fast-LICENSE', 'docs/legal/ocr/tessdata-fast-LICENSE'],
    ['licenses/ocr/tesseract.js-LICENSE.md', 'node_modules/tesseract.js/LICENSE.md'],
    ['licenses/ocr/tesseract.js-core-LICENSE', 'node_modules/tesseract.js-core/LICENSE'],
    ['licenses/ocr/README.md', 'docs/legal/ocr/README.md'],
  ]);
  const pdfjsRoot = path.resolve(root, 'node_modules/pdfjs-dist');
  const fontManifest = JSON.parse(fs.readFileSync(path.resolve(root, 'docs/legal/fonts/noto-manifest.json'), 'utf8'));
  for (const file of ['NotoSansArabic-Regular.ttf', 'NotoSansArabic-Bold.ttf', 'NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf', 'NotoSansCJKjp-Regular.otf']) {
    const expected = fontManifest.find(entry => entry.file === file);
    const bytes = fs.readFileSync(path.resolve(root, `public/fonts/noto/${file}`));
    if (!expected || bytes.length !== expected.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('Bundled font does not match its pinned source manifest.');
    curated.set(`fonts/noto/${file}`, `public/fonts/noto/${file}`);
  }
  for (const file of ['README.md', 'noto-manifest.json', 'Noto-OFL', 'Noto-CJK-OFL']) {
    curated.set(`licenses/fonts/${file}`, `docs/legal/fonts/${file}`);
  }
  const pdfjsManifest = JSON.parse(fs.readFileSync(path.join(pdfjsRoot, 'package.json'), 'utf8'));
  if (pdfjsManifest.version !== '5.5.207') throw new Error('Review PDF.js runtime asset sources and notices before upgrading.');
  for (const [directory, allowed] of [
    ['standard_fonts', /^(?:[A-Za-z0-9_-]+\.(?:pfb|ttf)|LICENSE[^/]*)$/],
    ['cmaps', /^(?:[A-Za-z0-9_.-]+\.bcmap|LICENSE[^/]*)$/],
    ['wasm', /^(?:[A-Za-z0-9_-]+\.wasm|openjpeg_nowasm_fallback\.js|LICENSE[^/]*)$/],
  ]) {
    for (const file of fs.readdirSync(path.join(pdfjsRoot, directory)).sort()) {
      if (!allowed.test(file) || !fs.statSync(path.join(pdfjsRoot, directory, file)).isFile()) continue;
      const target = `pdfjs-viewer/${directory}/${file}`;
      if (!curated.has(target)) curated.set(target, `node_modules/pdfjs-dist/${directory}/${file}`);
    }
  }
  for (const file of fs.readdirSync(pdfjsRoot).filter(file => /^(?:LICENSE|NOTICE)(?:[._-]|$)/i.test(file))) {
    if (fs.statSync(path.join(pdfjsRoot, file)).isFile()) curated.set(`licenses/packages/pdfjs-dist/${file}`, `node_modules/pdfjs-dist/${file}`);
  }
  curated.set('licenses/pdfjs-runtime.md', 'docs/legal/pdfjs-runtime.md');
  return {
    name: 'editor-curated-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const source = curated.get(url);
        if (!source) return next();
        res.setHeader(
          'Content-Type',
          url.endsWith('.ttf') ? 'font/ttf' : url.endsWith('.otf') ? 'font/otf' : url.endsWith('.js') ? 'application/javascript' : url.endsWith('.wasm') ? 'application/wasm' : /\.(?:traineddata|bcmap|pfb)$/.test(url) ? 'application/octet-stream' : 'text/plain; charset=utf-8'
        );
        res.end(fs.readFileSync(path.resolve(root, source)));
      });
    },
    generateBundle(_options, bundle) {
      const ids = [
        ...new Set(
          Object.values(bundle).flatMap((item) =>
            item.type === 'chunk'
              ? Object.entries(item.modules)
                  .filter(([, meta]) => meta.renderedLength > 0)
                  .map(([id]) => id)
              : []
          )
        ),
      ].sort();
      assertEditorModules(ids);
      const packages = new Map();
      // CSS-only icon fonts do not appear in rendered JavaScript modules.
      const packageIds = [
        ...ids,
        path.resolve(root, 'node_modules/@phosphor-icons/web/package.json'),
        path.resolve(root, 'node_modules/tesseract.js/package.json'),
        path.resolve(root, 'node_modules/tesseract.js-core/package.json'),
        path.resolve(root, 'node_modules/pdfjs-dist/package.json'),
      ];
      for (const id of packageIds) {
        const match = id
          .replaceAll('\\', '/')
          .match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
        if (!match || packages.has(match[1])) continue;
        const name = match[1];
        const dir = path.resolve(root, 'node_modules', name);
        const manifest = JSON.parse(
          fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
        );
        const notices = fs
          .readdirSync(dir)
          .filter(
            (file) =>
              /^(?:licen[cs]e|notice|copying)(?:[.\-_]|$)/i.test(file) &&
              fs.statSync(path.join(dir, file)).isFile()
          );
        for (const file of notices)
          curated.set(
            `licenses/packages/${name}/${file}`,
            `node_modules/${name}/${file}`
          );
        packages.set(name, {
          name,
          version: manifest.version,
          declaredLicense: manifest.license,
          repository: manifest.repository,
          notices,
          status: notices.length
            ? 'root notices copied; transitive/native audit not certified'
            : 'notice review required',
        });
      }
      for (const [fileName, source] of curated)
        this.emitFile({
          type: 'asset',
          fileName,
          source: fs.readFileSync(path.resolve(root, source)),
        });
      this.emitFile({
        type: 'asset',
        fileName: 'source-inventory.json',
        source: JSON.stringify(
          {
            status:
              'Local preview only. Corresponding-source and native rebuild gates remain open.',
            modules: ids.map((id) =>
              path.relative(root, id).replaceAll('\\', '/')
            ),
            packages: [...packages.values()],
            curatedAssets: Object.fromEntries(curated),
          },
          null,
          2
        ),
      });
    },
    writeBundle(options) {
      const out = path.resolve(root, options.dir);
      const walk = (dir) =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((entry) =>
            entry.isDirectory()
              ? walk(path.join(dir, entry.name))
              : [path.join(dir, entry.name)]
          );
      const assets = walk(out)
        .filter((file) => !file.endsWith('asset-inventory.json'))
        .sort()
        .map((file) => {
          const bytes = fs.readFileSync(file);
          return {
            file: path.relative(out, file).replaceAll('\\', '/'),
            bytes: bytes.length,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          };
        });
      fs.writeFileSync(
        path.join(out, 'asset-inventory.json'),
        JSON.stringify({ assets }, null, 2)
      );
    },
  };
}
