import { describe, expect, it, vi } from 'vitest';
import { DocumentCoordinator, type DocumentAdapter } from './coordinator';
import type { StudioProject } from '../studio/types';
const project = (): StudioProject => ({ version: 1, name: 'Original', pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [] }] });
function fixture() {
  let current = project(), revision = 0, nativeRevision = 0;
  const adapter: DocumentAdapter = {
    getRevision: () => revision,
    getNativeRevision: () => nativeRevision,
    captureProject: async () => structuredClone(current),
    commitProject: vi.fn(async (next, expected) => { if (expected !== revision) return false; current = structuredClone(next); revision++; return true; }),
  };
  return { adapter, current: () => structuredClone(current), edit(name: string, native = false) { current.name = name; revision++; if (native) nativeRevision++; } };
}
const deferred = <T>() => { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
describe('document coordinator', () => {
  it('records the canonical committed project so settling does not create a no-op undo', async () => {
    const state = fixture(), commit = state.adapter.commitProject;
    state.adapter.commitProject = async (next, expected, signal, view) => {
      const canonical = structuredClone(next);
      canonical.pages[0].name = 'Rebased source';
      if (!await commit(canonical, expected, signal, view)) return false;
      return { project: canonical, view: { pageIndex: 0, selectedIds: [] } };
    };
    const coordinator = new DocumentCoordinator(state.adapter);
    await coordinator.transact('Native rebase', async before => ({ ...before.project, name: 'Changed' }));
    await coordinator.checkpoint();
    await coordinator.undo();
    expect(state.current().name).toBe('Original');
    expect(coordinator.canUndo).toBe(false);
    await coordinator.redo();
    expect(state.current().name).toBe('Changed');
  });
  it('records canonical undo and redo results without losing the remaining history', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter);
    await coordinator.transact('First', async before => ({ ...before.project, name: 'First' }));
    await coordinator.transact('Second', async before => ({ ...before.project, name: 'Second' }));
    const commit = state.adapter.commitProject;
    state.adapter.commitProject = async (next, expected, signal, view) => {
      const canonical = structuredClone(next);
      canonical.pages[0].name = 'Rebased source';
      if (!await commit(canonical, expected, signal, view)) return false;
      return { project: canonical, view: { pageIndex: 0, selectedIds: [] } };
    };
    await coordinator.undo();
    await coordinator.checkpoint();
    expect(coordinator.canRedo).toBe(true);
    await coordinator.redo();
    expect(state.current().name).toBe('Second');
    await coordinator.checkpoint();
    await coordinator.undo();
    expect(state.current().name).toBe('First');
    await coordinator.undo();
    expect(state.current().name).toBe('Original');
  });
  it('keeps a canonical committed result when cancellation arrives after the swap', async () => {
    const state = fixture(), commit = state.adapter.commitProject, abort = new AbortController();
    state.adapter.commitProject = async (next, expected, signal, view) => {
      const canonical = structuredClone(next);
      canonical.pages[0].name = 'Rebased source';
      if (!await commit(canonical, expected, signal, view)) return false;
      abort.abort();
      return { project: canonical };
    };
    const coordinator = new DocumentCoordinator(state.adapter);
    await coordinator.transact('Committed', async before => ({ ...before.project, name: 'Changed' }), abort.signal);
    await coordinator.checkpoint();
    await coordinator.undo();
    expect(state.current().name).toBe('Original');
  });
  it('captures detached snapshots and includes edits from both adapters', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter);
    state.edit('Native edit', true);
    const snapshot = await coordinator.capture();
    expect(snapshot.nativeRevision).toBe(1); expect(snapshot.project.name).toBe('Native edit');
    snapshot.project.name = 'Untrusted caller mutation'; expect(state.current().name).toBe('Native edit');
  });
  it('does not let stale worker output replace newer native edits', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter), gate = deferred<StudioProject>(), started = deferred<void>();
    const operation = coordinator.transact('Delayed', async before => { started.resolve(); return gate.promise; });
    await started.promise; state.edit('Newer native text', true); gate.resolve(project());
    await expect(operation).rejects.toMatchObject({ code: 'stale' });
    expect(state.current().name).toBe('Newer native text'); expect(state.adapter.commitProject).not.toHaveBeenCalled();
  });
  it('cancellation preserves the old document and permits subsequent operations', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter), gate = deferred<StudioProject>(), started = deferred<void>(), abort = new AbortController();
    const operation = coordinator.transact('Cancelled', async () => { started.resolve(); return gate.promise; }, abort.signal);
    await started.promise; abort.abort(); gate.resolve({ ...project(), name: 'Discard' });
    await expect(operation).rejects.toMatchObject({ code: 'cancelled' }); expect(state.current().name).toBe('Original');
    await coordinator.transact('Next', async before => ({ ...before.project, name: 'Success' })); expect(state.current().name).toBe('Success');
  });
  it('passes cancellation through asynchronous commit preparation before the atomic swap', async () => {
    const state = fixture(), gate = deferred<void>(), started = deferred<void>(), abort = new AbortController();
    const commit = state.adapter.commitProject;
    state.adapter.commitProject = async (next, expected, signal) => {
      started.resolve(); await gate.promise;
      if (signal.aborted) return false;
      return commit(next, expected, signal);
    };
    const coordinator = new DocumentCoordinator(state.adapter);
    const operation = coordinator.transact('Delayed commit', async before => ({ ...before.project, name: 'Discard' }), abort.signal);
    await started.promise; abort.abort(); gate.resolve();
    await expect(operation).rejects.toMatchObject({ code: 'cancelled' }); expect(state.current().name).toBe('Original');
    expect(coordinator.canUndo).toBe(false);
  });
  it('serializes simultaneous mutations against their actual predecessor', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter), gate = deferred<void>();
    const one = coordinator.transact('First', async before => { await gate.promise; return { ...before.project, name: 'One' }; });
    const two = coordinator.transact('Second', async before => ({ ...before.project, name: before.project.name + ' Two' }));
    gate.resolve(); await Promise.all([one, two]); expect(state.current().name).toBe('One Two');
  });
  it('undo and redo restore complete projects across external and coordinated edits', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter);
    await coordinator.checkpoint(); state.edit('Native text', true);
    await coordinator.transact('New page', async before => ({ ...before.project, pages: [...before.project.pages, { ...before.project.pages[0], id: 'second' }] }));
    expect(state.current().pages).toHaveLength(2);
    await coordinator.undo(); expect(state.current()).toMatchObject({ name: 'Native text', pages: [{ id: 'page' }] });
    await coordinator.undo(); expect(state.current().name).toBe('Original');
    await coordinator.redo(); expect(state.current().name).toBe('Native text');
    await coordinator.redo(); expect(state.current().pages).toHaveLength(2);
  });
  it('an invalid project or rejected atomic commit never enters history', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter);
    await expect(coordinator.transact('Invalid', async before => ({ ...before.project, pages: [] }))).rejects.toThrow();
    expect(state.adapter.commitProject).not.toHaveBeenCalled(); expect(coordinator.canUndo).toBe(false);
    vi.mocked(state.adapter.commitProject).mockResolvedValueOnce(false);
    await expect(coordinator.transact('Rejected', async before => ({ ...before.project, name: 'Never' }))).rejects.toMatchObject({ code: 'stale' });
    expect(coordinator.canUndo).toBe(false); expect(state.current().name).toBe('Original');
  });
  it('rejected undo leaves the existing redo branch intact', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter);
    await coordinator.transact('First', async before => ({ ...before.project, name: 'First' }));
    await coordinator.transact('Second', async before => ({ ...before.project, name: 'Second' }));
    await coordinator.undo();
    state.edit('Unrecorded external edit', true);
    vi.mocked(state.adapter.commitProject).mockResolvedValueOnce(false);
    await expect(coordinator.undo()).rejects.toMatchObject({ code: 'stale' });
    expect(state.current().name).toBe('Unrecorded external edit');
    expect(coordinator.canRedo).toBe(true);
  });
  it('cancelling undo during commit preparation preserves both current state and history', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter);
    await coordinator.transact('First', async before => ({ ...before.project, name: 'First' }));
    await coordinator.transact('Second', async before => ({ ...before.project, name: 'Second' }));
    await coordinator.undo();
    state.edit('External edit', true);
    const gate = deferred<void>(), started = deferred<void>(), abort = new AbortController();
    const commit = state.adapter.commitProject;
    state.adapter.commitProject = async (next, expected, signal, view) => {
      started.resolve(); await gate.promise;
      return signal.aborted ? false : commit(next, expected, signal, view);
    };
    const pending = coordinator.undo(abort.signal);
    await started.promise; abort.abort(); gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(state.current().name).toBe('External edit');
    expect(coordinator.canRedo).toBe(true);
  });
  it('disposal cancels queued commands and stale capture is refused', async () => {
    const state = fixture(), gate = deferred<StudioProject>(), started = deferred<void>();
    state.adapter.captureProject = async () => { started.resolve(); return gate.promise; };
    const coordinator = new DocumentCoordinator(state.adapter), pending = coordinator.capture();
    await started.promise; state.edit('During capture'); gate.resolve(project());
    await expect(pending).rejects.toMatchObject({ code: 'stale' });
    coordinator.dispose(); await expect(coordinator.capture()).rejects.toMatchObject({ code: 'disposed' });
  });
  it('drops redo after a new edit and bounds history', async () => {
    const state = fixture(), coordinator = new DocumentCoordinator(state.adapter, { historyLimit: 3 });
    for (const name of ['One', 'Two', 'Three']) await coordinator.transact(name, async before => ({ ...before.project, name }));
    await coordinator.undo(); await coordinator.undo(); expect(coordinator.canUndo).toBe(false);
    await coordinator.transact('Branch', async before => ({ ...before.project, name: 'Branch' })); expect(coordinator.canRedo).toBe(false);
  });
});
