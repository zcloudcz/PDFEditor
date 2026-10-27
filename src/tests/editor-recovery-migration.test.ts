import type { StudioProject } from '../editor/studio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), clear: vi.fn(), cancelPending: vi.fn(), write: vi.fn() }));
vi.mock('../editor/document/checkpoint-store', () => ({ CheckpointStore: class { read = state.read; clear = state.clear; cancelPending = state.cancelPending; write = state.write; } }));
import { clearRecovery, readRecovery, readRecoveryState, writeRecovery, cancelRecoveryWrites } from '../editor/studio/recovery';

function legacyDatabase(value: unknown, deleted = vi.fn()) {
  vi.stubGlobal('indexedDB', {
    open: () => {
      const open: Record<string, unknown> = {};
      const db = {
        close: vi.fn(),
        transaction: () => {
          const transaction: Record<string, unknown> = {};
          transaction.objectStore = () => ({ delete: () => {
            deleted();
            queueMicrotask(() => (transaction.oncomplete as () => void)());
            return { result: undefined as void };
          }, get: () => {
            queueMicrotask(() => (transaction.oncomplete as () => void)());
            return { result: value };
          } });
          return transaction;
        },
      };
      queueMicrotask(() => { open.result = db; (open.onsuccess as () => void)(); });
      return open;
    },
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('legacy recovery migration', () => {
  it('offers the legacy project even when the new database is blocked', async () => {
    state.read.mockRejectedValue(new Error('blocked'));
    legacyDatabase('legacy-project');
    expect(await readRecovery()).toBe('legacy-project');
  });
  it('reports storage failure instead of silently claiming no recovery exists', async () => {
    state.read.mockRejectedValue(new Error('blocked'));
    legacyDatabase(undefined);
    await expect(readRecovery()).rejects.toThrow('blocked');
  });
  it('still removes the legacy copy when checkpoint deletion fails', async () => {
    const deleted = vi.fn(); legacyDatabase('sensitive-legacy-project', deleted);
    state.clear.mockRejectedValue(new Error('blocked'));
    await expect(clearRecovery()).rejects.toThrow('blocked');
    expect(deleted).toHaveBeenCalledOnce();
  });
});

it('revoking recovery during async migration cannot resurrect a pending save', async () => {
  const project: StudioProject = { version: 1, name: 'Recovery', pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [] }] };
  const pending = writeRecovery(JSON.stringify(project));
  cancelRecoveryWrites();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.write).not.toHaveBeenCalled();
});

it('roundtrips page and selection state with the revisioned checkpoint while keeping the string API', async () => {
  const project: StudioProject = { version: 1, name: 'Recovery', pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [] }] };
  const view = { pageId: 'page', pageIndex: 0, selectedIds: ['shape'] };
  await writeRecovery(JSON.stringify(project), 7, 3, undefined, view);
  expect(state.write).toHaveBeenCalledWith({ project, revision: 7, nativeRevision: 3, view }, undefined);
  state.read.mockResolvedValue({ checkpoint: { project, revision: 7, nativeRevision: 3, view }, recoveredPrevious: false });
  expect(await readRecoveryState()).toMatchObject({ view, serialized: expect.any(String) });
  expect(await readRecovery()).toBe((await readRecoveryState())?.serialized);
});

