# Office runtime and conformance adapter audit

Date: 2026-10-26. Status: **QA only, not approved for shipping**. This records the source audit supplied by the independent `office_runtime_source_audit` worker and the integrator's synthetic Office-rendering checks. It does not add a dependency, runtime, download, native adapter or production capability.

The installed LibreOffice converter independently rendered the synthetic PPTX and actual browser-generated DOCX. Those checks support the bounded T17 output evidence in [T15 to T19 validation](../validation/t15-t19-validation.md). They do not approve Office import or establish browser runtime safety. The current unavailable Office-import and conformance profiles have concrete source, packaging, privacy and execution-contract gates; a paid-service requirement is not their cause.

## Identified package and binary artifacts

The audited package is `@matbee/libreoffice-converter` 2.6.0. Its npm `gitHead` and GitHub v2.6.0 tag resolve to `1bfae4a495b9fb17a0e6b20a13d0ad30ad58d343`. The exact source reference is the [converter repository at that revision](https://github.com/matbeedotcom/libreoffice-document-converter/tree/1bfae4a495b9fb17a0e6b20a13d0ad30ad58d343).

| Installed asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `wasm/soffice.wasm` | 147,416,331 | `ea3d8f3b69bd1e586a8ea973e0dfa61c758612fcc529dc94ac2e30519f8b4f7b` |
| `wasm/soffice.data` | 99,735,918 | `8f4e98aa67e108e161cecc7906d7ac0dd3941ef9347f999c3b9dbc049f165020` |

The exact-tag Git LFS pointers match both installed assets. Their combined size is 247,152,249 bytes before JavaScript and other supporting files. This proves artifact identity with that tag. It does not prove that the published patched core can be rebuilt from the recorded source recipe.

Embedded `versionrc` identifies LibreOffice core build ID `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`, which exists in the [official LibreOffice core repository](https://github.com/LibreOffice/core/commit/d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1). An embedded build ID identifies a reported upstream base; it is not proof of all applied patches or build inputs.

## Open corresponding-source and notices gates

The converter source includes about 223 KB of patches, but the audit did not reconstruct the patched core. The build recipe references mutable `libreoffice-24-8`, can reuse an existing tree, and bootstraps mutable SDK/distribution inputs. The build-wasm recipe specifies Emscripten 3.1.74 while Docker specifies 3.1.51. npm `build:wasm` points to absent `build/build-native.sh`, although an archived script exists. Publication packages Git LFS assets rather than demonstrating a native compilation. A pinned patched-core reconstruction and build-input inventory remain required. [Audited source revision](https://github.com/matbeedotcom/libreoffice-document-converter/tree/1bfae4a495b9fb17a0e6b20a13d0ad30ad58d343).

The local audit counted 137 embedded font files. Families include Liberation/Narrow, DejaVu, Linux Libertine/Biolinum, Noto, Amiri, Caladea, Carlito, Culmus, OpenSymbol, Gentium and Scheherazade. It found no corresponding font license/notice bundle beyond a license-dialog UI. The npm root ships dist/package/README/WASM assets without a root license-file bundle. The editor's existing Noto OFL notice cannot cover all these families. Exact font identities, corresponding sources and required notices must be inventoried before any redistribution.

## Privacy and browser execution gates

In the worker source map, `src/browser.worker.ts` lines 595 to 596 attach unconditional `print: console.log` and `printErr: console.error`, including when `verbose` is false. The audit also found selected-text/hash logging. These paths conflict with the production requirement never to log document contents, filenames, passwords or keys. The stock worker remains restricted to synthetic QA inputs until those paths are removed or safely suppressed and tested. [Audited worker source revision](https://github.com/matbeedotcom/libreoffice-document-converter/tree/1bfae4a495b9fb17a0e6b20a13d0ad30ad58d343).

The installed classic worker is `dist/browser.worker.global.js`; the README's `browser.worker.js` path does not match it. A prospective browser integration requires four explicit local resource paths and no CDN fallback. Browser fidelity, cancellation, offline loading, memory limits and the untrusted-document boundary remain unverified. Two Node-based rendering samples do not close these gates. No converter asset is approved for the curated production allowlist by this report.

## veraPDF execution boundary

The reviewed official veraPDF distribution uses Java. Its documented CLI offers PDF/A and PDF/UA validation profiles and machine-readable reports. The audited official documentation does not establish a browser WASM adapter. [Official installation documentation](https://site.verapdf.org/install/), [official CLI validation documentation](https://docs.verapdf.org/cli/validation/).

A Java CLI can be evaluated separately for independent QA. A production native bridge that transfers user documents outside the browser would change the current browser-only document contract and is not approved by this audit. No official-browser-runtime claim, PDF/UA certification, PDF/A conversion or PDF/X validation follows from the CLI's availability. Human reading-order, alternative-text and assistive-technology checks remain separate from machine validation.

## Required evidence before production integration

- Reconstruct the exact patched core from pinned source/build inputs and retain complete corresponding-source material.
- Inventory all packaged fonts and linked components, with their source references and notices.
- Remove document-sensitive logging and verify the browser execution boundary, explicit local paths, cancellation, offline behavior and bounded resource use.
- Validate the supported Office corpus independently, including loss reports and explicit rasterization choices.
- Provide a conformance adapter compatible with the agreed document contract, with versioned profiles, positive/negative fixtures and independent reports.

P00/P01 source and notices gates remain open. This audit makes no legal-compliance or conformance claim and authorizes no shipping, deployment or publishing.
