# ADR 0001: Browser-first BentoPDF fork

Status: provisional until P00 license/source and P01 fidelity gates pass.

The user needs an online PDF editor using only open-source components and no paid licenses.
Use a pinned BentoPDF fork, retaining TypeScript/Vite/Tailwind and existing PDF operations.
PDFGuru informs workflow simplicity; create our own interface and identity.

Alternatives: building over PDFium/EmbedPDF gives more control but requires native editing UI and export integration; Stirling-PDF brings server operations and mixed open-core licensing. A PDF.js/pdf-lib-only solution does not offer a complete existing-text editing engine.

The application is statically distributed and documents are processed on the user's device. No database or upload API is required. Heavy operations must be bounded and interruptible.

AGPL source availability and all bundled notices are release requirements. A manifest license alone is insufficient. If the pinned native engine lacks corresponding source, do not distribute it: evaluate a fully open-source replacement before extending the UI.

Failure modes: memory exhaustion, unsupported fonts, structural loss during page copies, separate editor histories, obsolete sensitive content after redaction. Preserve originals, validate exports and provide explicit supported cases.
