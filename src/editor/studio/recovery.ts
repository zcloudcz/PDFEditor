import { CheckpointStore } from '../document/checkpoint-store';
import { parsePortableProject, serializePortableProject } from './project-io';
import type { DocumentViewState } from '../document/coordinator';
const DATABASE = 'zcloud-pdf-studio';
const STORE = 'recovery';
let recoveryGeneration = 0;
let checkpoints: CheckpointStore | undefined;
const checkpointStore = () => checkpoints ??= new CheckpointStore();

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Lokální úložiště není dostupné.'));
  });
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Lokální uložení selhalo. Stáhněte projekt do souboru.')); };
  });
}
export interface RecoveryState { serialized: string; view?: DocumentViewState }
export async function readRecoveryState(): Promise<RecoveryState | undefined> {
  let checkpointFailure: unknown;
  try {
    const current = await checkpointStore().read();
    if (current) return { serialized: await serializePortableProject(current.checkpoint.project), view: current.checkpoint.view };
  } catch (error) { checkpointFailure = error; }
  const value: unknown = await transact('readonly', store => store.get('latest'));
  if (typeof value === 'string') return { serialized: value };
  if (checkpointFailure) throw checkpointFailure;
  return undefined;
}
export async function readRecovery(): Promise<string | undefined> { return (await readRecoveryState())?.serialized; }
export async function writeRecovery(value: string, revision = 0, nativeRevision = 0, signal?: AbortSignal, view?: DocumentViewState): Promise<void> {
  const generation = recoveryGeneration;
  const project = await parsePortableProject(value);
  if (signal?.aborted || generation !== recoveryGeneration) throw new DOMException('Recovery cancelled', 'AbortError');
  await checkpointStore().write({ project, revision, nativeRevision, ...(view ? { view: structuredClone(view) } : {}) }, signal);
}
export function cancelRecoveryWrites(): void { ++recoveryGeneration; checkpoints?.cancelPending(); }
export async function clearRecovery(): Promise<void> {
  cancelRecoveryWrites();
  // A blocked storage generation must not prevent deletion from the other one.
  const results = await Promise.allSettled([
    checkpointStore().clear(),
    transact('readwrite', store => store.delete('latest')),
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}

export interface ScopedRecoveryPurgeBackend {
  readLegacy(): Promise<unknown>;
  prepareCurrent(pageIds: readonly string[]): Promise<() => Promise<void>>;
  deleteLegacyIfUnchanged(expected: unknown): Promise<void>;
}
/** Both stores are scoped before either is deleted. Stable IDs deliberately
 * refuse unrelated/corrupt recovery rather than guessing document ownership. */
export async function prepareScopedRecoveryPurge(pageIds: readonly string[], backend: ScopedRecoveryPurgeBackend): Promise<() => Promise<void>> {
  if (!pageIds.length) throw new Error('Recovery document scope missing');
  const legacy = await backend.readLegacy();
  if (legacy !== undefined) {
    if (typeof legacy !== 'string') throw new Error('Recovery document scope unknown');
    const project = await parsePortableProject(legacy);
    if (!project.pages.some(page => pageIds.includes(page.id))) throw new Error('Recovery belongs to another document');
  }
  const purgeCurrent = await backend.prepareCurrent(pageIds);
  return async () => {
    // Detect another tab's change before beginning either deletion.
    if (await backend.readLegacy() !== legacy) throw new Error('Recovery changed before purge');
    await purgeCurrent();
    await backend.deleteLegacyIfUnchanged(legacy);
    if (await backend.readLegacy() !== undefined) throw new Error('Recovery purge verification failed');
  };
}
async function deleteLegacyIfUnchanged(expected: unknown): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE), read = store.get('latest');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Recovery changed or purge failed')); };
    read.onsuccess = () => { if (read.result !== expected) tx.abort(); else store.delete('latest'); };
  });
}
export function prepareRecoveryPurge(pageIds: readonly string[]): Promise<() => Promise<void>> {
  return prepareScopedRecoveryPurge(pageIds, {
    readLegacy: () => transact('readonly', store => store.get('latest')),
    prepareCurrent: ids => checkpointStore().preparePurge(ids),
    deleteLegacyIfUnchanged,
  });
}


