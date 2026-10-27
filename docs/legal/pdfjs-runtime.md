# Local PDF.js runtime assets

The local preview uses the already installed `pdfjs-dist` **5.5.207** package (Apache-2.0) for independent browser rendering, comparison and PDF coordinate transforms. Package provenance: `package-lock.json`; source: https://github.com/mozilla/pdf.js/tree/v5.5.207 . No package or network service was added by this feature.

The curated asset build copies only the package's `standard_fonts` font files and license notices, `cmaps` packed CMaps and license, and `wasm` decoders plus their license notices and the OpenJPEG JavaScript fallback. Existing application Liberation font files retain their existing paths and provenance. The package's root `LICENSE` is retained under `licenses/packages/pdfjs-dist/`. `source-inventory.json` records each emitted asset's exact local origin; `asset-inventory.json` records size and SHA-256 after building.

The font directory contains PDFium/Foxit BSD notices and the Liberation font license; CMaps retain Adobe's BSD notice. Decoder notices include OpenJPEG (BSD-2-Clause), QCMS (MIT), the jbig2dec AGPL-3.0 notice and PDF.js decoder wrapper notices. All `LICENSE*` files present in those fixed installed directories are emitted beside their corresponding assets. An installed package version change intentionally fails the curated build until this inventory has been reviewed.

These browser asset notices do not certify a native rebuild or complete corresponding-source distribution. Native PDFium/engine source and build audits and the original P00/P01 distribution gates remain open. This is local-preview provenance, not a public distribution or compliance claim.
