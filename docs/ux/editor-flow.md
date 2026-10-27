# Editor preview

The first local vertical slice opens a PDF, displays its pages, selects existing text, applies a replacement and exports a new copy. Preserve the native engine and its serialization. This preview is not the full P02–P09 product.

Design: a document workbench with white paper on a cool gray desk. Ink #223047, desk #e9edf3, white #ffffff, action blue #2459c4, muted #64748b, error #b42318. System Segoe UI for controls, Georgia for the empty document invitation; no web-font network dependency. Text and controls are left aligned; the page is centered.

```text
PDF editor       Document name             Open PDF   Export copy
Pages            Page / zoom               Text properties
1                [paper]                   [selected paragraph]
2                [selection targets]       Apply / cancel
                 Status                    Substitution notice
```

The local entry is `editor.html`, with the provisional product name centralized in `src/editor/brand.ts`. It mounts the upstream editor DOM before dynamically importing `editcore/app.js`. Native preprocessing, content protection, undo/redo and export remain in that existing app. The marketing bootstrap and external decryption engines are not imported.

The welcome screen and toolbar can create a blank PDF. The dialog offers A4, Letter, or custom dimensions (25–2000 mm per edge), portrait or landscape. Adding a page uses the native application's append hook, retaining existing edits rather than replacing the document. The native hook explicitly asks before clearing older native undo steps; the appended page itself uses snapshot undo. Three explicit fit controls choose whole page, width, or height; a selected fit updates when the workspace resizes or the active page changes. Manual zoom leaves fit mode. Native supported zoom remains 20–600%.

All document replacements use a separate native probe before asking to discard unsaved edits. Cancelled passwords, invalid files and cancelled discard leave the current document intact. Creating a new document uses the same guarded path. The native app commits replacement transactionally. Exporting an originally encrypted PDF requires explicit confirmation that the downloaded copy will be unencrypted.

The welcome screen and main open/export actions use Czech labels. Advanced native controls currently remain English. A locally generated, two-page sample provides a no-upload browser test path. The native page controls, text inspector, search, zoom, edit scope, and undo/redo remain available. Mobile layout and full keyboard paragraph selection still require a dedicated accessibility pass; no paragraph list has been implemented.

Release constraints: no server upload, no third-party assets, no marketing bootstrap, original file unchanged. Local Liberation Sans is loaded before editing for English/Czech fallback text. Other writing systems are not covered by this shell's fallback preload yet. Password-protected files use the native engine's password prompt. Signed files retain the native warning and incremental-save behavior; they are not rejected by this host. Dedicated signature/encryption workflows still require validation. Export uses the existing native save pipeline and downloads a new copy. Native source reproduction and notice completion remain release gates.
