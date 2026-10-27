// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const app = readFileSync(new URL('../js/editcore/app.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../js/editcore/core.js', import.meta.url), 'utf8');
function section(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
function harness() {
  const secret = { text: 'synthetic private text' };
  const state = { engine: { discardForSanitization: vi.fn() }, docEpoch: 3, documentRevision: 8, snapshotCache: secret, undo: [secret], redo: [secret], paragraphs: [secret], editing: { el: { remove: vi.fn() } }, textSel: secret, selection: secret, pendingAlt: [secret], docInfo: secret, docMeta: secret, find: secret, dirty: true };
  const elements = new Map();
  const element = () => ({ replaceChildren: vi.fn(), remove: vi.fn(), hidden: false, width: 100, height: 100, textContent: 'synthetic private text', append: vi.fn() });
  const context = { state, P: () => state.engine, $: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    document: { fonts: { delete: vi.fn() }, querySelectorAll: () => [] }, window: {},
    clearTimeout: vi.fn(), clearInterval: vi.fn(), cancelAnimationFrame: vi.fn(),
    fontPrewarmTimer: 1, regenTimer: 2, previewRaf: 3, zoomFrame: 4, zoomPending: true,
    engineStepOpen: true, liveBlockMove: secret, objectIndexCache: secret, lockedEpoch: 1, lockedSeq: 1,
    docFonts: new Map([['a', { face: secret }]]), docFontsReady: new Map([['a', 'font']]), docFontsNull: new Set(['b']), docFontFaces: new Set([secret]),
    _fontADCache: new Map([['a', secret]]), continuousPages: { engine: state.engine, doc: 1, frame: 7, activeWrap: element(), list: element(), slots: [secret] },
    nativeSanitizationEpoch: 0, toast: { _t: 4 },
    spell: { list: [secret], at: 0, ignored: new Set(['secret']) },
    nativeDocumentCleanups: new Set(), resetNativePointerState: vi.fn(),
    clearNativeContextSelection: vi.fn(), isNativeContextSelectionClear: vi.fn(() => true),
  };
  runInNewContext(section(app, 'async function discardDocumentForSanitization()', '// Capture page-local metadata'), context);
  return { ...context, elements };
}
describe('targeted native document purge', () => {
  it('requires the context toolbar owner to clear and verify its retained selection', async () => {
    const h = harness();
    h.isNativeContextSelectionClear.mockReturnValue(false);
    await expect(h.discardDocumentForSanitization()).rejects.toThrow('Native document purge incomplete');
    expect(h.clearNativeContextSelection).toHaveBeenCalledOnce();
    expect(h.isDocumentDiscardedForSanitization()).toBe(false);
  });
  it('cancels registered gesture closures before retiring content', async () => {
    const h = harness(), cleanup = vi.fn();
    h.nativeDocumentCleanups.add(cleanup);
    await h.discardDocumentForSanitization();
    expect(cleanup).toHaveBeenCalledOnce(); expect(h.nativeDocumentCleanups.size).toBe(0);
    expect(h.resetNativePointerState).toHaveBeenCalledOnce();
  });
  it('waits for retired serialization before closing its engine', async () => {
    const h = harness(), old = h.state.engine;
    let finish; h.state.snapshotCache = { bytes: new Promise(resolve => { finish = resolve; }) };
    const purge = h.discardDocumentForSanitization();
    expect(h.state.engine).toBeNull(); expect(old.discardForSanitization).not.toHaveBeenCalled();
    finish(new Uint8Array([42])); await purge;
    expect(old.discardForSanitization).toHaveBeenCalledOnce();
  });
  it('does not re-add an embedded FontFace when its load finishes after retirement', async () => {
    let finish;
    const engine = { synthRunFont: () => new Uint8Array([1, 2]) };
    const context = { state: { docEpoch: 1 }, P: () => engine, docFontKey: () => 'old',
      docFonts: new Map(), docFontsReady: new Map(), docFontsNull: new Set(), docFontFaces: new Set(),
      docFontSeq: 0, lockedEpoch: 0, document: { fonts: { add: vi.fn() } },
      FontFace: class { load() { return new Promise(resolve => { finish = resolve; }); } },
    };
    runInNewContext(section(app, 'async function ensureRunFont(', 'async function applyDocFonts('), context);
    const pending = context.ensureRunFont({ id: 1 }, 0, {});
    context.state.docEpoch++; context.docFonts.clear();
    finish(); expect(await pending).toBeNull();
    expect(context.document.fonts.add).not.toHaveBeenCalled();
    expect(context.docFontsReady.size + context.docFontsNull.size + context.docFontFaces.size).toBe(0);
  });
  it('drops both histories, snapshot, engine, fonts, page previews and selection references', async () => {
    const h = harness(), old = h.state.engine;
    await h.discardDocumentForSanitization();
    expect(old.discardForSanitization).toHaveBeenCalledOnce();
    expect(h.state.engine).toBeNull(); expect(h.state.snapshotCache).toBeNull();
    for (const key of ['undo', 'redo', 'paragraphs', 'pendingAlt']) expect(h.state[key]).toEqual([]);
    for (const key of ['editing', 'selection', 'textSel', 'docInfo', 'docMeta']) expect(h.state[key]).toBeNull();
    expect(h.docFonts.size + h.docFontsReady.size + h.docFontsNull.size + h.docFontFaces.size).toBe(0);
    expect(h.continuousPages.engine).toBeNull(); expect(h.continuousPages.slots).toEqual([]);
    expect(h.isDocumentDiscardedForSanitization()).toBe(true);
    expect(h.state.docEpoch).toBe(4);
  });
  it('drops app references even when native disposal fails and reports failure', async () => {
    const h = harness(); h.state.engine.discardForSanitization.mockImplementation(() => { throw new Error('native failure'); });
    await expect(h.discardDocumentForSanitization()).rejects.toThrow('native failure');
    expect(h.state.engine).toBeNull(); expect(h.state.undo).toEqual([]);
  });
  it('discards all own engine data only through the explicit irreversible API', () => {
    const context = {};
    runInNewContext(`class Engine { ${section(core, '  discardForSanitization() {', '\n  loadPage(index)')} }; globalThis.Engine = Engine;`, context);
    const engine = new context.Engine(); engine.close = vi.fn(); engine.renderParagraphLiveEnd = vi.fn();
    engine.M = { HEAPU8: new Uint8Array([11]) }; engine._originalBytes = new Uint8Array([42]); engine._splicePlans = { secret: 'old' };
    const close = engine.close; engine.discardForSanitization();
    expect(close).toHaveBeenCalledOnce(); expect(Object.keys(engine)).toEqual([]);
  });
});
