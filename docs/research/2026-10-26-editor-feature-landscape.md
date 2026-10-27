# PDF editor feature landscape and expanded backlog

Research date: 2026-10-26. Scope: Adobe Acrobat family, Foxit PDF Editor, Nitro PDF Pro, PDF-XChange Editor/Plus, Sejda, Smallpdf, iLovePDF and PDFgear. Vendor documentation establishes advertised capability, not independently measured quality. Desktop, web, mobile and paid editions differ; this report does not assume feature parity across them. No subscriptions or proprietary SDKs are proposed.

## Competitor evidence

| Product | Useful reference strengths | Primary sources |
| --- | --- | --- |
| Adobe Acrobat | Content editing; page operations; conversion; review and signature requests; advanced document integrity and publishing tools | [Features](https://www.adobe.com/acrobat/features.html), [Preflight](https://helpx.adobe.com/acrobat/using/analyzing-documents-preflight-tool-acrobat.html) |
| Foxit PDF Editor | Forms, version comparison, OCR corrections, measurements, DMS/review workflows; distinguishes editor from signing services | [Feature/plan comparison](https://www.foxit.com/pdf-editor/pricing/) |
| Nitro PDF Pro | Paragraph reflow, PDF/Office conversion, compare, Bates numbering, form extraction and batch processing | [Editor](https://www.gonitro.com/pdf-editor), [User guide](https://www.gonitro.com/user-guide) |
| PDF-XChange Editor/Plus | Detailed object controls, measurement annotations, accessibility, dynamic stamps; Plus adds enhanced OCR, form recognition and compare | [Current product catalogue](https://www.pdf-xchange.com/product/pdf-xchange-editor) |
| Sejda | Task-oriented operations: split by bookmarks/text/size, alternate merge, metadata, image extraction, deskew and workflow chains | [Tool catalogue](https://www.sejda.com/) |
| Smallpdf | Simple discovery of conversion, compression, page, markup and signing tasks; AI tools and plan-dependent text editing | [Tools](https://smallpdf.com/pdf-tools), [Plan comparison](https://smallpdf.com/pricing) |
| iLovePDF | Broad utility catalogue, batches, workflows, compare, forms, PDF/A, repair and Markdown export | [Catalogue](https://www.ilovepdf.com/user/premium), [Workflow documentation](https://www.ilovepdf.com/help/documentation) |
| PDFgear | Existing-content editing, annotations, OCR and batch conversion; desktop/web capabilities must be checked separately | [Product overview](https://www.pdfgear.com/) |

## Distinctions our product must preserve

1. Existing-text editing differs from placing a new text box over a page. Both belong in the portfolio and need distinct tests.
2. Searchable OCR differs from reconstruction into editable paragraphs. Nitro documents these as separate modes: [OCR modes](https://www.gonitro.com/user-guide/pro/article/ocr-an-existing-pdf). First deliver searchable CZ/EN output; add reconstruction only after a fidelity study.
3. A drawn signature, certificate signature, and a remote signing workflow are different products. Adobe documents trust validation separately from timestamps: [validation](https://helpx.adobe.com/in/acrobat/desktop/e-sign-documents/manage-digital-signatures/validate-digital-sign.html), [timestamps](https://helpx.adobe.com/in/acrobat/desktop/e-sign-documents/fill-sign-documents/add-time-stamps.html). Initial local signing must not claim qualified status or online trust validation.
4. Redaction removes selected content; sanitization removes other hidden data. Adobe explicitly separates those steps: [redaction](https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/redact.html), [hidden information](https://www.adobe.com/acrobat/resources/how-to-redact-a-pdf.html). Our export must state its actual scope and remove unsafe recovery copies.
5. Accessible UI is not the same as an accessible PDF. PDF tags, reading order, alternate text, table structure and form labels are a separate feature family: [Adobe reading-order tools](https://helpx.adobe.com/acrobat/using/touch-reading-order-tool-pdfs.html).
6. PDF/A conversion is not merely changing metadata. A standards validator and explicit profile are required. Likewise print preflight examines fonts, colors, transparency and resolution, not just whether a file opens: [Adobe preflight](https://helpx.adobe.com/acrobat/using/analyzing-documents-preflight-tool-acrobat.html).

## Coverage matrix against our actual state

`U` = a related upstream module exists, integration/fidelity still needed. `V` = limited synthetic verification. `N` = new work or research. These are not delivered feature counts. Priorities are proposed sequencing within the user's expanded portfolio request.

| ID | Capability family / individual scope | Current foundation | Priority | Gate / dependency |
| --- | --- | --- | --- | --- |
| F01 | View, zoom, find, selectable text, thumbnails, keyboard navigation | U | Core | Browser journeys, large-file behavior |
| F02 | Edit existing paragraphs, fonts, sizes, colors, alignment and reflow | U + V | Core | Unsupported fonts/types handled explicitly |
| F03 | Add text; insert/replace/move/resize images; edit shapes | U | Core | Correct coordinate transforms and export |
| F04 | Find/replace across pages | U | Next | Every match previewed; mixed formatting preserved |
| F05 | Merge, split, reorder, rotate, insert, duplicate, delete, extract pages | U | Core | Stable page identity, forms/bookmarks/internal links |
| F06 | Crop/resize, page boxes, N-up, booklet, alternate merge | U | Next | Geometry preserved; crop is not redaction |
| F07 | Comments, highlights, underline/strikeout, ink, arrows, callouts | U | Core | Annotation round-trip and unified document handoff |
| F08 | Stamps, custom stamps, drawn/typed/image signature appearance | U | Next | Distinguish appearance from cryptographic signature |
| F09 | AcroForm fill/create/edit, tab order, export/import data | U partly | Core | Field types/appearances/duplicate names; data formats need mapping |
| F10 | Automatic form detection and constrained calculations | N | Later | OCR/layout study; no execution of arbitrary PDF JavaScript |
| F11 | Searchable CZ/EN OCR, page ranges, cancel and progress | U | Core | Local worker/core/models, OCR accuracy and alignment |
| F12 | Deskew/orientation, scan cleanup, OCR correction and batch OCR | U partly | Next | Originals preserved; visible quality controls |
| F13 | Reconstruct scanned text into editable layout | N | Research | Compare geometry and recognition on a representative corpus |
| F14 | True region redaction, search-and-redact, preview/apply | U partly | Core | No recovery by extraction, decompression or old revisions |
| F15 | Sanitize metadata, attachments, comments, scripts, hidden layers/data | U partly | Core | Explicit selectable scope; independent parser verification |
| F16 | Password opening, encryption, permission information | U | Core | Do not silently export plaintext; consent and clear output state |
| F17 | Certificate-signature inspection and effect-of-edit notice | U partly | Core | Distinguish signed revision from validity of current revision |
| F18 | Local certificate signing, incremental save, timestamps/LTV | U partly | Research | Trust, private-key handling, verifier interoperability |
| F19 | Remote signing invitations, audit trail, identity verification | N | Separate service | Accounts/backend/delivery/trust providers; not zero-operation-cost |
| F20 | Visual/text comparison of two versions, change navigation/report | U partly | Next | Alignment, inserted pages, OCR noise, reliable diff export |
| F21 | Bookmarks, named destinations, internal/external links and TOC | U | Next | References survive page operations |
| F22 | Page numbers, headers/footers, watermark, Bates numbering | U | Next | Ranges, positions, counters and batch continuity |
| F23 | Metadata inspection/editing and attachment management | U + V limited | Next | XMP/document-info consistency and safe attachment handling |
| F24 | Image-to-PDF; PDF-to-images/text; image extraction | U | Next | Resolution/color/selection and original-content fidelity |
| F25 | Tables to CSV/XLSX; structured text/Markdown | U partly | Research | Real table corpus; reading order and merged cells |
| F26 | Word/Excel/PowerPoint to/from PDF | U via extra engines | Research | Corresponding sources, memory, conversion fidelity; no blanket promise |
| F27 | Compression/optimization with preview and quality settings | U via extra engines | Next | Size versus quality; no silent rasterization or loss of forms/tags |
| F28 | Repair damaged PDF and remove blank/duplicate pages | U partly | Later | Recoverability report; preview false-positive deletions |
| F29 | PDF/A archival profiles and validation | U via extra engines | Research | Profile validator, fonts/color/transparency, signature interaction |
| F30 | PDF/UA checks, tags, reading order, alt text, table/form labels | N | Research | Dedicated validator and assistive-technology testing |
| F31 | Print preflight, PDF/X, output intent, color separations/ink | N | Specialized | Color management and print-specific corpus |
| F32 | Distance/area/perimeter measurements and calibration | N | Later | Page units/scales, transform and annotation interoperability |
| F33 | Layers, portfolios, embedded media/3D | N / needs inventory | Specialized | Safe rendering; no arbitrary active content |
| F34 | Batch queue, saved workflow presets, reusable settings | U partly | Next | Per-document failures, cancellation, bounded memory |
| F35 | Local recovery, history, crash/reload protection | N integration | Core | Consent, atomic checkpoints, redaction-aware deletion |
| F36 | Offline installation/PWA and local file workflow | N integration | Next | Asset completeness/update strategy; optional persistence |
| F37 | Shared review, accounts, cloud storage and team roles | N | Separate service | Changes local-only scope; operational cost and permissions |
| F38 | AI chat/summaries/translation/smart redaction | N | Optional research | Local open model feasibility; no required paid APIs or silent uploads |
| F39 | Create blank PDF; page sizes/orientation/custom dimensions; add blank pages | New dispatch | Core, user requested | Exact page geometry, validation, preserved existing edits |

User testing additionally prioritizes continuous page scrolling and explicit whole-page/width/height fit modes under F01. These are being implemented before the next feature expansion wave.

The mapped upstream files are in `docs/architecture/upstream-map.md`. `U partly` does not authorize wiring an unaudited engine into the product. A module name alone does not establish reliability or complete subfeature coverage.

## OSS and zero-license-budget feasibility

The current pinned native engine, PDF.js/pdf-lib and Tesseract provide candidate paths for the core families. This assessment is based on the inspected repository, not a new claim that any library covers the whole table. New codecs/models/engines require source/license checks before inclusion.

Most local editing and utility functions need engineering time rather than paid services. Serverless static delivery can preserve local document processing. Zero license fees do not mean unlimited free hosting, email delivery, storage, trusted timestamps, qualified signing or AI inference. Remote collaboration/signing and external AI remain separately scoped. Local certificate signing and local AI may be possible but need dedicated feasibility work.

## Backlog ordering

1. Finish the integrated local editor and core export gates: F01–03, F05, F07, F09, F11, F14–17, F35.
2. Expand practical portfolio: F04, F06, F08, F12, F20–24, F27, F34, F36. Use existing modules where audit and fidelity allow.
3. Run bounded research spikes with go/no-go evidence: scanned reconstruction, table/Office conversions, certificates, archival/accessibility and print production.
4. Keep remote services and optional AI modular; their absence must not block ordinary local editing.

A feature is shipped only after integration, independent output verification, failure/cancel tests and a declared support profile. The next plan revision should attach each ID to an implementation owner and acceptance fixture rather than claiming numerical parity with vendor feature counts.
