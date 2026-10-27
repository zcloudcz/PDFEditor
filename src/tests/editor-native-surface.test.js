// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync(new URL('../js/editcore/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function harness(fail = false) {
  const order = [];
  const overlay = { appendChild: vi.fn() };
  const editable = { textContent: 'Committed native draft' };
  const el = { remove: vi.fn(), isConnected: false };
  const para = { id: 7, box: { top: 100, h: 20 }, runs: [{ text: 'Original' }] };
  const state = { editing: { editable, el, para }, undo: [], dirty: false };
  const engine = { doc: 1, renderParagraphLiveEnd: vi.fn(), commitParagraph: vi.fn((_id, runs) => {
    if (fail === 'null') return null;
    if (fail) throw new Error('Commit failed');
    order.push(runs[0].text); return { ...para, runs };
  }) };
  const context = { state, P: () => engine, liveBlockMove: null, clearTimeout,
    parseEditor: (input) => [{ text: input.textContent }], runsDiffer: () => true,
    window: {}, snapshotEdit: vi.fn(), replaceParagraph: vi.fn(), cascadeParagraphGrowth: vi.fn(),
    documentChanged: vi.fn(), refreshAfterMutation: vi.fn(), paraDirtyRect: vi.fn(), blockMembers: () => [],
    selectObject: () => order.push('release'), $: () => overlay, uiText: text => text,
    captureSnapshot: vi.fn(async () => ({ bytes: new Uint8Array([1]), revision: 4 })),
    getDocumentRevision: () => 4, confirmPlaintextExport: null, toast: vi.fn(),
  };
  runInNewContext(section('function endEdit(commit)', 'function updateHoverCursor') + section('function releaseSelection()', 'function selectStudioPage') + section('async function exportSnapshot()', 'async function saveFile()'), context);
  return { ...context, engine, order, overlay, editable, el };
}
describe('native draft handoff to graphic selection', () => {
  it('synchronously commits the active draft before graphic changes and their undo checkpoint', () => {
    const h = harness(); h.releaseSelection();
    h.order.push('graphic change'); h.order.push('graphic undo');
    expect(h.order).toEqual(['Committed native draft', 'release', 'graphic change', 'graphic undo']);
    expect(h.engine.commitParagraph).toHaveBeenCalledOnce(); expect(h.state.editing).toBeNull();
  });
  it('retains the editable native draft and refuses graphic handoff if committing throws', () => {
    const h = harness(true);
    expect(() => h.releaseSelection()).toThrow('Commit failed');
    expect(h.state.editing?.editable).toBe(h.editable);
    expect(h.overlay.appendChild).toHaveBeenCalledWith(h.el);
    expect(h.order).not.toContain('release');
  });
  it('retains the native draft when the engine refuses its commit', () => {
    const h = harness('null');
    expect(() => h.releaseSelection()).toThrow();
    expect(h.state.editing?.editable).toBe(h.editable);
    expect(h.order).not.toContain('release');
  });
  for (const failure of [true, 'null']) {
    it(`direct native blur finalization preserves a failed draft (${failure})`, () => {
      const h = harness(failure);
      expect(() => h.endEdit(true)).toThrow();
      expect(h.state.editing?.editable).toBe(h.editable);
      expect(h.overlay.appendChild).toHaveBeenCalledWith(h.el);
    });
  }
  for (const failure of [true, 'null']) for (const method of ['captureStudioSnapshot', 'exportSnapshot']) {
    it(`${method} retains a refused native draft and never returns an older snapshot (${failure})`, async () => {
      const h = harness(failure);
      await expect(h[method]()).rejects.toThrow();
      expect(h.state.editing?.editable).toBe(h.editable);
      expect(h.overlay.appendChild).toHaveBeenCalledWith(h.el);
      expect(h.captureSnapshot).not.toHaveBeenCalled();
    });
  }
});
