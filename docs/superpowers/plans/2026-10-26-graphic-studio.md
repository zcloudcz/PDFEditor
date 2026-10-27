# Graphic studio implementation and verification

Date: 2026-10-26. Status: implementation, core browser roundtrip, recovery, final regression suite and editor build verified. Remaining acceptance items are listed below. This document records the local Canva-like editing scope requested by the user. It is not a release or full Canva/Acrobat feature-parity claim.

## Implemented scope

- One document in one application, with a persistent shared document toolbar and two toolsets: original PDF text editing and a graphics side panel/canvas. Entry is available from a blank document, template or an open PDF through **Grafické prvky**.
- Editable text, rectangle, ellipse, line, arrow, star/heart paths and embedded raster images. Properties include position, size, rotation, opacity, fill/stroke, text alignment and font size/face; images have normalized crop controls.
- Selection, multiple selection, dragging, resize, rotation, alignment, grouping, layer ordering, locking, duplication, deletion, keyboard movement and studio undo/redo.
- Page selection, addition, duplication, deletion and ordering; appended PDF pages remain associated with the embedded source PDF.
- Six original templates: A4 flyer, A4 proposal, 90 × 50 mm business card, three-slide 16:9 presentation, square social post and A3 poster.
- A local brand kit with name, colors, Liberation Sans regular/bold/italic and PNG/JPEG logo. New template instances use the saved kit; existing designs are not restyled automatically.
- Portable `.zpdf` JSON projects, opening validated project files, local IndexedDB recovery, recovery opt-out and explicit deletion of the local recovery copy.
- Shared PDF, PNG, JPEG, WebP, SVG and PPTX exports that synchronize current native text edits before exporting. Multiple image pages are packaged as a ZIP. Switching toolsets requires no manual export/import or flattening of graphic objects.

## Architecture and ownership

| Module | Responsibility |
| --- | --- |
| `src/editor/studio/types.ts` | Versioned portable project/page/object schema and canvas controller contract |
| `canvas.ts`, `canvas.css`, `model.ts` | SVG editing surface, properties/layers/pages, selection, geometric operations and project history |
| `exports.ts` | PDF page backgrounds, vector PDF output, image/SVG/PPTX exports and source-PDF coordinate transforms |
| `templates.ts`, `templates.css`, `brand-kit.ts` | Original compositions, template picker and local brand-kit validation/UI |
| `project-io.ts`, `recovery.ts` | Project validation/serialization and IndexedDB recovery |
| `host.ts`, `host.css` | Persistent document toolbar, toolset switching, dialogs, shared exports, file import/download, preview overlays and recovery scheduling |
| `document-bridge.ts` | Source-only native base preparation, visible page dimensions and merging updated native PDF snapshots while retaining graphic objects |

`StudioProject` has `version: 1`, `name`, `pages` and optional base64 `sourcePdf`. Each page has an ID, name, dimensions, background, ordered objects and optional zero-based `sourcePageIndex`. Coordinates are PDF points from the page's top-left. Rotation is clockwise about an object's center. Path geometry uses a normalized 100 × 100 view box; image crop values are normalized fractions. Font, color, size, embedded image and object-count boundaries are checked when loading or saving a project.

The displayed source-PDF background is a rendered preview. The original bytes remain embedded in `sourcePdf` for PDF export; the background preview does not replace them. Native PDF objects are not automatically converted into studio text boxes or shapes. New studio objects are separate overlays.

`prepareNativeDocument` creates the native editing base with graphic objects excluded, then normalizes page source indices while retaining those objects in the project. Native text tools show the graphic layer as a noninteractive preview overlay. **Grafické prvky** merges the latest native snapshot into the existing project through `mergeNativeSnapshot`; object identities and editable graphic content remain intact. **Upravit text PDF** changes toolsets within the same document. Shared **Uložit projekt** and **Exportovat** also synchronize the latest native base when used from the text toolset.

Merge assumes existing native pages retain their order, allows appended pages and rejects fewer pages or changed visible page dimensions that would lose/misplace objects. Native base preparation may require a structural rebase. If source bytes and page layout are unchanged, the host skips native reload so native undo history survives the toolset switch. History contexts are not completely unified: graphics history currently retains up to 80 project states, and native text history remains separate. A structural rebase may reset native history. The earlier native append-page limitation also remains: appending native pages can reset prior native text undo history after explicit confirmation.

## Persistence and privacy

Brand settings use localStorage (`pdf-editor-brand-kit-v1`). Logo uploads are limited to PNG/JPEG, 2 MB, valid signature and successful image decode, with a 16-megapixel upload limit. Project recovery uses IndexedDB (`zcloud-pdf-studio`, store `recovery`, key `latest`). Recovery writes are debounced and serialized. The UI exposes opt-out, restore and deletion. Opening the empty studio does not immediately overwrite the recovery slot.

Automatic recovery is explicitly **graphics-only** (**Automatická obnova grafických úprav**). Live native text edits do not trigger automatic snapshots. Users must choose **Uložit projekt** to synchronize/download those edits, or return to **Grafické prvky** to synchronize them into the project and schedule recovery when enabled. Shared export synchronizes native changes for the output, but should not be described as native-text autosave.

The user-facing `.zpdf` download is JSON, including embedded image data and source PDF where applicable. It is the editable interchange format; export PDFs and PPTX files do not preserve all studio editing semantics. ZIP project helpers exist in `project-io.ts`, but the current host opens/downloads JSON projects rather than a ZIP project UI.

Document processing stays in the browser; no upload or remote document service is introduced. Local recovery is not a durable backup: storage availability/quota can fail, and the UI instructs users to download a project in that case.

## Export contracts and limits

| Output | Implemented behavior and boundary |
| --- | --- |
| PDF | Embeds local fonts and adds text/vector artwork over source pages without intentionally rasterizing the complete document. When source page count/order is unchanged, operates on the loaded source document. |
| Restructured PDF | Copies selected source pages into a new document when count/order changes. Export rejects detected populated forms, outlines, embedded attachments or associated files in this branch; do not promise preservation of all PDF document-level structures. |
| PNG/JPEG/WebP | Explicit raster export with chosen scale/quality, pixel limits and format-support checks; multiple pages become ZIP. |
| SVG | One graphic page; source-PDF backgrounds are rejected rather than silently omitted. |
| PPTX | Uniform slide dimensions required. Supported text/basic shapes remain editable; source-PDF backgrounds, paths and raster artwork become images. Office/PowerPoint interoperability and layout fidelity are not yet manually verified. |

Imported PDFs are loaded through pdf-lib. Password-protected/unsupported inputs may fail. PDF append uses page-copy semantics and rejects imported catalogs containing `AcroForm`, `Outlines`, `Names`, `OCProperties` or `StructTreeRoot`; this is a conservative protection against losing document-level structures, not a comprehensive preservation guarantee. A graphic overlay is not redaction.

## Verification ledger

Template/brand worker evidence: `npx vitest run src/editor/studio/templates.test.ts --maxWorkers=2` passed **6 tests** on 2026-10-26. Tests cover six formats and page bounds, fresh IDs/independent copies, brand application through the picker, malformed brands/logos/storage, local save/reset and UI cleanup. Initial sandbox run failed before executing tests because Windows denied a Vitest temporary-file rename; the same test command passed outside the sandbox. A TypeScript check passed before the final small font-selector extension; parent final typecheck remains the integration authority.

Parent acceptance checklist (record actual results before marking complete):

Parent-reported integration evidence on 2026-10-26:

- Browser produced actual downloads in all six formats: PDF, PNG, JPEG, WebP, SVG and PPTX. PNG was visually inspected. PDF.js independently extracted the expected Czech template text from the downloaded PDF. PPTX download success does not establish Office layout compatibility.
- The template text was changed to `Jeden editor.\nVíce možností.`. After switching to native PDF text tools, `Text PDF zůstává zachovaný.` was added, then the user flow returned to graphics and saved `.zpdf`. Independent project parsing and PDF.js inspection confirmed **12 editable graphic objects**, the graphic text in the object layer and the native text in the source PDF. Both remained present without flattening the graphic layer.
- The shared document header remained visible through the toolset roundtrip. Testing used a separate QA tab; the user's live tab was not touched.
- Final full suite passed **1,129 tests in 70 files** (`tests-studio-final.log`), superseding the intermediate 1,127/70 full run and 54/6 focused run. Final TypeScript check passed. `npm run build:editor` passed with **215 modules**.
- Recovery reopened the saved project in a **new browser tab**, retaining the Czech graphic text and native PDF base. Screenshot: `.superpowers/sdd/2026-10-25-online-pdf-editor/unified-editor-preview.jpg`.
- Ctrl/Cmd + S now invokes **Uložit projekt** in both toolsets.

- [x] Final full regression suite: 1,129 tests/70 files passed, recorded in `tests-studio-final.log`.
- [x] Final `npx tsc --noEmit` and `npm run build:editor` passed; build processed 215 modules.
- [ ] Browser: open each template; inspect readable Czech text, layout and font rendering.
- [ ] Browser: drag/resize/rotate, select/group/lock, reorder layers/pages and verify undo/redo.
- [ ] Browser: save/reopen `.zpdf`, restore recovery, disable/delete recovery, handle storage failure.
- [x] Browser: restore saved project in a new tab; Czech graphic text and native PDF base retained. Recovery disable/delete and storage-failure browser cases remain unverified here.
- [ ] Browser: import PDF; preserve existing content while adding studio objects; verify rotated/CropBox pages.
- [ ] Browser: alternate text and graphic toolsets; preserve editable object IDs/content, latest native text edits, shared toolbar and shared exports without duplicated graphics.
- [x] Browser core roundtrip: edited graphic text → native text addition → graphics → saved project; independent inspection confirmed 12 editable objects and both texts in their corresponding layers.
- [x] Browser: actual downloads for PDF, PNG, JPEG, WebP, SVG and PPTX; independent Czech PDF text extraction and PNG visual inspection.
- [ ] Browser: verify graphics-only recovery messaging; native changes survive explicit project save or return to graphics, with no claim of native autosave.
- [ ] Verify unchanged-base switches retain native undo; record structural-rebase history limitations.
- [ ] Inspect exported PDF text/vector content, page count/dimensions and source preservation; exercise guarded restructuring failures.
- [ ] Browser: image exports/ZIP, SVG source-background rejection, PPTX export and mixed-size rejection.
- [ ] Independent review findings resolved or explicitly recorded.
- [ ] Separate Office interoperability test before making a PowerPoint compatibility claim.

Upstream engine rebuild, source/license notices and existing P00/P01 release gates remain governed by the earlier project plan. This local studio work does not close those gates. No commits, push, publication or deployment were performed.
