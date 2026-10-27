import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { StudioProject } from '../editor/studio/types';
import { PageOperationError } from '../editor/pdf/page-operations';
import { t } from '../editor/i18n';
const harness = vi.hoisted(() => ({
  project: null as StudioProject | null,
  active: 'first',
  selected: [] as string[],
  changes: undefined as ((p: StudioProject) => void) | undefined,
  template: null as StudioProject | null,
  prepare: vi.fn(),
  merge: vi.fn(),
  serialize: vi.fn(),
  images: vi.fn(),
  set: vi.fn(),
  destroy: vi.fn(),
  pageAction: vi.fn(),
  pageExport: vi.fn(),
  pageSplit: vi.fn(),
  pageMerge: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  clearSelection: vi.fn(),
}));
vi.mock('../editor/studio/canvas', () => ({
  mountStudioCanvas: vi.fn(
    (
      _host: HTMLElement,
      project: StudioProject,
      change: (p: StudioProject) => void
    ) => {
      _host.innerHTML = '<main class="studio-workspace"><div class="studio-stage"></div></main>';
      harness.project = structuredClone(project);
      harness.changes = change;
      return {
        getProject: () => structuredClone(harness.project),
        setProject: (p: StudioProject, options?: { recordHistory?: boolean }) => {
          harness.set(p, options);
          harness.project = structuredClone(p);
          harness.selected = [];
          if (options?.recordHistory) change(structuredClone(p));
        },
        getActivePageId: () => harness.active,
        getViewState: () => ({ pageId: harness.active, selectedIds: [...harness.selected] }),
        restoreViewState: (view: { pageId?: string; pageIndex?: number; selectedIds: string[] }) => {
          harness.active = view.pageId ?? harness.project!.pages[view.pageIndex ?? 0].id;
          harness.selected = [...view.selectedIds];
        },
        setPageBackground: vi.fn(),
        destroy: harness.destroy,
        purgeForSanitization: async () => { harness.destroy(); harness.project = null; },
        attachNativeSurface: harness.attach,
        detachNativeSurface: harness.detach,
        clearSelection: harness.clearSelection,
        updateNativeSource: (sourcePdf: string) => { harness.project!.sourcePdf = sourcePdf; },
      };
    }
  ),
}));
vi.mock('../editor/studio/templates', () => ({
  mountTemplatePicker: (
    host: HTMLElement,
    choose: (p: StudioProject) => void
  ) => {
    const button = document.createElement('button');
    button.id = 'choose-test-template';
    button.onclick = () => choose(structuredClone(harness.template!));
    host.append(button);
    return () => {};
  },
}));
vi.mock('../editor/studio/brand-kit', () => ({ mountBrandKit: vi.fn() }));
vi.mock('../editor/studio/page-actions', () => ({
  parsePageSelection: (value: string) => value.split(',').map(item => Number(item.trim()) - 1),
  applyPageAction: (...args: unknown[]) => harness.pageAction(...args),
  exportSelectedPages: (...args: unknown[]) => harness.pageExport(...args),
  splitProjectPages: (...args: unknown[]) => harness.pageSplit(...args),
  mergeProjectPdfs: (...args: unknown[]) => harness.pageMerge(...args),
}));
vi.mock('../editor/studio/exports', () => ({
  exportPdf: vi.fn(async () => new Uint8Array([1])),
  exportSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
  exportImages: (...args: unknown[]) => harness.images(...args),
  exportPptx: vi.fn(),
  renderPdfBackground: vi.fn(async () => null),
}));
vi.mock('../editor/studio/document-bridge', () => ({
  prepareNativeDocument: (...args: unknown[]) => harness.prepare(...args),
  mergeNativeSnapshot: (...args: unknown[]) => harness.merge(...args),
  visibleSize: (page: { getSize(): unknown }) => page.getSize(),
  validateProjectSource: vi.fn(async () => {}),
}));
vi.mock('../editor/studio/project-io', () => ({
  validateProject: vi.fn(),
  base64Bytes: (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0)),
  bytesBase64: (value: Uint8Array) => btoa(String.fromCharCode(...value)),
  serializeProject: (p: StudioProject) => {
    harness.serialize(p);
    return JSON.stringify(p);
  },
  parseProject: JSON.parse,
  parsePortableProject: async (text: string) => JSON.parse(text),
  serializePortableProject: async (p: StudioProject) => { harness.serialize(p); return JSON.stringify(p); },
}));
vi.mock('../editor/studio/recovery', () => ({
  prepareRecoveryPurge: vi.fn(async () => vi.fn(async () => {})),
  clearRecovery: vi.fn(),
  readRecoveryState: vi.fn(async () => undefined),
  writeRecovery: vi.fn(async () => {}),
  cancelRecoveryWrites: vi.fn(),
}));
vi.mock('../editor/pdf/redaction', () => ({ prepareRedaction: vi.fn(async (bytes: Uint8Array) => ({ bytes, appliedMarks: 1 })) }));
import { setupStudio } from '../editor/studio/host';
import { clearRecovery, readRecoveryState, writeRecovery } from '../editor/studio/recovery';
import { prepareRecoveryPurge } from '../editor/studio/recovery';
import { prepareRedaction } from '../editor/pdf/redaction';
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const click = (id: string) =>
  (document.getElementById(id) as HTMLButtonElement).click();
const settled = async () => {
  await vi.waitFor(() => {
    expect((document.getElementById('studio-save') as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById('graphic-studio')!.dataset.surfacePending).not.toBe('true');
  });
};
let snapshot: Uint8Array;
let listeners: Array<
  [
    string,
    EventListenerOrEventListenerObject,
    boolean | AddEventListenerOptions | undefined,
  ]
> = [];
let app: {
  exportSnapshot: Mock<() => Promise<Uint8Array | null>>;
  getCurrentPageIndex: Mock<() => number>;
  getNativeRevision: Mock<() => number>;
  createRecoverySnapshot: Mock<() => Promise<{ bytes: Uint8Array; revision: number } | null>>;
  captureStudioSnapshot: Mock<() => Promise<{ bytes: Uint8Array; revision: number } | null>>;
  getPageSurface: Mock;
  releaseSelection: Mock;
  selectStudioPage: Mock;
  isRecoveryAllowed: Mock;
  discardDocumentForSanitization?: Mock;
  isDocumentDiscardedForSanitization?: Mock;
};
let launch: Mock<() => Promise<boolean>>;
let api: ReturnType<typeof setupStudio>;
beforeEach(async () => {
  vi.clearAllMocks();
  harness.project = null;
  harness.active = 'first';
  harness.selected = [];
  harness.destroy.mockReset();
  listeners = [];
  document.body.innerHTML =
    '<div class="welcome-actions"></div><div id="text-editor-app"><div id="toolbar"></div><div id="stage"><div id="pageWrap" class="continuous-page" data-page-index="0"></div></div><button id="save"></button></div>';
  delete document.body.dataset.editorMode;
  document.body.className = '';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (type, listener, options) => {
      listeners.push([type, listener, options]);
      add(type, listener, options);
    }
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:studio-test');
  URL.revokeObjectURL = vi.fn();
  const native = await PDFDocument.create();
  native.addPage([300, 200]);
  native.addPage([300, 200]);
  snapshot = await native.save();
  harness.template = {
    version: 1,
    name: 'One shared document',
    pages: [
      {
        id: 'first',
        name: 'First',
        width: 300,
        height: 200,
        background: '#ffffff',
        objects: [
          {
            id: 'label',
            name: 'Editable label',
            kind: 'text',
            text: 'Keep editable',
            fontSize: 20,
            x: 20,
            y: 20,
            width: 100,
            height: 30,
            rotation: 0,
            opacity: 1,
            fill: '#000000',
            stroke: 'none',
            strokeWidth: 0,
            locked: false,
          },
        ],
      },
      {
        id: 'second',
        name: 'Second',
        width: 300,
        height: 200,
        background: '#ffffff',
        objects: [],
      },
    ],
  };
  harness.prepare.mockImplementation(async (project: StudioProject) => ({
    bytes: project.sourcePdf ? Uint8Array.from(atob(project.sourcePdf), c => c.charCodeAt(0)) : snapshot,
    project: {
      ...structuredClone(project),
      sourcePdf: project.sourcePdf ?? b64(snapshot),
      pages: project.pages.map((p, i) => ({
        ...structuredClone(p),
        sourcePageIndex: i,
      })),
    },
  }));
  harness.merge.mockImplementation(
    async (project: StudioProject, bytes: Uint8Array) => ({
      ...structuredClone(project),
      sourcePdf: b64(bytes),
    })
  );
  harness.images.mockResolvedValue({
    bytes: new Uint8Array([1]),
    mime: 'image/png',
    extension: 'png',
  });
  harness.pageAction.mockImplementation(async (project: StudioProject) => {
    const next = structuredClone(project);
    next.pages.reverse();
    return next;
  });
  harness.pageExport.mockResolvedValue(new Uint8Array([1, 2, 3]));
  harness.pageSplit.mockResolvedValue(new Uint8Array([80, 75]));
  harness.pageMerge.mockImplementation(async (project: StudioProject) => structuredClone(project));
  app = {
    exportSnapshot: vi.fn(async () => snapshot),
    getCurrentPageIndex: vi.fn(() => 1),
    getNativeRevision: vi.fn(() => 1),
    createRecoverySnapshot: vi.fn(async () => ({ bytes: snapshot, revision: 1 })),
    captureStudioSnapshot: vi.fn(async () => ({ bytes: snapshot, revision: 1 })),
    getPageSurface: vi.fn(() => ({ container: document.getElementById('pageWrap')!, pageIndex: 0, width: 300, height: 200, zoom: 1 })),
    releaseSelection: vi.fn(), selectStudioPage: vi.fn(), isRecoveryAllowed: vi.fn(() => true),
  };
  launch = vi.fn(async () => {
    snapshot = new Uint8Array((await harness.prepare.mock.results.at(-1)!.value).bytes);
    window.dispatchEvent(
      new Event('editor:before-document-open', { cancelable: true })
    );
    window.dispatchEvent(new Event('editor:document-opened'));
    return true;
  });
  api = setupStudio(() => app, launch);
  click('studio-templates');
  click('choose-test-template');
  (document.getElementById('studio-autosave') as HTMLInputElement).checked =
    false;
  document
    .getElementById('studio-autosave')!
    .dispatchEvent(new Event('change'));
  await settled();
  vi.clearAllMocks();
});
afterEach(() => {
  for (const [type, listener, options] of listeners)
    window.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const pageAction = async (kind: string, selection = '1') => {
  document.querySelector<HTMLInputElement>('.studio-page-manager input')!.value = selection;
  document.querySelector<HTMLButtonElement>(`[data-page-action="${kind}"]`)!.click();
  await settled();
};

it('restores the recovery page and selection after the native surface is ready', async () => {
  const project = structuredClone(harness.template!);
  project.pages[1].objects = [{ ...structuredClone(project.pages[0].objects[0]), id: 'recovered-label' }];
  vi.mocked(readRecoveryState).mockResolvedValueOnce({
    serialized: JSON.stringify(project),
    view: { pageId: 'second', pageIndex: 1, selectedIds: ['recovered-label'] },
  });
  click('studio-recover');
  await vi.waitFor(() => expect(harness.active).toBe('second'));
  expect(harness.selected).toEqual(['recovered-label']);
  expect(app.selectStudioPage).toHaveBeenCalledWith(1);
  expect(harness.project!.pages[1].objects[0].id).toBe('recovered-label');
});
describe('one persistent document surface', () => {
  it('attaches editable graphics to the protected native page without mode buttons', () => {
    expect(document.getElementById('studio-close')).toBeNull();
    expect(document.getElementById('open-graphic-tools')).toBeNull();
    expect(document.getElementById('graphic-studio')!.hidden).toBe(false);
    expect(document.getElementById('text-editor-app')!.closest('.studio-workspace')).not.toBeNull();
    expect(document.body.dataset.editorMode).toBe('unified');
    expect(harness.project!.pages[0].objects[0].text).toBe('Keep editable');
  });
  it('routes selection between native text and graphics without reloading either document', () => {
    window.dispatchEvent(new Event('editor:graphic-selected'));
    expect(app.releaseSelection).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('editor:native-selected'));
    expect(harness.clearSelection).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
    expect(harness.prepare).not.toHaveBeenCalled();
    expect(app.exportSnapshot).not.toHaveBeenCalled();
  });
  it('uses native geometry after zoom and page navigation', () => {
    const geometry = { container: document.getElementById('pageWrap')!, pageIndex: 1, width: 200, height: 300, zoom: 1.5 };
    window.dispatchEvent(new CustomEvent('editor:page-rendered', { detail: geometry }));
    expect(harness.attach).toHaveBeenCalledWith(geometry);
    window.dispatchEvent(new CustomEvent('editor:graphic-page-selected', { detail: { pageIndex: 1 } }));
    expect(app.selectStudioPage).toHaveBeenCalledWith(1);
    expect(launch).not.toHaveBeenCalled();
  });
  it('saves fresh native content and editable graphic objects together', async () => {
    const pdf = await PDFDocument.load(snapshot); pdf.setTitle('Latest native text'); snapshot = await pdf.save();
    click('studio-save'); await settled();
    expect(app.exportSnapshot).toHaveBeenCalledOnce();
    expect(harness.serialize).toHaveBeenCalledWith(expect.objectContaining({ sourcePdf: b64(snapshot), pages: expect.arrayContaining([expect.objectContaining({ objects: harness.template!.pages[0].objects })]) }));
    expect(document.getElementById('graphic-studio')!.hidden).toBe(false);
  });
  it('does not export a project when protected plaintext export is declined', async () => {
    app.exportSnapshot.mockResolvedValueOnce(null);
    click('studio-save'); await settled();
    expect(harness.serialize).not.toHaveBeenCalled();
    expect(document.getElementById('studio-status')!.textContent).toBe(t('Převzetí změn PDF bylo zrušeno.'));
  });
  it('locks native and graphic editing while a save snapshot is pending', async () => {
    let resolve!: (bytes: Uint8Array) => void;
    app.exportSnapshot.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    click('studio-save');
    await vi.waitFor(() => expect(app.exportSnapshot).toHaveBeenCalled());
    expect(document.getElementById('text-editor-app')!.inert).toBe(true);
    expect(document.getElementById('studio-canvas-host')!.inert).toBe(true);
    resolve(snapshot); await settled();
    expect(document.getElementById('text-editor-app')!.inert).toBe(false);
  });
  it('automatically mounts a directly opened PDF in the same editor', async () => {
    window.dispatchEvent(new Event('editor:document-opened')); await settled();
    expect(app.captureStudioSnapshot).toHaveBeenCalledOnce();
    expect(app.exportSnapshot).not.toHaveBeenCalled();
    expect(harness.project!.pages).toHaveLength(2);
    expect(document.getElementById('text-editor-app')!.closest('.studio-workspace')).not.toBeNull();
    expect(document.getElementById('graphic-studio')!.hidden).toBe(false);
  });
  it('keeps encrypted in-memory composition out of automatic recovery', async () => {
    app.isRecoveryAllowed.mockReturnValue(false);
    const autosave = document.getElementById('studio-autosave') as HTMLInputElement;
    autosave.checked = true;
    window.dispatchEvent(new Event('editor:document-opened')); await settled();
    window.dispatchEvent(new Event('editor:document-changed'));
    await new Promise(done => setTimeout(done, 750));
    expect(writeRecovery).not.toHaveBeenCalled();
    expect(app.exportSnapshot).not.toHaveBeenCalled();
    autosave.checked = false; autosave.dispatchEvent(new Event('change'));
  });
  it('recovers committed native content and graphics in one snapshot', async () => {
    const autosave = document.getElementById('studio-autosave') as HTMLInputElement;
    autosave.checked = true;
    window.dispatchEvent(new Event('editor:document-changed'));
    await vi.waitFor(() => expect(writeRecovery).toHaveBeenCalled(), { timeout: 2000 });
    const saved = JSON.parse(vi.mocked(writeRecovery).mock.calls.at(-1)![0]) as StudioProject;
    expect(saved.sourcePdf).toBe(b64(snapshot));
    expect(saved.pages[0].objects[0].text).toBe('Keep editable');
    autosave.checked = false; autosave.dispatchEvent(new Event('change'));
  });
  it('synchronizes native checkpoints without resetting active graphic selection', async () => {
    harness.selected = ['label'];
    const pdf = await PDFDocument.load(snapshot); pdf.setTitle('Checkpoint'); snapshot = await pdf.save();
    app.getNativeRevision.mockReturnValue(2);
    app.captureStudioSnapshot.mockImplementation(async () => ({ bytes: snapshot, revision: 2 }));
    window.dispatchEvent(new Event('editor:document-changed'));
    await vi.waitFor(() => expect(harness.project!.sourcePdf).toBe(b64(snapshot)));
    expect(harness.selected).toEqual(['label']);
    expect(harness.set).not.toHaveBeenCalled();
  });
  it('preserves both editable layers through a page operation and shared undo', async () => {
    click('studio-pages'); await settled();
    await pageAction('reverse', '1,2');
    expect(harness.project!.pages.map(page => page.id)).toEqual(['second', 'first']);
    expect(harness.project!.pages[1].objects[0].text).toBe('Keep editable');
    document.querySelector('dialog')?.close();
    click('document-undo'); await settled();
    expect(harness.project!.pages.map(page => page.id)).toEqual(['first', 'second']);
    expect(document.getElementById('graphic-studio')!.hidden).toBe(false);
  });
  it('undoes the page operation immediately when native loading canonicalizes prepared bytes', async () => {
    const canonical = snapshot;
    app.captureStudioSnapshot.mockImplementation(async () => ({ bytes: canonical, revision: 1 }));
    app.exportSnapshot.mockImplementation(async () => canonical);
    const prepare = harness.prepare.getMockImplementation()!;
    harness.prepare.mockImplementation(async (project: StudioProject) => {
      const result = await prepare(project);
      const serialized = new Uint8Array([...result.bytes, 10]);
      return { bytes: serialized, project: { ...result.project, sourcePdf: b64(serialized) } };
    });
    click('studio-pages'); await settled();
    await pageAction('reverse', '1,2');
    expect(harness.project!.pages.map(page => page.id)).toEqual(['second', 'first']);
    document.querySelector('dialog')?.close();
    click('studio-save'); await settled();
    click('document-undo'); await settled();
    expect(harness.project!.pages.map(page => page.id)).toEqual(['first', 'second']);
    click('document-redo'); await settled();
    expect(harness.project!.pages.map(page => page.id)).toEqual(['second', 'first']);
  });
  it('refuses stale page results when native content changes during preparation', async () => {
    let resolve!: (project: StudioProject) => void;
    harness.pageAction.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    click('studio-pages'); await settled();
    document.querySelector<HTMLButtonElement>('[data-page-action="reverse"]')!.click();
    await vi.waitFor(() => expect(harness.pageAction).toHaveBeenCalled());
    window.dispatchEvent(new Event('editor:document-changed'));
    resolve({ ...structuredClone(harness.project!), name: 'Stale' }); await settled();
    expect(harness.project!.name).not.toBe('Stale');
    expect(document.querySelector('.studio-page-manager [role="alert"]')!.textContent).toBe(t('Operace se nezdařila.'));
  });
  it('keeps the project and page dialog when native snapshot is cancelled', async () => {
    app.captureStudioSnapshot.mockResolvedValueOnce(null);
    click('studio-pages'); await settled();
    expect(document.querySelector('.studio-page-manager')).toBeNull();
    expect(harness.project!.name).toBe('One shared document');
  });
  it('splits selected pages without flattening or replacing the current project', async () => {
    click('studio-pages'); await settled();
    const before = structuredClone(harness.project);
    await pageAction('split', '1,2');
    expect(harness.pageSplit).toHaveBeenCalledWith(expect.objectContaining({ sourcePdf: b64(snapshot) }), [0, 1]);
    expect(harness.project).toEqual(before);
  });
  it('converts crop millimetres exactly once', async () => {
    click('studio-pages'); await settled();
    document.querySelector<HTMLInputElement>('[name="crop-left"]')!.value = '25.4';
    document.querySelector<HTMLSelectElement>('[name="crop-unit"]')!.value = 'mm';
    await pageAction('crop');
    expect(harness.pageAction).toHaveBeenCalledWith(expect.anything(), { kind: 'crop', indices: [0], margins: { top: 0, right: 0, bottom: 0, left: 72 } });
  });
  it('translates engine errors without dropping the original project', async () => {
    harness.pageAction.mockRejectedValueOnce(new PageOperationError('unsupported-structure'));
    click('studio-pages'); await settled();
    const before = structuredClone(harness.project);
    await pageAction('delete');
    expect(harness.project).toEqual(before);
    expect(document.querySelector('.studio-page-manager [role="alert"]')!.textContent).toBe(t('Změna pořadí nebo počtu stránek PDF s formuláři, záložkami nebo přílohami není podporována. Zachovejte původní stránky pro bezpečný export.'));
  });
  it('exports the native active page without trimming the canonical project', async () => {
    click('studio-export');
    const form = document.querySelector<HTMLFormElement>('.studio-export-form')!;
    (form.elements.namedItem('format') as HTMLSelectElement).value = 'png';
    (form.elements.namedItem('pages') as HTMLSelectElement).value = 'current';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settled();
    expect(harness.images).toHaveBeenCalledWith(expect.objectContaining({ pages: [expect.objectContaining({ id: 'second' })] }), expect.objectContaining({ pageIds: ['second'] }));
    expect(harness.project!.pages).toHaveLength(2);
  });
  it('runs PDF mutations through shared transactions while retaining editable graphics', async () => {
    const action = vi.fn(async (bytes: Uint8Array) => {
      const pdf = await PDFDocument.load(bytes); pdf.setTitle('Panel operation'); return pdf.save();
    });
    await api.runPdfOperation('metadata', action); await settled();
    expect(action).toHaveBeenCalledOnce();
    expect(harness.project!.pages[0].objects[0].text).toBe('Keep editable');
    const pdf = await PDFDocument.load(Uint8Array.from(atob(harness.project!.sourcePdf!), c => c.charCodeAt(0)));
    expect(pdf.getTitle()).toBe('Panel operation');
  });
  it('registers document actions in the shared toolbar', async () => {
    const action = vi.fn();
    const button = api.registerDocumentAction('Navigace PDF', action);
    button.click(); await Promise.resolve();
    expect(button.closest('#document-toolbar')).not.toBeNull(); expect(action).toHaveBeenCalledOnce();
  });
  it('rejects graphic overlays before any irreversible purge', async () => {
    const read = await api.readPdfSnapshot();
    await expect(api.applyRedactions([{ pageIndex: 0, rect: [1, 1, 20, 20] }], read.revision, true)).rejects.toThrow();
    expect(prepareRecoveryPurge).not.toHaveBeenCalled();
  });
  it.each(['table', 'chart', 'table-and-chart'] as const)('preserves %s project data without page objects before redaction preparation or purge', async kind => {
    harness.project!.pages.forEach(page => { page.objects = []; });
    if (kind !== 'chart') harness.project!.dataTables = [{ id: 'sales', columns: [{ id: 'month', label: 'Month', type: 'text' }, { id: 'amount', label: 'Amount', type: 'number' }], rows: [['January', 12]] }];
    if (kind !== 'table') harness.project!.dataCharts = [{ id: 'sales-chart', type: 'bar', tableId: 'sales', labelColumnId: 'month', valueColumnIds: ['amount'] }];
    app.discardDocumentForSanitization = vi.fn(async () => {});
    app.isDocumentDiscardedForSanitization = vi.fn(() => true);
    const read = await api.readPdfSnapshot();
    const before = structuredClone(harness.project);
    const undo = document.getElementById('document-undo') as HTMLButtonElement;
    const redo = document.getElementById('document-redo') as HTMLButtonElement;
    const history = [undo.disabled, redo.disabled];
    await expect(api.applyRedactions([{ pageIndex: 0, rect: [1, 1, 20, 20] }], read.revision, true)).rejects.toThrow('Redakce dokumentu s grafickými objekty zatím není podporována.');
    expect(prepareRedaction).not.toHaveBeenCalled();
    expect(prepareRecoveryPurge).not.toHaveBeenCalled();
    expect(clearRecovery).not.toHaveBeenCalled();
    expect(app.discardDocumentForSanitization).not.toHaveBeenCalled();
    expect(harness.destroy).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(harness.project).toEqual(before);
    expect([undo.disabled, redo.disabled]).toEqual(history);
  });
  it('requires explicit confirmation before redaction preparation', async () => {
    const read = await api.readPdfSnapshot();
    await expect(api.applyRedactions([{ pageIndex: 0, rect: [1, 1, 20, 20] }], read.revision, false)).rejects.toThrow();
    expect(prepareRedaction).not.toHaveBeenCalled();
  });
  it('purges the native and canvas owners and prevents undo to the old source', async () => {
    harness.project!.pages.forEach(page => { page.objects = []; });
    app.discardDocumentForSanitization = vi.fn(async () => {});
    app.isDocumentDiscardedForSanitization = vi.fn(() => true);
    const read = await api.readPdfSnapshot();
    await api.applyRedactions([{ pageIndex: 0, rect: [1, 1, 20, 20] }], read.revision, true);
    expect(app.discardDocumentForSanitization).toHaveBeenCalledOnce();
    expect(harness.destroy).toHaveBeenCalledOnce();
    expect((document.getElementById('document-undo') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('document-redo') as HTMLButtonElement).disabled).toBe(true);
    expect(harness.project!.pages.every(page => !page.objects.length)).toBe(true);
  });
  it('quarantines after a storage purge failure without installing or restoring originals', async () => {
    harness.project!.pages.forEach(page => { page.objects = []; });
    app.discardDocumentForSanitization = vi.fn(async () => {});
    app.isDocumentDiscardedForSanitization = vi.fn(() => true);
    vi.mocked(prepareRecoveryPurge).mockResolvedValueOnce(async () => { throw new Error('synthetic storage failure'); });
    const read = await api.readPdfSnapshot();
    await expect(api.applyRedactions([{ pageIndex: 0, rect: [1, 1, 20, 20] }], read.revision, true)).rejects.toMatchObject({ code: 'purge-incomplete' });
    expect(launch).not.toHaveBeenCalled();
    expect(document.body.inert).toBe(true);
    await expect(api.readPdfSnapshot()).rejects.toThrow();
  });
  it('rejects stale panel operations before invoking their preparation callback', async () => {
    const initial = await api.readPdfSnapshot();
    window.dispatchEvent(new Event('editor:document-changed'));
    const prepare = vi.fn(async (bytes: Uint8Array) => bytes);
    await expect(api.runPdfOperation('stale', prepare, initial.revision)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects concurrent panel operations while a save owns the document', async () => {
    let resolve!: (bytes: Uint8Array) => void;
    app.exportSnapshot.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    click('studio-save'); await vi.waitFor(() => expect(app.exportSnapshot).toHaveBeenCalled());
    const prepare = vi.fn(async (bytes: Uint8Array) => bytes);
    await expect(api.runPdfOperation('concurrent', prepare)).rejects.toThrow();
    await expect(api.readPdfSnapshot()).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled(); resolve(snapshot); await settled();
  });
  it('rolls back the canonical project if the protected native rebase refuses to open', async () => {
    const before = structuredClone(harness.project);
    launch.mockResolvedValueOnce(false);
    click('studio-pages'); await settled(); await pageAction('reverse', '1,2');
    expect(harness.project).toEqual(before);
    expect(document.getElementById('graphic-studio')!.hidden).toBe(false);
  });
  it('cancels after PDF preparation while a staged merge is pending without changing the checkpoint', async () => {
    const before = structuredClone(harness.project);
    const merge = harness.merge.getMockImplementation()!;
    let calls = 0, resolve!: (project: StudioProject) => void;
    harness.merge.mockImplementation((project, bytes) => ++calls === 2 ? new Promise(done => { resolve = done; }) : merge(project, bytes));
    const abort = new AbortController();
    const operation = api.runPdfOperation('cancel staged merge', async bytes => bytes, undefined, abort.signal);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    abort.abort(); resolve({ ...structuredClone(before!), name: 'Cancelled result' });
    await rejected;
    expect(harness.project).toEqual(before);
    expect(launch).not.toHaveBeenCalled();
  });
  it('reports a successful atomic commit when cancellation arrives after the canonical swap', async () => {
    const modified = await PDFDocument.load(snapshot); modified.setTitle('Committed before cancellation');
    const bytes = await modified.save();
    let finish!: (value: boolean) => void;
    launch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const abort = new AbortController();
    const operation = api.runPdfOperation('late cancellation', async () => bytes, undefined, abort.signal);
    await vi.waitFor(() => expect(finish).toBeDefined());
    snapshot = bytes;
    abort.abort(); finish(true);
    await expect(operation).resolves.toBeUndefined();
    expect(harness.project!.sourcePdf).toBe(b64(bytes));
  });
});
