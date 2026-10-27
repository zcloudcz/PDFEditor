# Parallel development and integration plan

User explicitly authorized parallel implementation on 2026-10-26. This supplements the original P00–P09 plan; it does not mark its gates complete.

## Current dispatch

| Worker | Owned files | Deliverable | Verification |
| --- | --- | --- | --- |
| editor_shell | editor.html; src/editor/**; docs/ux/editor-flow.md; narrowly coordinated host hooks | Own-brand entry, sample PDF, existing protected native editor, open/edit/export | Browser sample journey; keyboard/error states; no marketing bootstrap |
| editor_build | vite.editor.config.ts; package.json scripts; scripts/editor-*.mjs; docs/legal/**; editor-build tests | Separate dev/build/preview, allowlisted assets, source/license inventory | Build succeeds; forbidden engine/module/assets absent; local assets resolvable |
| engine_edges | editor corpus/helpers; editor-edge tests; engine report | Malformed/password/signature/Type3 cases and negative fidelity checks | Independent extraction/render; supported versus rejected outcomes documented |
| coordinator | research docs; plan; integration and cross-module review | Name recommendation, competitive matrix, acceptance review | Review diffs, full tests/typecheck/build, actual browser journey |

Shared checkout, disjoint ownership. Do not revert another worker's edits. No concurrent modifications to package/config/core modules without explicit coordination. No worker commits, pushes, deploys, publishes or purchases. Coordinator integrates only after evidence. User work remains intact.

## Interface decisions

- Single root editor.html loads src/editor/main.ts; shell owns raw inner markup with original editor DOM IDs.
- Preserve editcore/app.js preprocessing, native/snapshot history and serialization. A minimal raw PdfEngine UI would bypass protections and is not an acceptable product shortcut.
- Avoid global upstream main.ts. Page-logic imports can pull qpdf and remote decryption via shared ui/helpers; shell/build workers must isolate these dependencies rather than merely hide tools.
- Local Liberation Sans is the CZ/EN fallback. No unapproved remote engine dependencies in the curated preview.
- Brand is a single configurable value; ZCLOUD PDF Editor is provisional pending user decision.

## Following waves

### User feedback during preview testing

Priority before further portfolio expansion:

1. Fit full page, width and height with explicit modes, responsive recalculation and manual zoom override.
2. Continuous vertical scrolling across all pages with bounded rendering; active editing must target the visible selected page and retain prior changes.
3. Create new PDF with A4/Letter/custom dimensions and orientation; add blank pages without discarding edits.
4. Fix review findings: preflight replacement before closing current engine, confirm discard of dirty edits across every open/drop route, and explicitly disclose/acknowledge unencrypted export of protected input.

Second dispatch: editor_shell owns host fit/create UI; engine_edges owns native continuous-view integration (app.js and native CSS); editor_build owns separate document-safety helpers/tests. Shared hooks are coordinated before integration. Do not silently reload a user's working document during browser validation.

| Wave | Independent work after dependency gate | Integration gate |
| --- | --- | --- |
| B | Stable page identity and document handoff; OCR worker/model provenance and isolated tests; AcroForm preservation tests | Agree one document owner and transaction/checkpoint interface before UI modules write shared state |
| C | Page tools and unified history; annotation/form UI; local OCR UI | Each operation starts from current bytes and preserves unrelated structure; cancel leaves previous checkpoint |
| D | Secure redaction/sanitization; consent-based recovery; batch/export utilities | Redaction invalidates old recovery revisions; coordinate this shared boundary before either ships |
| E | Extended portfolio: compare, bookmarks, numbering/watermarks, extraction, compression | Independent feature tests plus combined workflow regressions |
| F | Accessibility/archival/signature research and implementations; CZ/EN/accessibility review; release packaging | No compliance claims without independent validator; native sources/notices complete |

New competitor-inspired work is tracked in docs/research/2026-10-26-editor-feature-landscape.md. Breadth expands the backlog, not the number of unverified buttons. Existing P00/P01 release gates remain open while reversible local preview integration proceeds under the recorded ruling.

## Shared acceptance rules

Every feature needs observable input/output behavior, independent PDF verification when it mutates content, undo/cancel policy, privacy/network behavior and supported-case limits. Mark a capability `upstream`, `integrated`, `verified` or `deferred`; upstream presence is never counted as delivered product functionality. Signatures and redaction receive separate security review. Full suite, typecheck, isolated build and an actual browser journey are required before reporting the integrated preview as working.
