import { validateProjectSource } from '../studio/document-bridge';
import type { StudioProject } from '../studio/types';
import { validateProject } from '../studio/project-io';
import { HistoryStore } from './history-store';

export interface DocumentViewState { pageId?: string; pageIndex?: number; selectedIds: string[] }

export interface DocumentCheckpoint {
  revision: number;
  nativeRevision: number;
  project: StudioProject;
  view?: DocumentViewState;
}
export interface DocumentCommitResult {
  project: StudioProject;
  view?: DocumentViewState;
}
export interface DocumentAdapter {
  getRevision(): number;
  getNativeRevision(): number;
  captureProject(signal: AbortSignal): Promise<StudioProject>;
  captureView?(): DocumentViewState;
  /** Atomically compare the revision and swap both engines. Recheck signal and revision immediately before swapping; a rejected swap changes nothing. Return the canonical project/view if the swap normalizes them; true means the input project was committed unchanged. */
  commitProject(project: StudioProject, expectedRevision: number, signal: AbortSignal, view?: DocumentViewState): Promise<boolean | DocumentCommitResult>;
}
export class DocumentTransactionError extends Error {
  constructor(public readonly code: 'stale' | 'cancelled' | 'disposed') {
    super(code); this.name = 'DocumentTransactionError';
  }
}
const clone = <T>(value: T): T => structuredClone(value);
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DocumentTransactionError('cancelled'); };

/** Serializes document commands; engine adapters own the actual atomic state swap. */
export class DocumentCoordinator {
  private queue: Promise<unknown> = Promise.resolve();
  private history: HistoryStore;
  private disposed = false;
  private active = new Set<AbortController>();
  private readonly validate: (project: StudioProject) => void | Promise<void>;
  private readonly limit: number;
  constructor(private readonly adapter: DocumentAdapter, options: {
    validate?: (project: StudioProject) => void | Promise<void>;
    historyLimit?: number;
  } = {}) {
    this.validate = options.validate ?? validateProjectSource;
    this.limit = options.historyLimit ?? 80;
    if (!Number.isSafeInteger(this.limit) || this.limit < 2 || this.limit > 80) throw new RangeError('Invalid history limit');
    this.history = HistoryStore.create(this.limit);
  }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }
  private enqueue<T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.active.add(controller);
    const result = this.queue.catch(() => {}).then(async () => {
      if (this.disposed) throw new DocumentTransactionError('disposed');
      checkAbort(controller.signal);
      return action(controller.signal);
    });
    this.queue = result;
    return result.finally(() => { signal?.removeEventListener('abort', abort); this.active.delete(controller); });
  }
  private assertCurrent(before: DocumentCheckpoint): void {
    if (before.revision !== this.adapter.getRevision() || before.nativeRevision !== this.adapter.getNativeRevision()) throw new DocumentTransactionError('stale');
  }
  private async captureNow(signal: AbortSignal): Promise<DocumentCheckpoint> {
    checkAbort(signal);
    const revision = this.adapter.getRevision(), nativeRevision = this.adapter.getNativeRevision(), view = this.adapter.captureView?.();
    const project = clone(await this.adapter.captureProject(signal));
    checkAbort(signal);
    await this.validate(project);
    checkAbort(signal);
    const checkpoint = { revision, nativeRevision, project, ...(view ? { view: clone(view) } : {}) };
    this.assertCurrent(checkpoint);
    return checkpoint;
  }
  private record(checkpoint: DocumentCheckpoint): void {
    this.history = this.history.recorded(checkpoint);
  }
  capture(signal?: AbortSignal): Promise<DocumentCheckpoint> {
    return this.enqueue(active => this.captureNow(active), signal);
  }
  /** Already captured committed editor state; drafts must not call this. */
  recordExternal(checkpoint: DocumentCheckpoint): void {
    if (this.disposed) throw new DocumentTransactionError('disposed');
    validateProject(checkpoint.project);
    if (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0 || !Number.isSafeInteger(checkpoint.nativeRevision) || checkpoint.nativeRevision < 0) throw new Error('Invalid revision');
    this.record(checkpoint);
  }
  /** Record externally edited native/graphic content before recovery or subsequent commands. */
  checkpoint(signal?: AbortSignal): Promise<DocumentCheckpoint> {
    return this.enqueue(async active => { const snapshot = await this.captureNow(active); this.record(snapshot); return clone(snapshot); }, signal);
  }
  transact(_label: string, prepare: (before: DocumentCheckpoint, signal: AbortSignal) => Promise<StudioProject>, signal?: AbortSignal): Promise<void> {
    return this.enqueue(async active => {
      const before = await this.captureNow(active);
      const next = clone(await prepare(clone(before), active));
      checkAbort(active); await this.validate(next); checkAbort(active); this.assertCurrent(before);
      const committed = await this.adapter.commitProject(clone(next), before.revision, active, before.view);
      if (!committed) { checkAbort(active); throw new DocumentTransactionError('stale'); }
      // Cancellation after the atomic swap does not undo a committed user action.
      this.history = this.history.recorded(before).recorded({ revision: this.adapter.getRevision(), nativeRevision: this.adapter.getNativeRevision(), project: committed === true ? next : committed.project, view: committed === true ? this.adapter.captureView?.() : committed.view });
    }, signal);
  }
  private navigate(direction: -1 | 1, signal?: AbortSignal): Promise<void> {
    return this.enqueue(async active => {
      const before = await this.captureNow(active);
      const history = this.history.recorded(before);
      const position = history.cursor + direction;
      const target = history.at(position);
      if (!target) return;
      const project = clone(target.project);
      await this.validate(project); checkAbort(active); this.assertCurrent(before);
      const committed = await this.adapter.commitProject(project, before.revision, active, target.view);
      if (!committed) { checkAbort(active); throw new DocumentTransactionError('stale'); }
      this.history = history.moved(position, { revision: this.adapter.getRevision(), nativeRevision: this.adapter.getNativeRevision(), project: clone(committed === true ? project : committed.project), view: clone(committed === true ? target.view : committed.view) });
    }, signal);
  }
  undo(signal?: AbortSignal): Promise<void> { return this.navigate(-1, signal); }
  redo(signal?: AbortSignal): Promise<void> { return this.navigate(1, signal); }
  /** Explicit irreversible boundary for this coordinator's document only. */
  forgetHistory(): void { this.history = HistoryStore.create(this.limit); }
  dispose(): void { this.disposed = true; this.active.forEach(controller => controller.abort()); }
}
