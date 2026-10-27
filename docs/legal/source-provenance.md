# Source provenance and distribution gate

The application baseline is BentoPDF tag v2.8.10, commit `9aae81e73cdf286b5663b8d95fcef0c0a3f141a9`, from https://github.com/alam00000/bentopdf.

The vendored engine/viewer archives name source revision `051abe5b72a9`. The matching source checkout is `051abe5b72a9219e6b86e1f890fa7d4aca0e8f49` in the locally ignored `bentopdf-pdfium-viewer` directory. Its PDFium submodule resolves to `fce2b000cc7a9e2cabc92db41cd57ca03233f07d`.

The installed `bentopdf-pdfium/editcore.wasm` and source checkout's `packages/pdfium/src/vendor/pdfium.wasm` have the same SHA-256:

```
1860f0b33a1c7d231b78fa9bfedace19739f06e80b1d5f654dd2ea77a7a893ce
```

This establishes a matching checked-in binary, not a reproducible native compilation. Native build scripts use Emscripten 3.1.70 and PDFium's build system; some tool bootstrap inputs remain mutable. A successful native rebuild, exact build-input inventory, corresponding-source archive and complete linked notices remain outstanding before distribution.

Do not infer that the entire viewer fork is MIT from its npm manifest. Its root license/notice describe AGPL modifications over EmbedPDF MIT. Likewise, the outer `packages/pdfium/LICENSE.pdfium` contains only Apache text: the actual PDFium submodule LICENSE/NOTICE also retain original BSD-style terms and third-party terms.

## Product build boundary

The upstream Vite configuration emits all tool pages and copies the whole `public` directory, including unrelated WASM engines. `DISABLE_TOOLS` hides menu items but is not a distribution filter. Empty provider environment variables fall back to public CDNs rather than disabling providers.

Prepare a separate allowlisted editor entry and curated public assets before release. Import only the required editor/viewer modules, avoid the global marketing/tool bootstrap, and copy each asset with its license. For CZ/EN text editing, use the bundled Liberation font. Introduce OCR only after pinning its local worker, core variants and ces/eng models. Retain full source and notices for each shipped component. `components.csv` is an initial inventory, not a claim that all dependencies have been cleared.

## Isolated editor preview (2026-10-26)

`npm run dev:editor`, `npm run build:editor`, and `npm run preview:editor` use
`vite.editor.config.ts`. The existing upstream `build` command is preserved.
The only HTML input is `editor.html`; output is `dist-editor`. Open `/editor.html`
in dev or preview. Deployment under a URL prefix is not validated.

The editor configuration disables Vite's automatic `public` directory copy.
`scripts/editor-assets.mjs` allowlists the local Liberation Sans regular font,
its OFL notice, application and native fork notices, and the PDFium root notices.
The same font URL works in development and the production preview. Imported
JavaScript, workers, styles, and icon fonts are bundled by Vite. Root license
and notice files of packages represented in rendered chunks are also copied.

Every build emits `source-inventory.json` with rendered module paths, installed
package versions, declared licenses, copied notice names, and curated source
paths. `asset-inventory.json` records sizes and SHA-256 hashes of emitted files
(excluding its own hash). These are build evidence, not legal certification.
The build rejects rendered modules for the global marketing bootstrap and known
unsupported conversion/OCR engines. This is a defense against accidental import
regressions, not proof that every possible network request has been removed.

The native source checkout is currently required to build because its notices
are copied from the pinned local checkout described above. Root package notices
do not replace a complete audit of embedded native libraries, font origins,
corresponding-source distribution, or reproducible builds. Those release gates
remain open; the output is for reversible local preview only.
