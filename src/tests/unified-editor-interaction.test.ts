import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { setupStudio } from '../editor/studio/host';
import { setupDocumentControls, type DocumentLaunchOptions } from '../editor/document-controls';
import { capturePersonalTemplate } from '../editor/studio/personal-templates';
import { resizeDesign } from '../editor/studio/layout-rules';
import { parsePortableProject, serializePortableProject } from '../editor/studio/project-io';
import { exportSvg } from '../editor/studio/exports';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const hostStyles = readFileSync('src/editor/studio/host.css', 'utf8');

vi.mock('../editor/studio/exports', async importOriginal => ({
  ...await importOriginal<typeof import('../editor/studio/exports')>(),
  renderPdfBackground: vi.fn(async () => null),
  exportSvg: vi.fn(async (project) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${project.pages[0].objects[0]?.text ?? 'shape'}</text></svg>`),
}));
vi.mock('../editor/studio/project-io', async importOriginal => {
  const original = await importOriginal<typeof import('../editor/studio/project-io')>();
  return { ...original, serializePortableProject: vi.fn(original.serializePortableProject) };
});
vi.mock('../editor/studio/recovery', () => ({
  readRecoveryState: vi.fn(async () => undefined), writeRecovery: vi.fn(),
  clearRecovery: vi.fn(), cancelRecoveryWrites: vi.fn(),
}));

let cleanup: Array<() => void>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportSvg).mockImplementation(async project => `<svg xmlns="http://www.w3.org/2000/svg"><text>${project.pages[0].objects[0]?.text ?? 'shape'}</text></svg>`);
  cleanup = [];
  for (const surface of [window, document]) {
    const add = surface.addEventListener.bind(surface);
    vi.spyOn(surface, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      cleanup.push(() => surface.removeEventListener(type, listener, options));
      add(type, listener, options);
    });
  }
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let urlIndex = 0;
  URL.createObjectURL = vi.fn(() => `blob:test-${++urlIndex}`); URL.revokeObjectURL = vi.fn();
  document.body.innerHTML = '<div class="welcome-actions"></div><div id="text-editor-app"><div id="toolbar"></div><div id="stage"><div id="pageWrap"><canvas id="page"></canvas><div id="overlay"></div></div></div><button id="save"></button></div>';
});
afterEach(() => {
  cleanup.forEach(remove => remove());
  document.body.replaceChildren(); delete document.body.dataset.editorMode;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mount() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 200]).drawText('Original native PDF text', { x: 20, y: 150, size: 14, font });
  pdf.addPage([300, 200]);
  let bytes = await pdf.save(); let revision = 1; let pageIndex = 0;
  const originalCanvas = document.getElementById('page');
  const slotFor = (index: number): HTMLElement => {
    const old = document.querySelector<HTMLElement>(`.continuous-page[data-page-index="${index}"]`);
    if (old) return old;
    const slot = document.createElement('section'); slot.className = 'continuous-page'; slot.dataset.pageIndex = String(index);
    document.getElementById('stage')!.append(slot); return slot;
  };
  slotFor(0).append(document.getElementById('pageWrap')!); slotFor(1);
  const app = {
    exportSnapshot: vi.fn(async () => bytes),
    getCurrentPageIndex: () => pageIndex,
    getNativeRevision: () => revision,
    isRecoveryAllowed: vi.fn(() => true),
    captureStudioSnapshot: vi.fn(async (options?: { commit?: boolean }) => { if (options?.commit !== false) app.releaseSelection(); return { bytes, revision }; }),
    createRecoverySnapshot: vi.fn(async () => ({ bytes, revision })),
    getPageSurface: () => ({ container: document.getElementById('pageWrap')!, pageIndex, width: 300, height: 200, zoom: 1 }),
    releaseSelection: vi.fn(),
    selectStudioPage: vi.fn((index: number) => {
      pageIndex = index; slotFor(index).append(document.getElementById('pageWrap')!);
      window.dispatchEvent(new CustomEvent('editor:page-rendered', { detail: app.getPageSurface() }));
    }),
  };
  const launch = vi.fn(async (file: File, options?: DocumentLaunchOptions) => {
    bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject; reader.readAsArrayBuffer(file);
    });
    // Model a native save which rewrites bytes while retaining the generated background.
    bytes = await (await PDFDocument.load(bytes)).save({ useObjectStreams: false });
    pageIndex = 0; ++revision; slotFor(0).append(document.getElementById('pageWrap')!);
    window.dispatchEvent(new CustomEvent('editor:page-rendered', { detail: app.getPageSurface() }));
    window.dispatchEvent(new CustomEvent('editor:document-opened', { detail: { createdDesign: options?.createdDesign } }));
    return true;
  });
  const api = setupStudio(() => app, launch);
  const autosave = document.getElementById('studio-autosave') as HTMLInputElement;
  autosave.checked = false; autosave.dispatchEvent(new Event('change'));
  window.dispatchEvent(new Event('editor:document-opened'));
  await vi.waitFor(() => expect(document.querySelector('#pageWrap .studio-native-overlay')).not.toBeNull());
  return { api, app, launch, originalCanvas, draftFirstNative: async () => {
    const updated = await PDFDocument.load(bytes); updated.getPage(0).drawText('Native draft retained', { x: 20, y: 100, size: 14 });
    const draft = await updated.save();
    app.releaseSelection.mockImplementationOnce(() => { bytes = draft; ++revision; window.dispatchEvent(new Event('editor:document-changed')); });
  }, draftNative: async () => {
    const updated = await PDFDocument.load(bytes); updated.setTitle('Native draft before structure');
    updated.getPage(1).drawText('Native draft before structure', { x: 20, y: 150, size: 14 });
    const draft = await updated.save();
    app.releaseSelection.mockImplementationOnce(() => {
      bytes = draft; ++revision; window.dispatchEvent(new Event('editor:document-changed'));
    });
  }, editNative: async () => {
    const updated = await PDFDocument.load(bytes); updated.setTitle('Native content checkpoint');
    bytes = await updated.save(); ++revision;
    window.dispatchEvent(new Event('editor:document-changed'));
  } };
}

describe('actual host and canvas interaction', () => {
  it('hands a newly created A4 design from document controls through launch and canonical native capture', async () => {
    const { api, app, launch, editNative } = await mount();
    document.body.insertAdjacentHTML('beforeend', '<div id="viewbar"></div><button id="zoomFit"></button><button id="zoomIn"></button><button id="zoomOut"></button><span id="pageLabel"></span>');
    const controlsApp = { ...app, getZoom: () => 1, setZoom: vi.fn(), getDocDescription: () => ({}) };
    setupDocumentControls(() => controlsApp, launch);
    const dialog = document.querySelector<HTMLDialogElement>('.page-dialog')!;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    document.getElementById('create-document')!.click();
    document.getElementById('page-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('.page-dialog')!.open).toBe(false));
    const { exportSvg: actualSvg } = await vi.importActual<typeof import('../editor/studio/exports')>('../editor/studio/exports');
    let project = (await api.readProjectSnapshot()).project;
    const id = project.pages[0].id;
    expect(await actualSvg(project, id)).toContain('#ffffff');
    expect(capturePersonalTemplate(project, [id], { name: 'A4', tags: [], license: 'Own', source: 'Own' }).pages[0].sourcePageIndex).toBeUndefined();
    expect(resizeDesign(project, id, { width: 400, height: 500 }, []).pages[0].width).toBe(400);
    await editNative();
    project = (await api.readProjectSnapshot()).project;
    await expect(actualSvg(project, id)).rejects.toThrow();
    expect(() => capturePersonalTemplate(project, [id], { name: 'A4', tags: [], license: 'Own', source: 'Own' })).toThrow();
    expect(() => resizeDesign(project, id, { width: 400, height: 500 }, [])).toThrow();
  });
  it('edits graphic text over the retained native canvas, checkpoints native content, then saves both layers', async () => {
    const { app, launch, originalCanvas, editNative } = await mount();
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    document.querySelector('#pageWrap [data-object]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = document.querySelector<HTMLElement>('#pageWrap .studio-inline-text')!;
    expect(editor).not.toBeNull();
    editor.textContent = 'Editable graphic text'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    window.dispatchEvent(new Event('editor:native-selected'));
    expect(document.querySelector('.studio-inline-text')).toBeNull();
    await editNative();
    await vi.waitFor(() => expect(app.captureStudioSnapshot).toHaveBeenCalled());
    document.getElementById('studio-save')!.click();
    await vi.waitFor(() => expect(serializePortableProject).toHaveBeenCalled());
    const portable = await vi.mocked(serializePortableProject).mock.results.at(-1)!.value;
    const reopened = await parsePortableProject(portable);
    expect(reopened.pages[0].objects[0].text).toBe('Editable graphic text');
    const native = await PDFDocument.load(Uint8Array.from(atob(reopened.sourcePdf!), char => char.charCodeAt(0)));
    expect(native.getTitle()).toBe('Native content checkpoint');
    expect(document.getElementById('page')).toBe(originalCanvas);
    expect(document.querySelectorAll('#pageWrap .studio-native-overlay')).toHaveLength(1);
    expect(launch).not.toHaveBeenCalled();
    expect(document.getElementById('studio-close')).toBeNull();
  });
  it('keeps native text draft ownership when committing it for graphic selection fails', async () => {
    const { app } = await mount();
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    app.releaseSelection.mockImplementation(() => { throw new Error('Protected edit refused'); });
    const request = new Event('editor:graphic-selected', { cancelable: true });
    window.dispatchEvent(request);
    expect(request.defaultPrevented).toBe(true);
    expect(document.getElementById('page')).not.toBeNull();
  });
  it('flushes the current native draft before a sidebar duplicate and preserves active page through undo', async () => {
    const { app, launch, draftNative } = await mount();
    app.selectStudioPage(1);
    await draftNative();
    const copy = [...document.querySelectorAll<HTMLButtonElement>('.studio-library button')].find(button => button.textContent === 'Kopie stránky')!;
    copy.click();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(app.getCurrentPageIndex()).toBe(2));
    expect(document.querySelectorAll('.studio-page-row')).toHaveLength(3);
    document.getElementById('studio-save')!.click();
    await vi.waitFor(() => expect(serializePortableProject).toHaveBeenCalled());
    const portable = await vi.mocked(serializePortableProject).mock.results.at(-1)!.value;
    const reopened = await parsePortableProject(portable);
    const native = await PDFDocument.load(Uint8Array.from(atob(reopened.sourcePdf!), char => char.charCodeAt(0)));
    const independent = await getDocument({ data: Uint8Array.from(atob(reopened.sourcePdf!), char => char.charCodeAt(0)), useSystemFonts: false }).promise;
    try {
      for (const pageNumber of [2, 3]) {
        const text = await (await independent.getPage(pageNumber)).getTextContent();
        expect(text.items.map(item => 'str' in item ? item.str : '').join('')).toContain('Native draft before structure');
      }
    } finally { await independent.destroy(); }
    expect(native.getTitle()).toBe('Native draft before structure');
    document.getElementById('document-undo')!.click();
    await vi.waitFor(() => expect(document.querySelectorAll('.studio-page-row')).toHaveLength(2));
    await vi.waitFor(() => expect(app.getCurrentPageIndex()).toBe(1));
  });
  it('preserves password protection lineage through an internal sidebar rebase', async () => {
    const { app, launch } = await mount();
    app.isRecoveryAllowed.mockReturnValue(false);
    window.dispatchEvent(new Event('editor:document-opened'));
    await vi.waitFor(() => expect((document.getElementById('studio-save') as HTMLButtonElement).disabled).toBe(false));
    const add = [...document.querySelectorAll<HTMLButtonElement>('.studio-library button')].find(button => button.textContent === '+ Stránka')!;
    add.click();
    await vi.waitFor(() => expect(launch).toHaveBeenCalled());
    expect(launch.mock.calls.at(-1)![1]).toEqual({ checkpointed: true, protectedSource: true });
  });
  it('restores the matching native page for graphic-only undo without rebasing the PDF', async () => {
    const { app, launch } = await mount();
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    await vi.waitFor(() => expect((document.getElementById('document-undo') as HTMLButtonElement).disabled).toBe(false));
    app.selectStudioPage(1);
    document.querySelectorAll<HTMLButtonElement>('.studio-inserts button')[2].click();
    await new Promise(done => setTimeout(done, 30));
    document.getElementById('document-undo')!.click();
    await vi.waitFor(() => expect(app.getCurrentPageIndex()).toBe(0));
    expect(document.querySelector('#pageWrap .studio-native-overlay text')?.textContent).toBe('Your text');
    expect(launch).not.toHaveBeenCalled();
  });
  it('shows graphics on both continuous pages and paints the active graphic layer only once', async () => {
    const { app, launch } = await mount();
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    await vi.waitFor(() => expect(exportSvg).toHaveBeenCalled());
    app.selectStudioPage(1);
    await vi.waitFor(() => expect(document.querySelector('.continuous-page[data-page-index="0"] > .design-pdf-overlay')).not.toBeNull());
    document.querySelectorAll<HTMLButtonElement>('.studio-inserts button')[2].click();
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    const firstPreview = document.querySelector('.continuous-page[data-page-index="0"] > .design-pdf-overlay');
    expect(document.querySelector('.continuous-page[data-page-index="1"] > .design-pdf-overlay')).toBeNull();
    expect(document.querySelectorAll('#pageWrap .studio-native-overlay')).toHaveLength(1);
    document.querySelector('#pageWrap [data-object]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    app.selectStudioPage(0);
    await vi.waitFor(() => expect(document.querySelector('.continuous-page[data-page-index="1"] > .design-pdf-overlay')).not.toBeNull());
    expect(firstPreview!.isConnected).toBe(false);
    expect(document.querySelector('.continuous-page[data-page-index="0"] > .design-pdf-overlay')).toBeNull();
    expect(document.querySelectorAll('#pageWrap .studio-native-overlay')).toHaveLength(1);
    const exported = vi.mocked(exportSvg).mock.calls;
    expect(exported.every(([project]) => !project.sourcePdf && project.pages[0].background === 'none')).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  });
  it('retains valid inactive previews during pending and refused replacement without disturbing the active caret', async () => {
    const { app } = await mount();
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    app.selectStudioPage(1);
    const original = document.querySelector<HTMLImageElement>('.continuous-page[data-page-index="0"] > .design-pdf-overlay')!;
    const originalUrl = original.src;
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    document.querySelector('#pageWrap [data-object]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const caret = document.querySelector('.studio-inline-text');
    await Promise.resolve();
    expect(original.src).toBe(originalUrl); expect(document.querySelector('.studio-inline-text')).toBe(caret);
    app.selectStudioPage(0);
    await new Promise(done => setTimeout(done, 30));
    let finish!: (svg: string) => void;
    vi.mocked(exportSvg).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    document.querySelectorAll<HTMLButtonElement>('.studio-inserts button')[2].click();
    await vi.waitFor(() => expect(finish).toBeDefined());
    app.selectStudioPage(1);
    const previous = document.querySelector<HTMLImageElement>('.continuous-page[data-page-index="0"] > .design-pdf-overlay')!;
    expect(previous.src).toBe(originalUrl);
    finish('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await vi.waitFor(() => expect(previous.src).not.toBe(originalUrl));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(originalUrl);
    const validUrl = previous.src;
    app.selectStudioPage(0);
    vi.mocked(exportSvg).mockRejectedValue(new Error('Preview refused'));
    document.querySelectorAll<HTMLButtonElement>('.studio-inserts button')[2].click();
    await new Promise(done => setTimeout(done, 30));
    app.selectStudioPage(1);
    expect(document.querySelector<HTMLImageElement>('.continuous-page[data-page-index="0"] > .design-pdf-overlay')!.src).toBe(validUrl);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(validUrl);
  });
  it('opens graphic text context from the layer list without changing document content and refuses unsafe handoff', async () => {
    const { app } = await mount();
    const style = document.createElement('style'); style.textContent = hostStyles; document.body.append(style);
    document.querySelector<HTMLButtonElement>('.studio-inserts button')!.click();
    window.dispatchEvent(new Event('editor:native-selected'));
    const canvas = document.getElementById('studio-canvas-host')!;
    delete canvas.dataset.selection;
    const layer = document.querySelector<HTMLButtonElement>('.studio-layer button')!;
    app.releaseSelection.mockClear();
    layer.click();
    const toolbar = document.querySelector<HTMLElement>('.studio-text-toolbar')!;
    expect(app.releaseSelection).toHaveBeenCalled();
    expect(canvas.dataset.selection).toBe('graphic');
    expect(toolbar.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(getComputedStyle(toolbar).display).not.toBe('none');
    expect(document.querySelector<HTMLTextAreaElement>('.studio-properties textarea')?.value).toBe('Your text');
    expect(app.exportSnapshot).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('editor:native-selected'));
    app.releaseSelection.mockImplementation(() => { throw new Error('Native draft refused'); });
    document.querySelector<HTMLButtonElement>('.studio-layer button')!.click();
    expect(canvas.dataset.selection).toBe('native');
    expect(document.querySelector('.studio-layer.is-selected')).toBeNull();
    expect(toolbar.querySelectorAll('button')).toHaveLength(0);
  });
});


it('keeps design operations after real host/canvas native rebase and refuses them after native draft text', async () => {
  const { api, draftFirstNative } = await mount();
  await api.runProjectOperation('design', async () => ({ version: 1, name: 'Design', pages: [{ id: 'design', name: 'Design', width: 300, height: 200, background: '#abcdef', objects: [] }] }));
  const { exportSvg: actualSvg } = await vi.importActual<typeof import('../editor/studio/exports')>('../editor/studio/exports');
  const { capturePersonalTemplate } = await import('../editor/studio/personal-templates');
  const { resizeDesign } = await import('../editor/studio/layout-rules');
  const details = { name: 'Template', tags: [] as string[], license: 'Own', source: 'Own' };
  const snapshot = await api.readProjectSnapshot();
  expect(snapshot.project.pages[0].sourcePageIndex).toBe(0);
  expect(await actualSvg(snapshot.project, 'design')).toContain('#abcdef');
  expect(capturePersonalTemplate(snapshot.project, ['design'], details).pages[0].sourcePageIndex).toBeUndefined();
  await api.runProjectOperation('resize', async project => resizeDesign(project, 'design', { width: 400, height: 250 }, []));
  const resized = await api.readProjectSnapshot();
  expect(resized.project.pages[0].id).toBe('design');
  expect((await PDFDocument.load(Uint8Array.from(atob(resized.project.sourcePdf!), c => c.charCodeAt(0)))).getPage(0).getWidth()).toBe(400);
  await draftFirstNative();
  const edited = await api.readProjectSnapshot();
  await expect(actualSvg(edited.project, 'design')).rejects.toThrow();
  expect(() => capturePersonalTemplate(edited.project, ['design'], details)).toThrow();
  expect(() => resizeDesign(edited.project, 'design', { width: 500, height: 300 }, [])).toThrow();
  const task = getDocument({ data: Uint8Array.from(atob(edited.project.sourcePdf!), c => c.charCodeAt(0)), isEvalSupported: false });
  try { await expect((await (await task.promise).getPage(1)).getTextContent().then(c => c.items.map(i => 'str' in i ? i.str : '').join(''))).resolves.toContain('Native draft retained'); }
  finally { await task.destroy(); }
});
