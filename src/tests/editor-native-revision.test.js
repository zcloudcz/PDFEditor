// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

// Execute the production functions without starting the app's DOM/bootstrap IIFE.
const source = readFileSync(new URL('../js/editcore/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function harness() {
  const state = { documentRevision: 0, dirty: false, editing: null, docEpoch: 0, undo: [], redo: [] };
  const engine = { doc: 1, pageIndex: 0, untaggedMarks: () => [], saveSpliced: vi.fn(async () => new Uint8Array([1])) };
  state.engine = engine;
  const events = [];
  const context = {
    state, P: () => state.engine,
    window: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    applyTagSurgery: vi.fn((bytes) => new Uint8Array([...bytes, 2])),
    renderPage: vi.fn(), engineStepEnd: vi.fn(), endEdit: vi.fn(),
    syncHistoryPins: vi.fn(), refreshModel: vi.fn(), updateChrome: vi.fn(), toast: vi.fn(),
    confirmPlaintextExport: null, uiText: (text) => text,
  };
  context.releaseSelection = () => context.endEdit(true);
  runInNewContext(
    section('function getDocumentRevision()', 'const MAX_UNDO =') +
    section('function unpristine()', 'function openEditor(') +
    section('function restore(from, to)', 'const docFonts =') +
    section('async function captureSnapshot()', 'async function saveFile()'), context);
  return { ...context, events, engine };
}

describe('native content revisions and stable recovery snapshots', () => {
  it('serializes once per native revision and returns detached snapshot bytes', async () => {
    const h = harness();
    let saves = 0;
    h.engine.saveSpliced.mockImplementation(async () => new Uint8Array([++saves]));
    const first = await h.captureStudioSnapshot();
    first.bytes[0] = 99;
    expect([...(await h.createRecoverySnapshot()).bytes]).toEqual([1]);
    expect(h.engine.saveSpliced).toHaveBeenCalledTimes(1);
    h.documentChanged();
    expect([...(await h.captureStudioSnapshot()).bytes]).toEqual([2]);
    h.state.docEpoch++;
    expect([...(await h.captureStudioSnapshot()).bytes]).toEqual([3]);
    h.state.engine = { ...h.engine };
    expect([...(await h.captureStudioSnapshot()).bytes]).toEqual([4]);
  });
  it('shares concurrent serialization and rejects an epoch change during serialization', async () => {
    const h = harness();
    let finish;
    h.engine.saveSpliced.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = h.captureStudioSnapshot();
    const second = h.createRecoverySnapshot();
    expect(h.engine.saveSpliced).toHaveBeenCalledTimes(1);
    h.state.docEpoch++;
    finish(new Uint8Array([1]));
    expect(await first).toBeNull();
    expect(await second).toBeNull();
  });
  it('releases cached bytes on document close and invalidates a changed native document handle', async () => {
    const h = harness();
    await h.captureStudioSnapshot();
    expect(h.state.snapshotCache).toBeTruthy();
    h.engine.doc = 0;
    expect(await h.captureSnapshot()).toBeNull();
    expect(h.state.snapshotCache).toBeNull();
    h.engine.doc = 2;
    await h.captureStudioSnapshot();
    expect(h.engine.saveSpliced).toHaveBeenCalledTimes(2);
    h.engine.doc = 3;
    await h.captureStudioSnapshot();
    expect(h.engine.saveSpliced).toHaveBeenCalledTimes(3);
    h.documentChanged();
    expect(h.state.snapshotCache).toBeNull();
  });
  it('composes an encrypted document in memory while retaining recovery and explicit export consent gates', async () => {
    const h = harness();
    h.state.originalEncrypted = true;
    h.window.confirm = vi.fn(() => false);
    const composition = await h.captureStudioSnapshot();
    expect([...composition.bytes]).toEqual([1]);
    expect(composition.revision).toBe(h.getDocumentRevision());
    expect(h.endEdit).toHaveBeenCalledWith(true);
    expect(h.isRecoveryAllowed()).toBe(false);
    expect(await h.createRecoverySnapshot()).toBeNull();
    expect(h.window.confirm).not.toHaveBeenCalled();
    expect(await h.exportSnapshot()).toBeNull();
    expect(h.window.confirm).toHaveBeenCalledOnce();
  });
  it('exposes encryption recovery policy without opening a plaintext export prompt', () => {
    const h = harness(); expect(h.isRecoveryAllowed()).toBe(true);
    h.state.originalEncrypted = true; expect(h.isRecoveryAllowed()).toBe(false);
  });
  it('background composition never ends an active native typing session', async () => {
    const h = harness();
    h.state.editing = { pristine: false };
    expect(await h.captureStudioSnapshot({ commit: false })).toBeNull();
    expect(h.endEdit).not.toHaveBeenCalled();
    expect(h.engine.saveSpliced).not.toHaveBeenCalled();
  });

  it('advances on each pending input, even after the first pristine transition', () => {
    const h = harness();
    h.state.editing = { pristine: true, el: { classList: { remove: vi.fn() } } };
    h.unpristine(); h.unpristine(); h.unpristine();
    expect(h.getDocumentRevision()).toBe(3);
    expect(h.events.map(e => e.detail.revision)).toEqual([1, 2, 3]);
    expect(h.events.every(e => e.type === 'editor:document-changed')).toBe(true);
    expect(h.hasPendingEdits()).toBe(true);
    expect(h.renderPage).toHaveBeenCalledTimes(1);
  });
  it('publishes successful undo and redo, but does not publish failed undo', () => {
    const h = harness();
    h.engine.historyUndo = vi.fn(() => false);
    h.engine.historyRedo = vi.fn(() => true);
    h.engine.historyDepth = () => ({ undo: 1 });
    h.state.undo.push({ engine: true, epoch: 0 });
    h.restore(h.state.undo, h.state.redo);
    expect(h.getDocumentRevision()).toBe(0);
    h.engine.historyUndo.mockReturnValue(true);
    h.restore(h.state.undo, h.state.redo);
    h.restore(h.state.redo, h.state.undo);
    expect(h.getDocumentRevision()).toBe(2);
  });
  it('defers pending caret edits and encrypted recovery without saving or prompting', async () => {
    const h = harness();
    h.state.editing = { pristine: false };
    expect(await h.createRecoverySnapshot()).toBeNull();
    h.state.editing = null;
    h.state.originalEncrypted = true;
    expect(await h.createRecoverySnapshot()).toBeNull();
    expect(h.engine.saveSpliced).not.toHaveBeenCalled();
    expect(h.endEdit).not.toHaveBeenCalled();
  });
  it.each(['edit', 'replace'])('rejects a snapshot made stale by %s during async serialization', async (change) => {
    const h = harness();
    let finish;
    h.engine.saveSpliced.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.createRecoverySnapshot();
    if (change === 'edit') h.documentChanged();
    else h.state.engine = { ...h.engine };
    finish(new Uint8Array([1]));
    expect(await pending).toBeNull();
  });
  it('keeps staged alt text repeatable and captures the page before navigation', async () => {
    const h = harness();
    h.state.pendingAlt = [{ mcid: 4, text: 'Accessible image', pageIndex: 0 }];
    h.engine.saveSpliced.mockImplementation(async () => { h.engine.pageIndex = 3; return new Uint8Array([1]); });
    const first = await h.createRecoverySnapshot();
    expect(h.applyTagSurgery.mock.calls[0][1].pageIndex).toBe(0);
    expect(first.revision).toBe(0);
    expect([...first.bytes]).toEqual([1, 2]);
    expect(h.state.pendingAlt).toHaveLength(1);
    expect([...(await h.createRecoverySnapshot()).bytes]).toEqual([1, 2]);
    expect(h.applyTagSurgery).toHaveBeenCalledTimes(2);
    expect(h.applyTagSurgery.mock.calls[1][1].pageIndex).toBe(0);
    h.state.pendingAlt.push({ mcid: 4, text: 'Other image', pageIndex: 3 });
    await h.createRecoverySnapshot();
    expect(h.applyTagSurgery.mock.calls[2][1]).toMatchObject({pageIndex: 0, altText: [{mcid: 4, text: 'Accessible image', pageIndex: 0}]});
    expect(h.applyTagSurgery.mock.calls[3][1]).toMatchObject({pageIndex: 3, altText: [{mcid: 4, text: 'Other image', pageIndex: 3}]});
  });
  it('does not return an untagged checkpoint when tag surgery fails', async () => {
    const h = harness();
    h.state.pendingAlt = [{ mcid: 4, text: 'Accessible image', pageIndex: 0 }];
    h.applyTagSurgery.mockImplementation(() => { throw new Error('surgery failed'); });
    await expect(h.createRecoverySnapshot()).rejects.toThrow('surgery failed');
    expect(h.state.pendingAlt).toHaveLength(1);
  });
});
