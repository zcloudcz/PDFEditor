# PDF editor gap analysis — integrated product versus current competitors

Research and source inspection: **2026-10-26**. Scope is `editor.html` / `src/editor`, its imported native editcore, and the shared graphics document. This supplements the earlier feature landscape; it does not treat the upstream BentoPDF tool catalogue as delivered functionality. No implementation or deployment is part of this report.

## Findings

The application has a credible local editing foundation: existing text and image editing, search/replace, blank-document creation, continuous view, and a graphics layer sharing the document. The largest practical gap is integration of ordinary PDF workflows (review annotations, forms, OCR, safe redaction, complete page organization), followed by robust preservation and output verification. Professional Office reconstruction, accessibility remediation, print production and trusted signatures are distinct engineering programs, not toolbar additions.

**Do not promise Acrobat parity.** A finite support profile with measured fidelity is feasible under OSS-only and zero license fees. Full desktop/editor/service parity includes infrastructure, proprietary ecosystem interoperability, specialist validation and ongoing maintenance. Zero license fees do not remove engineering, compute or service costs.

## Current vendor evidence

All links below were retrieved on 2026-10-26. Unless an update date is given, the page did not establish a publication date. Advertised features are evidence of vendor scope, not an independent quality benchmark. Desktop, browser, mobile, tiers and separate signing products must be distinguished; this is not a pricing recommendation.

| Reference | Current documented strengths relevant to our gaps | Qualification |
|---|---|---|
| [Adobe Acrobat features](https://www.adobe.com/acrobat/features.html) | Existing text/images, page organization, merge/split, review markup and conversion within one workflow | Product-family page; do not attribute everything to free Reader or every web edition |
| [Foxit PDF Editor](https://www.foxit.com/pdf-editor/) | Editing, Office conversion, forms, OCR, comparison, password protection, DMS; Editor+ adds signing requests and Smart Redact | Page explicitly separates subscriptions, perpetual desktop and cloud/AI/service features |
| [PDF-XChange Editor V11 manual](https://help.pdf-xchange.com/pdfxt11/features-overview.html) | Granular content/page tools, annotations and measurements, bookmarks, forms, accessibility, security, conversion, macros | Manual covers feature families; entitlement varies by edition. No assumption that all are free |
| [Nitro PDF editor](https://www.gonitro.com/pdf-editor) | Editing, OCR, forms, annotations, organization and protection | Page says updated September 21, 2026; Nitro Sign/Automate are separate products |
| [Nitro OCR modes](https://www.gonitro.com/user-guide/pro/article/ocr-an-existing-pdf) | Distinguishes searchable output from searchable-and-editable reconstruction, with page ranges | Important acceptance distinction for our OCR backlog |
| [Sejda catalogue](https://www.sejda.com/) | Task-oriented merge, alternate mix, organize, split by bookmark/size/text, edit and fill/sign | Web and desktop are distinct; useful workflow-discovery benchmark |
| [PDFgear](https://www.pdfgear.com/) | Editing, markup, OCR, Office/image conversion and batch conversion; separate eSignGear service | Free product advertising is not evidence of OSS licensing. Vendor claims of lossless conversion are not adopted as measured fact |

Specialist sources: Adobe's [Reading Order tool](https://helpx.adobe.com/acrobat/using/touch-reading-order-tool-pdfs.html) (updated February 26, 2026) exposes remediation beyond visual layout. Its [redaction workflow](https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/redact.html) distinguishes applying removal from displaying marks. [Output intents](https://helpx.adobe.com/acrobat/using/output-intents-pdfs-acrobat-pro.html) (updated February 26, 2026) document a print-production concern distinct from ordinary PDF export. The old general Adobe preflight URL redirected to the desktop help index during this research; it is not used as current feature-specific evidence.

## Evidence boundary in our application

The root entry `src/editor/main.ts` imports document controls, studio host and `src/js/editcore/app.js`. It does not import the upstream annotation/form/OCR tool pages. `docs/architecture/upstream-map.md` identifies those candidates, but does not prove they are integrated. File pointers below use symbols as stable anchors because concurrent localization work changes line numbers.

Status definitions:

- **Implemented**: reachable integrated workflow, within the stated narrow scope; not a claim of universal fidelity.
- **Partial**: some integrated capability exists, but the family has material omissions or preservation limits.
- **Not integrated**: upstream candidate exists, but is not part of this shared-editor workflow.
- **Missing**: no complete integrated implementation established; specialized research may still discover reusable internals.

Recorded browser evidence in `MEMORY.md` verifies Czech existing-text edits, new pages, dimensions, native/graphics roundtrip and exported graphic text. It records 1,129 tests/70 files plus build/typecheck for the prior unified-editor milestone; this report did not rerun tests or certify later concurrent changes. It explicitly leaves Office interoperability and native-source distribution gates open.

| Family | Status and actual integrated evidence | Remaining gap / support boundary |
|---|---|---|
| Open/view/navigate | **Implemented** for local open, zoom, page/width/height fit, continuous pages: `document-controls.ts`, `page-settings.ts`, `editcore/continuous-pages.js` | Benchmark large documents/mobile memory, search navigation, keyboard/assistive use; not desktop viewer parity |
| Create PDF | **Implemented** A4/Letter/custom size/orientation and append blank: `document-controls.ts:setupDocumentControls`, `app.js:addBlankPage` | Structural history is not fully unified with native text history |
| Existing text | **Partial** paragraph/run changes, formatting/reflow controls and move/resize: `app.js:commitParagraph` call sites, `core.js` | Arbitrary PDFs lack authoring structure; subset fonts, complex positioning, ligatures, vertical text, bidirectional/shaping cases need corpus coverage |
| Fonts and languages | **Partial** local eng/ces fallback in `main.ts`, font controls/local font access in `app.js` | UI translation is not document-language support. Noto/Arabic names and debug repros do not establish shipped font assets or verified Arabic/Indic/CJK editing. Verify shaping, glyph coverage and selectable Unicode per script |
| Search/replace | **Implemented** reachable find UI and current/all replacement: `editor-markup.html:findbar`, `app.js:findStepScan/replaceAllScan` | Mixed formatting, accents and long multi-page scans need dedicated acceptance; do not list this as wholly missing |
| Images/base objects | **Partial** replace, transform, insert, delete; `app.js:replaceImageFromBlob`, object handlers; matching markup buttons | Group/clipping/transparency/soft-mask edge cases and cross-reader output fidelity remain bounded |
| Graphics/text overlays | **Implemented** editable model, templates, images/basic shapes and layer/page controls: `studio/model.ts`, `canvas.ts`, `host.ts` | Overlay shapes are not annotations, form fields, redactions or certificate signatures |
| Page organization | **Partial** studio duplicate/move/delete and native append; `model.ts:duplicatePage/movePage`, `exports.ts:exportPdf` | Full merge/split/extract/rotate/crop UI not established. Structural export refuses forms/outlines/attachments when page order/count changes; destination/tag preservation still needs explicit fixtures |
| Annotations/review | **Not integrated** upstream `src/js/logic/edit-pdf-page.ts` has annotation viewer | Add standards-based highlights, notes, ink, replies, status, stamps, XFDF interchange; graphics remain a different layer |
| Forms | **Not integrated** upstream `form-creator.ts`, `form-filler-page.ts` | Fill/save/create AcroForm fields, appearance streams, tab order, data interchange; explicitly decide XFA and calculation support rather than execute arbitrary PDF JavaScript |
| OCR/scan cleanup | **Not integrated** upstream `utils/ocr.ts` and Tesseract runtime | Searchable CZ/EN with local assets first; orientation/deskew, correction and editable reconstruction are separate scope |
| Redaction/sanitization | **Not integrated** annotation redaction and `utils/redact-document-data.ts` are candidates | Never wire legacy `logic/redact.ts` rectangle helper. Need text/image/vector removal, hidden-data scope and recovery/source-copy handling across `.zpdf` and IndexedDB |
| Encryption/permissions | **Partial** password opening and explicit unencrypted-export confirmation: `main.ts:setConfirmPlaintextExport`, `app.js:saveFile` | No integrated password-protected output/security policy panel. Permissions are not DRM; state actual output encryption and access restrictions separately |
| Signatures | **Partial** native signature detection/edit notice and incremental save intention in `app.js:openFile/saveFile` | No complete certificate trust validation/signing workflow. Preserving a signed revision does not validate the changed document; studio export is not a demonstrated signature-preserving path |
| Signature appearance | **Partial** image/text graphics can depict a signature | No dedicated signature capture workflow established. Appearance alone is not cryptographic signing or a remote signing audit trail |
| Version comparison | **Not integrated** upstream candidates only | Aligned visual/text diff, inserted-page handling, reviewed changes and exportable report |
| Navigation/document metadata | **Not integrated** as editing workflows; source may retain data | Bookmark/link/destination/attachment/XMP editors, repair after page changes; preservation must be measured independently |
| Page furniture | **Not integrated** semantic workflow | Headers/footers, page numbering, Bates ranges, watermarks; generic text/graphics do not equal managed counters |
| Images/vector export | **Partial** PDF/PNG/JPEG/WebP/SVG in `studio/exports.ts` | SVG rejects source-PDF backgrounds; raster exports have canvas limits. Native PDF base retained for PDF export subject to structure limits |
| Office/table conversion | **Partial** studio PPTX export only; `exports.ts:exportPptx` | Uniform slides required; text/basic geometry editable, other artwork/source PDF background rasterized. No general DOCX/XLSX/PPTX import or PDF-to-Office reconstruction; no Office visual verification |
| Compression/repair | **Not integrated** utility candidates upstream | Loss-aware optimization, structural repair, blank/duplicate detection with preview, no silent rasterization |
| Accessibility/PDF-UA | **Partial** existing tagged-image alt-text control in markup and `app.js:pendingAlt`; tag surgery exists | No full tags tree, reading-order/table/form remediation, UA validation or manual accessibility evidence. UI accessibility and PDF accessibility are separate |
| PDF/A/preflight/PDF/X | **Missing** integrated validated workflow; native PDF/A edit notice exists | Selected conformance profiles, embedded fonts/color management, independent validator; no conformance merely from metadata |
| Batch/automation | **Not integrated** document queue/workflow engine | Bounded memory, cancellation, isolated failures, presets; no multi-user automation service |
| Recovery/history/offline | **Partial** `.zpdf`, graphics recovery and histories: `studio/project-io.ts`, `recovery.ts`, `host.ts`, native history | Native edits require save/synchronization; graphics-only recovery is not whole-document autosave. Full offline asset/install/update verification pending |
| Collaboration/security/admin | **Missing** remote review/accounts/roles/SSO/audit/retention | Local browser processing is a privacy property, not an enterprise security/compliance certification |
| Specialist/AI | **Missing** complete measurements, portfolios/3D/media authoring, AI assistant | Separate user-demand gates; avoid loading active document content or adding remote AI as a hidden dependency |

## Feasibility under OSS-only, license budget zero

These are engineering assessments, not guarantees of available quality. The current browser-only document boundary remains mandatory. A self-hosted backend is an optional future product mode requiring an explicit scope/privacy decision, not permission to upload documents now.

| Delivery class | Suitable scope | Principal barrier |
|---|---|---|
| Browser-local, practical incremental work | Page tools, annotations, AcroForms, search/replace hardening, metadata, bookmarks, counters, basic visual compare, graphics exports, recovery | Shared transactions, native/overlay ownership, preservation and UI integration |
| Browser-local, computationally heavier | OCR, image compression, large-file comparison, redaction object surgery, script shaping | WASM/worker feasibility, CPU/RAM/canvas ceilings, cancellation, asset payload, correctness corpus |
| Optional local companion or self-hosted processing | Office rendering, larger OCR batches, independent PDF/A/UA validation, controlled headless conversion | Native/runtime packaging, isolation, font availability, operations and privacy. Server is a deployment choice, not proof browser execution is impossible |
| Trust/infrastructure program | Certificate validation, timestamps/revocation, remote signature requests, shared review and enterprise administration | Trust stores, revocation freshness, identity, key custody, authentication, audit delivery/storage and maintenance; library availability alone does not supply this |
| Quality research program | Editable scan reconstruction, complex PDF-to-Word/tables, automatic accessibility repair, print preflight and local AI | Missing document semantics, representative benchmarks, specialist review, language/fonts, inference resources; no blanket fidelity promise |

Candidate licensing evidence, checked 2026-10-26:

- [Tesseract source license](https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE): Apache-2.0 engine candidate. Independently pin/check wrapper, WASM build, language data and any scan-cleanup components; an engine license is not an asset inventory.
- [qpdf repository](https://github.com/qpdf/qpdf): Apache-2.0 main project; distribution includes separately noticed components. [Official scope](https://qpdf.readthedocs.io/en/stable/overview.html) includes structural transformations/encryption but explicitly excludes content-stream semantics and conversion to other formats. It is not a redaction/OCR/Office engine.
- [LibreOffice licenses](https://www.libreoffice.org/licenses/): MPL-2.0 distribution with other component licenses. Candidate for an optional isolated Office-rendering service/companion; not evidence of faithful inverse PDF-to-Office reconstruction. Fonts and filters require their own audit.
- [veraPDF](https://verapdf.org/home/): GPLv3+ or MPLv2+; PDF/A and PDF/UA machine-check validation candidate. Machine checks do not establish correct human reading order or meaningful alternative text.
- Existing native fork provenance remains governed by `docs/legal/source-provenance.md` and `components.csv`: matching checked-in WASM is not a reproducible rebuild. Complete source/notices gates remain open. Do not relabel the whole fork MIT from a package manifest.
- For future AI, a permissive code or weights license is not proof that the complete model/system meets the repository's OSS requirement. Check weights, tokenizer, code, training/data information, usage restrictions and redistribution separately against a declared policy; the [OSI Open Source AI Definition 1.0](https://opensource.org/ai/open-source-ai-definition) requires more than downloadable weights. No model is approved by this report.

## Prioritized roadmap with acceptance gates

Horizons express sequence, not an unsupported delivery-date estimate. Every task must include cancellation/failure handling, local-only network checks and independent inspection of saved output.

### Short term — coherent, safe core

1. **P0: complete distribution and preservation gates.** Finish exact native build inputs, reproducible-build evidence/corresponding sources and notices. Add a support manifest for encrypted, signed, tagged, form-bearing and attached-file PDFs. Acceptance: every advertised path either preserves the declared structures in independent parsers/readers or refuses with a specific explanation before modification; no silent rasterization. Dependency: provenance ledger and representative corpus.
2. **P0: shared document transactions/recovery.** Define native/base/graphic revision identity and one dirty-state/save policy before adding another editor engine. Acceptance: edit native text + graphics, reload/crash/reopen a saved checkpoint and independently recover both; undo boundaries shown before destructive rebase; rejected/cancelled operations retain the old document. Sensitive-data purge must remove recoverable source copies when redaction is later applied.
3. **P1: page organization and review.** Add merge/split/extract/reorder/rotate/crop plus interoperable annotations through the common transaction interface. Acceptance: a mixed-size/rotated/CropBox fixture with internal links, outlines, forms and tagged content retains references; imported/exported annotation appearance and data match in two independent readers. Unsupported combinations refuse, not silently flatten.
4. **P1: AcroForm fill/save, then creation.** Acceptance: text, checkbox, radio, choice and duplicate-name fields reopen with correct values/appearances and keyboard order; original field semantics remain intact. Explicitly label unsupported XFA/calculation actions. Dependencies: annotation/form ownership and structure-preserving save.
5. **P1: searchable CZ/EN OCR.** Acceptance: publish character/word error rates on a fixed clean/noisy Czech-English corpus, exact text-layer alignment checks, untouched-page image comparisons, range/cancel tests and measured peak memory on declared hardware. Ship local pinned worker/core/models with no runtime CDN requirement. Editable reconstruction remains out of scope here.
6. **P1, security gate before availability: true redaction + sanitization.** Acceptance: planted secrets in text, images, vector/text overlaps, comments, attachments, metadata, layers, old revisions and recovery/project data are absent after the declared removal operation, verified using decompression/object inspection, text extraction and rendering. State supported scopes; refusal is required for unhandled content. No signed incremental output preserving removed secrets.

### Medium term — practical professional workflows

7. **P1: font/script support profiles.** Publish tested scripts rather than equating translated UI with editing coverage. Fixtures must cover Czech accents, RTL mixed numbers, Arabic joining, Indic shaping, CJK and font substitution; compare exported visual positions and extracted Unicode. Ship only fonts whose sources/notices are cleared. Dependency: typography engine and per-script assets.
8. **P2: protected export and signature inspection.** Password/permission settings roundtrip through an independent parser; wrong-password behavior tested; encryption state visible at export. Signature panel separates signed byte range, post-sign changes, cryptographic result and trust status. Unknown/offline revocation status remains explicit; no claim of qualified signing.
9. **P2: compare/navigation/document utilities.** Visual/text comparison aligns inserted/deleted pages; fixture changes must all appear in report while OCR noise can be reviewed. Add bookmarks/destinations, metadata/attachments, numbering/Bates, watermarks and image extraction. Each operation has deterministic range/output tests.
10. **P2: batch, optimization and offline.** Queue 20 mixed valid/invalid documents with cancellation and bounded-memory evidence; one failure does not discard others. Optimization reports size change and declared losses; forms/tags/text survive preservation mode. Offline acceptance: a fresh installed asset set completes advertised flows with network disabled, and upgrades do not corrupt recovery.
11. **P2: conversion fidelity study.** Establish a versioned corpus of columns, tables, charts, Czech fonts, footnotes and mixed page sizes. Score visual similarity, text order, editability and table structure separately; open produced PPTX in LibreOffice and Microsoft PowerPoint for interoperability evidence (test infrastructure does not authorize proprietary runtime shipping). Report supported subsets; go/no-go separately for Office-to-PDF, table extraction and inverse reconstruction.

### Long term — bounded specialist programs

12. **P3: accessibility and archival.** Start a tags/reading-order inspector and limited remediation. Acceptance: chosen PDF/UA and PDF/A profiles pass the relevant independent machine validator, plus documented manual screen-reader/reading-order checks for UA. Preserve validation reports; revalidate after edits. Dependency: structure-aware authoring and validator integration; PDF/A profile selection must be explicit.
13. **P3: print production.** Define one initial print target with a printing expert before implementing PDF/X, output intent, spot/CMYK handling, overprint, transparency and image-resolution checks. Acceptance: target profile validator plus independently rendered/separation-tested print corpus; no marketing claim of professional preflight from RGB screen output alone.
14. **P3: local signing feasibility.** Prototype certificate signing and verifier interoperability with test keys; separate incremental-save correctness, key storage and trust/revocation/time evidence. Hardware-backed/remote/qualified signing requires its own architecture and specialist assessment. This roadmap makes no legal-validity promise.
15. **Separate optional product decision: shared review, remote signing, enterprise admin and AI.** Require explicit server/privacy mode, threat model, operating budget, roles/audit/retention and recovery tests before implementation. AI requires an approved source/license model inventory, offline hardware benchmark and hallucination-resistant user confirmation for destructive suggestions. Ordinary editing must remain usable without these services.

The release criterion is a reproducible set of supported user journeys and trustworthy saved files, not matching competitors' advertised feature counts.
