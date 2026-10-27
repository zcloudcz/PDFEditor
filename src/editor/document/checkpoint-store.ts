import { validateProject, parsePortableProject } from '../studio/project-io';
import { migrateProject } from './migrations';
import { validateProjectSource } from '../studio/document-bridge';
import type { DocumentCheckpoint } from './coordinator';

export interface AtomicCheckpointBackend {
  read(): Promise<unknown>;
  /** Must commit the replacement atomically, preserving the old record on any failure. */
  update(transform: (previous: unknown) => unknown, signal?: AbortSignal): Promise<void>;
}
type StoredSnapshot = { payload: string; checksum: string };
type StoredCheckpoints = { version: 1; latest?: StoredSnapshot; previous?: StoredSnapshot };
const MAX = 100 * 1024 * 1024;
function checksum(text: string): string {
  // Accidental-corruption detection only, not authenticity or tamper protection.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export function validateCheckpoint(value: unknown): asserts value is DocumentCheckpoint {
  if (!value || typeof value !== 'object' || !('revision' in value) || !('nativeRevision' in value) || !('project' in value)
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.nativeRevision !== 'number' || !Number.isSafeInteger(value.nativeRevision) || value.nativeRevision < 0) throw new Error('Invalid checkpoint');
  validateProject(value.project);
  if ('view' in value && value.view !== undefined) {
    const view = value.view;
    if (!view || typeof view !== 'object' || !('selectedIds' in view) || !Array.isArray(view.selectedIds)
      || view.selectedIds.length > 1000 || view.selectedIds.some((id: unknown) => typeof id !== 'string' || id.length > 1000)
      || ('pageId' in view && view.pageId !== undefined && (typeof view.pageId !== 'string' || view.pageId.length > 1000))
      || ('pageIndex' in view && view.pageIndex !== undefined && (typeof view.pageIndex !== 'number' || !Number.isSafeInteger(view.pageIndex) || view.pageIndex < 0 || view.pageIndex >= value.project.pages.length))) throw new Error('Invalid checkpoint view');
  }
}
function snapshot(value: unknown): StoredSnapshot | undefined {
  if (!value || typeof value !== 'object' || !('payload' in value) || !('checksum' in value)
    || typeof value.payload !== 'string' || value.payload.length > MAX || new TextEncoder().encode(value.payload).length > MAX
    || typeof value.checksum !== 'string' || checksum(value.payload) !== value.checksum) return undefined;
  return { payload: value.payload, checksum: value.checksum };
}
async function decode(value: unknown): Promise<DocumentCheckpoint | undefined> {
  const stored = snapshot(value);
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored.payload);
    if (!parsed || typeof parsed !== 'object') return undefined;
    parsed.project = await parsePortableProject(JSON.stringify(parsed.project));
    validateCheckpoint(parsed);
    await validateProjectSource(parsed.project);
    return parsed;
  } catch { return undefined; }
}
function envelope(value: unknown): StoredCheckpoints {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return { version: 1 };
  return { version: 1, latest: snapshot('latest' in value ? value.latest : undefined), previous: snapshot('previous' in value ? value.previous : undefined) };
}
function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Recovery cancelled', 'AbortError'); }

export function createIndexedDbCheckpointBackend(databaseName = 'zcloud-editor-checkpoints', factory: IDBFactory = indexedDB): AtomicCheckpointBackend {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = () => { settled = true; reject(new Error('Recovery storage unavailable')); };
    request.onblocked = () => { settled = true; reject(new Error('Recovery storage blocked')); };
  });
  const transaction = async (mode: IDBTransactionMode, transform?: (previous: unknown) => unknown, signal?: AbortSignal): Promise<unknown> => {
    aborted(signal); const db = await open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction('checkpoints', mode); } catch (error) { db.close(); reject(error); return; }
      const store = tx.objectStore('checkpoints');
      let result: unknown, failure: unknown;
      const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
      signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => { signal?.removeEventListener('abort', abort); db.close(); };
      tx.oncomplete = () => { cleanup(); resolve(result); };
      tx.onabort = tx.onerror = () => { cleanup(); reject(failure ?? tx.error ?? new Error('Recovery write failed')); };
      const read = store.get('current');
      read.onsuccess = () => {
        try { aborted(signal); result = transform ? transform(read.result) : read.result; if (transform) store.put(result, 'current'); }
        catch (error) { failure = error; abort(); }
      };
      if (signal?.aborted) abort();
    });
  };
  return { read: () => transaction('readonly'), update: async (transform, signal) => { await transaction('readwrite', transform, signal); } };
}

/** Two checkpoints and their head live in one atomic record, never separate writes. */
export class CheckpointStore {
  private generation = 0;
  private pending = new Set<AbortController>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly backend: AtomicCheckpointBackend = createIndexedDbCheckpointBackend()) {}
  private enqueue(action: () => Promise<void>): Promise<void> {
    const result = this.queue.catch(() => {}).then(action); this.queue = result; return result;
  }
  async read(): Promise<{ checkpoint: DocumentCheckpoint; recoveredPrevious: boolean } | undefined> {
    const record = envelope(await this.backend.read());
    const latest = await decode(record.latest), previous = latest ? undefined : await decode(record.previous);
    if (latest) return { checkpoint: latest, recoveredPrevious: false };
    if (previous) return { checkpoint: previous, recoveredPrevious: true };
    return undefined;
  }
  async write(checkpoint: DocumentCheckpoint, signal?: AbortSignal): Promise<void> {
    checkpoint = structuredClone(checkpoint);
    validateCheckpoint(checkpoint); aborted(signal);
    const generation = this.generation;
    await validateProjectSource(checkpoint.project); aborted(signal);
    if (generation !== this.generation) throw new DOMException('Recovery cancelled', 'AbortError');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); this.pending.add(controller);
    try {
      await this.enqueue(async () => {
        aborted(controller.signal);
        const project = await migrateProject(checkpoint.project);
        const payload = JSON.stringify({ ...checkpoint, project });
        if (payload.length > MAX || new TextEncoder().encode(payload).length > MAX) throw new Error('Checkpoint too large');
        const next = { payload, checksum: checksum(payload) };
        // Validate hashes outside the IndexedDB transaction, then compare before commit.
        const observed = await this.backend.read(), record = envelope(observed);
        const fallback = await decode(record.latest) ? record.latest : await decode(record.previous) ? record.previous : undefined;
        await this.backend.update(previous => {
          aborted(controller.signal);
          if (generation !== this.generation) throw new DOMException('Recovery cancelled', 'AbortError');
          if (JSON.stringify(previous) !== JSON.stringify(observed)) throw new Error('Recovery changed during validation');
          return { version: 1, latest: next, previous: fallback } satisfies StoredCheckpoints;
        }, controller.signal);
      });
    } finally { this.pending.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  cancelPending(): void { ++this.generation; this.pending.forEach(controller => controller.abort()); }
  async clear(): Promise<void> { this.cancelPending(); await this.enqueue(() => this.backend.update(() => ({ version: 1 }))); }
  /** Conservative document scope: both retained revisions must share a stable
   * page identity with the current document. Unknown/corrupt records block purge. */
  async preparePurge(pageIds: readonly string[]): Promise<() => Promise<void>> {
    if (!pageIds.length) throw new Error('Recovery document scope missing');
    await this.queue.catch(() => {});
    const observed = await this.backend.read();
    if (observed !== undefined && observed !== null) {
      if (typeof observed !== 'object' || !('version' in observed) || observed.version !== 1 || Object.keys(observed).some(key => !['version', 'latest', 'previous'].includes(key))) throw new Error('Recovery document scope unknown');
      const record = observed as Record<string, unknown>;
      for (const slot of ['latest', 'previous'] as const) {
        if (!(slot in record) || record[slot] === undefined) continue;
        const value = await decode(record[slot]);
        if (!value || !value.project.pages.some(page => pageIds.includes(page.id))) throw new Error('Recovery belongs to another or unknown document');
      }
    }
    const expected = JSON.stringify(observed);
    return async () => {
      this.cancelPending();
      await this.enqueue(async () => {
        await this.backend.update(previous => {
          if (JSON.stringify(previous) !== expected) throw new Error('Recovery changed before purge');
          return { version: 1 };
        });
        if (JSON.stringify(await this.backend.read()) !== '{"version":1}') throw new Error('Recovery purge verification failed');
      });
    };
  }
}

