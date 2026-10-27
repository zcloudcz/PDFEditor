export interface ValidationEngine {
  open(bytes: Uint8Array, password?: string): void;
  documentInfo(): { pages: number; encrypted?: boolean };
  close(): void;
}

export interface PreparedDocument {
  /** Original bytes, never the probe engine's normalized document. */
  bytes: Uint8Array;
  /** Ephemeral credential: pass directly to openFile; never persist or log. */
  password?: string;
  encrypted: boolean;
}

export interface PreflightOptions {
  createEngine(): Promise<ValidationEngine>;
  requestPassword(context: {
    attempt: number;
    incorrect: boolean;
  }): Promise<string | null>;
}

/** Probe a separate engine before touching the live document. */
export async function prepareDocument(
  bytes: Uint8Array,
  options: PreflightOptions
): Promise<PreparedDocument | null> {
  const engine = await options.createEngine();
  let password: string | undefined;
  let attempt = 0;
  try {
    for (;;) {
      try {
        // Native opening can normalize font subsets; keep the input untouched.
        engine.open(bytes.slice(), password);
        const info = engine.documentInfo();
        if (!Number.isInteger(info.pages) || info.pages < 1) {
          throw new Error('The PDF has no readable pages.');
        }
        return { bytes, password, encrypted: !!info.encrypted };
      } catch (error) {
        if (
          !(
            error &&
            typeof error === 'object' &&
            'passwordRequired' in error &&
            error.passwordRequired === true
          )
        )
          throw error;
        const answer = await options.requestPassword({
          attempt: ++attempt,
          incorrect: attempt > 1,
        });
        if (answer === null) return null;
        password = answer;
      }
    }
  } finally {
    password = undefined;
    engine.close();
  }
}

/** Host must serialize calls and make commit transactional; preflight cannot
 * guarantee success of later transformations or replace a rollback mechanism. */
export async function replaceDocumentSafely<T>(options: {
  prepare(): Promise<T | null>;
  isDirty(): boolean;
  confirmDiscard(): boolean | Promise<boolean>;
  commit(prepared: T): Promise<boolean>;
}): Promise<boolean> {
  const prepared = await options.prepare();
  if (prepared === null) return false;
  // Check after asynchronous validation: edits may have happened while loading.
  if (options.isDirty() && (await options.confirmDiscard()) !== true)
    return false;
  return options.commit(prepared);
}

/** Call before generating or downloading a plaintext copy, on every export. */
export async function confirmPlaintextExport(
  originallyEncrypted: boolean,
  confirm: () => boolean | Promise<boolean>
): Promise<boolean> {
  return !originallyEncrypted || (await confirm()) === true;
}
