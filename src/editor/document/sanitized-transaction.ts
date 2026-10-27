/** Caller owns an exclusive editor lock and fully preflights a detached candidate.
 * Callbacks operate only on the current document and never restore its old state. */
export interface SanitizedCommitAdapter {
  assertCurrent(): void;
  revokeRecovery(): Promise<void>;
  purgeRecovery(): Promise<void>;
  discardCurrent(): Promise<void>;
  install(): Promise<void>;
  verify(): Promise<void>;
  quarantine(): Promise<void>;
}
export class SanitizedCommitError extends Error {
  readonly code = 'purge-incomplete';
  constructor() { super('Odstranění starých kopií není dokončeno. Dokument nelze potvrdit jako vyčištěný.'); this.name = 'SanitizedCommitError'; }
}
export async function commitSanitized(adapter: SanitizedCommitAdapter, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  adapter.assertCurrent();
  // Beyond this boundary cancellation cannot resurrect discarded information.
  try {
    await adapter.revokeRecovery();
    await adapter.purgeRecovery();
    await adapter.discardCurrent();
    await adapter.install();
    await adapter.verify();
  } catch {
    try { await adapter.quarantine(); } catch { /* Cleanup failure is never success. */ }
    throw new SanitizedCommitError();
  }
}
