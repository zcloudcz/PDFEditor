# PDF Editor

## Scope
- Implement `docs/superpowers/plans/2026-10-25-online-pdf-editor.md` and its linked spec.
- This is a separate local fork of BentoPDF v2.8.10, upstream commit `9aae81e73cdf286b5663b8d95fcef0c0a3f141a9`.
- Stack: TypeScript, Vite, Tailwind, browser-side PDF/WASM. Keep existing modules and conventions.
- All shipped code, engines, models and fonts must be open source, with corresponding sources and notices. No paid services.
- Documents stay in the browser. Never log document contents, filenames, passwords or keys.
- Never equate drawing a rectangle with redaction. Never silently rasterize exports.

## Workflow
- Parallel development explicitly authorized by the user on 2026-10-26. Follow file ownership and integration gates in docs/superpowers/plans/2026-10-26-parallel-development.md; use independent review at milestones.
- Work on `feat/online-pdf-editor`. No upstream push, public deployment or GitHub publishing without user instruction.
- Read and update MEMORY.md; preserve other GAMES projects.
- Fix regressions with tests. Reuse upstream tests; record environmental failures separately from product failures.
- Commands: `npm ci --ignore-scripts`, `npm run test:run -- --maxWorkers=2`, `npx tsc --noEmit`, `npm run build`.
- On this Windows sandbox, Vitest temporary-file rename can fail with EPERM. Run the authorized command outside the sandbox when that occurs.
- Do not mark P00/P01 complete until their evidence and license/source gates pass.
