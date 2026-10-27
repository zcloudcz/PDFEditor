# Pinned upstream map

Baseline: BentoPDF v2.8.10 / 9aae81e73cdf286b5663b8d95fcef0c0a3f141a9.

| Responsibility | Files / interfaces |
| --- | --- |
| Native content editing | src/js/editcore/core.js: PdfEngine.create/open/loadPage/buildModel, commitParagraph/previewParagraph, add/delete/moveParagraph, replace/insertImage |
| Native export | core.js: saveSpliced(opts), save(opts); app.js: saveFile(), openFile(), engineReady, setOnSaved |
| Native UI | src/pages/edit-pdf-text.html; src/js/logic/edit-pdf-text-page.ts; src/js/editcore/app.js |
| Annotations/viewer | src/js/logic/edit-pdf-page.ts: EmbedPDF.init, registry annotation/export/redaction plugins |
| Page operations | src/js/logic/organize-pdf-page.ts, rotate-pdf-page.ts, delete-pages-page.ts, merge-pdf-page.ts, split-pdf-page.ts |
| Forms | src/js/logic/form-creator.ts; form-filler-page.ts embeds PDF.js |
| OCR | src/js/utils/ocr.ts: performOcr; tesseract-runtime.ts: createConfiguredTesseractWorker |
| Redaction | edit-pdf-page.ts commits pending redactions; utils/redact-document-data.ts scrubs document data |
| History | core.js historyBeginStep/EndStep, editStep, historyUndo/Redo; app.js snapshots (20 steps / 256 MiB) |
| Recovery | No document recovery located; font-loader.ts IndexedDB is font cache only |
| Workers | annotation viewer worker:true; PDF.js setup-pdf-worker.ts; Tesseract worker. Native text WASM currently runs in the UI context |

Do not wire `src/js/logic/redact.ts`: the unused legacy helper only draws black rectangles.
The annotation viewer and native content editor are separate document owners. Integration must transfer current bytes and define history boundaries.
Page organization creates a new PDF with copied pages: explicitly verify forms, outlines, tags and links.
Native saveSpliced has full-save fallbacks and Type3 surgery: verify preservation independently.
