# Lokální OCR: připnutá vstupní aktiva

Příprava pro T07, 26. 10. 2026. Přítomnost souborů není dokončená OCR funkce ani akceptace kvality.

| Komponenta | Verze/revize | Zdroj | Licence | Stav |
| --- | --- | --- | --- | --- |
| tesseract.js | 7.0.0 z package-lock | https://github.com/naptha/tesseract.js | Apache-2.0, node_modules/tesseract.js/LICENSE.md | Installed API + local dist worker; nebyl přidán nový npm balíček. |
| tesseract.js-core | 7.0.0 z package-lock | https://github.com/naptha/tesseract.js-core | Apache-2.0, installed LICENSE | Lokální core JS/WASM varianty existují; corresponding-source/build audit před distribucí nadále nutný. |
| tessdata_fast CZ/EN | 87416418657359cb625c412a48b6e1d6d41c29bd | https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd | Apache-2.0, tessdata-fast-LICENSE | Dva přesně připnuté modely staženy lokálně; žádný dokument se neodesílá. |

Modely:

- `public/ocr/models/ces.traineddata`: 3 795 684 bajtů, SHA256 `934bcaf97ef3348413263331131c9fa7f55f30db333c711929c124fb635f7e1b`.
- `public/ocr/models/eng.traineddata`: 4 113 088 bajtů, SHA256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.

Model source/project and README: [official tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast). Upstream describes LSTM-only fast integer models, with a speed/accuracy tradeoff; žádný slib přesnosti se tím nepřebírá. [Official local-installation guide](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) popisuje lokální workerPath/corePath/langPath. Při integraci explicitně dodat všechny lokální cesty, `gzip:false` pro připravené nekomprimované modely a nedovolit defaultní CDN fallback.

## Implementovaný lokální řez T07 A

`src/editor/pdf/ocr-service.ts` používá připnutý protokol workeru tesseract.js 7.0.0. Vždy explicitně předává lokální `corePath` a `langPath`, `gzip:false`, `cacheMethod:none`, LSTM OEM 1 a pouze ces/eng. Worker vzniká před první asynchronní inicializací; AbortSignal jej může ukončit i při načítání. Na každou stránku připadá nový worker, limit 120 s; raster pro rozpoznání má nejvýše 12 milionů pixelů a hranu 8192 px. Vstup/výstup má limit 50 MiB, dokument 200 stran. Výstup přidává neviditelný text do původního PDF, původní obraz/vektory nenahrazuje. Editovatelná rekonstrukce je explicitně odmítnuta.

Curated build přidává `ocr/tesseract-worker.min.js` a jeho přiložený licence comment, tři LSTM `.wasm.js` varianty (baseline/SIMD/relaxed SIMD s vloženým WASM), modely a root licence. Všechny dostávají SHA-256 v `asset-inventory.json`. Import celého tesseract balíčku a upstream tesseract-runtime zůstává v hlavním editoru zakázán; jen přesné allowlisted soubory se kopírují. Wrapper vypíná console výstup pouze uvnitř OCR workeru, aby se native diagnostika nedostala do document loggeru.

Evidence: 17 cílených testů ve třech souborech prošlo mimo sandbox po známém EPERM. Nezávislý PDF.js render ověřil pixelovou shodu, český text a zachování formuláře/přílohy při všech čtyřech rotacích a CropBox offsetu. `node scripts/editor-ocr-benchmark.mjs` skutečně spustil lokální engine/modely na čtyřech syntetických CZ/EN clean/light-noise obrázcích: CER/WER 0, 324–568 ms, vzorkované maximum RSS celého Node procesu 161 931 264 B. Přesné zařízení, normalizace a limity jsou v `docs/validation/ocr-benchmark.json`. Není to reálný scan korpus ani příslib přesnosti; browserová paměť tím měřena nebyla.

Dosud neověřeno: skutečné browser worker/offline/cancel journey, browserová špička paměti, úplný audit core transitive notices/native zdrojů a reprodukovatelná kompilace. T07 B (deskew/orientace/náhled/ruční korekce a reprezentativní korpus) a C (editovatelné bloky) zůstávají otevřené. P00/P01 a distribuční brány se tím neuzavírají.
