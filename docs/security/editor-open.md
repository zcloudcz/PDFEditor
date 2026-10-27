# Editor document replacement and protected export

`src/editor-safety/open-document.ts` provides host helpers. Integration must route
all document entry points (welcome picker, toolbar picker, global drop, sample,
and new-document command) through the same serialized replacement controller.
A helper existing on disk alone does not establish that every route is guarded.

`prepareDocument(bytes, { createEngine, requestPassword })` opens a separate
native PdfEngine and checks its document information. It passes a copy to the
probe, preserving original input bytes for the eventual live open. It closes the
probe on success, invalid input, password cancellation, and callback failure.
Password retries receive only an attempt count and whether a previous attempt
failed. No document contents, names, or credentials are logged or persisted.

Successful preflight returns `{ bytes, password, encrypted }`. Pass the ephemeral
password directly to the live native open, then clear the returned password
reference in a `finally` block. JavaScript strings cannot be reliably zeroized;
never retain credentials in application state, local storage, logs, or telemetry.
Encryption status comes from native `documentInfo().encrypted`, not from the
presence of a nonempty password or the engine's internal save optimization flag.

`replaceDocumentSafely` validates before asking to discard current work and
checks dirty state after asynchronous validation. Invalid candidates and canceled
password/discard prompts never call commit. The host must serialize replacement
requests and preserve the live document on any later commit failure. Preflight
is not a transaction: subsequent font/graphics protection or rendering can still
fail, so the application must stage or roll back those operations independently.
Pending inline text editing must count as unsaved work.

`confirmPlaintextExport` requires an explicit affirmative response on every
export of an originally encrypted document. The host wording must state that the
exported copy has no password protection. Cancellation must occur before a save
or download begins. This does not imply encryption-preserving export support.

Verification: `editor-safety-open.test.ts` covers mutation isolation, invalid
input, password retry/cancel, dirty-state timing, discard consent, and plaintext
export consent. `editor-safety-native.test.js` checks malformed replacement
against a still-usable separate live document and RC4-128/AES-128/AES-256 native
password preflight using synthetic fixtures. These tests do not prove browser
picker/drop wiring or transactional rollback after rendering failure.
