import { designPagePredicate, markSyntheticPages, clearDesignProvenance } from './design-provenance';
import { bindUIMessage, setUIText, t } from '../i18n';
import type { DocumentLaunchOptions } from '../document-controls';
import type { StudioController, StudioProject, StudioPage } from './types';
import { mountStudioCanvas } from './canvas';
import { mountTemplatePicker } from './templates';
import { mountBrandKit } from './brand-kit';
import { exportPdf, exportSvg, exportImages, exportPptx, renderPdfBackground } from './exports';
import { serializeProject, serializePortableProject, parsePortableProject } from './project-io';
import { clearRecovery, readRecoveryState, writeRecovery, cancelRecoveryWrites, prepareRecoveryPurge } from './recovery';
import { commitSanitized } from '../document/sanitized-transaction';
import { prepareRedaction, type RedactionMark } from '../pdf/redaction';
import { prepareOcrReconstruction } from './ocr-reconstruction';
import type { OcrReconstructionProposal } from '../pdf/ocr-reconstruction';
import type { LocalGuide } from './layout-rules';
import { prepareNativeDocument, mergeNativeSnapshot, visibleSize, validateProjectSource } from './document-bridge';
import { mountPageManager } from './page-manager';
import { applyPageAction, exportSelectedPages, parsePageSelection, mergeProjectPdfs, splitProjectPages } from './page-actions';
import { DocumentCoordinator, type DocumentViewState } from '../document/coordinator';
import { readNavigation, editNavigation } from '../pdf/navigation';
import { mountNavigationPanel } from '../pdf/navigation-panel';
import { base64Bytes, bytesBase64 } from './project-io';
import './host.css';
import './templates.css';

type NativeApp = { exportSnapshot(): Promise<Uint8Array | null | undefined>; getCurrentPageIndex(): number;
  getNativeRevision?(): number;
  isRecoveryAllowed?(): boolean;
  createRecoverySnapshot?(): Promise<{revision: number; bytes: Uint8Array} | null>;
  captureStudioSnapshot?(options?: { commit?: boolean }): Promise<{revision: number; bytes: Uint8Array} | null>;
  getPageSurface?(): { container: HTMLElement; pageIndex: number; width: number; height: number; zoom: number } | null;
  releaseSelection?(): void;
  selectStudioPage?(index: number): void | Promise<void>;
  discardDocumentForSanitization?(): Promise<void>;
  isDocumentDiscardedForSanitization?(): boolean;
};
const bytes64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
};

export function setupStudio(getApp: () => NativeApp | undefined, launchPdf: (file: File, options?: DocumentLaunchOptions) => Promise<boolean>) {
  let controller: StudioController | undefined;
  let saveTimer = 0;
  let backgroundEpoch = 0;
  let previewSource: string | undefined;
  let busy = false;
  let quarantined = false;
  let nativeLinked = false;
  let nativeSource: string | undefined;
  let nativeLayout = '';
  let documentRevision = 0;
  let nativeDocumentOpen = false;
  let recoveryAllowed = true;
  let recoveryAbort: AbortController | undefined;
  let coordinator: DocumentCoordinator | undefined;
  let applyingHistory = false;
  let nativeCheckpointProject: StudioProject | undefined;
  let explicitNativeRevision = -1;
  let nativeCheckpointChain: Promise<void> = Promise.resolve();
  const layoutKey = (project: StudioProject) => JSON.stringify(project.pages.map(p => [p.width, p.height, p.background, p.sourcePageIndex]));
  let internalOpen = false;
  let surfaceEpoch = 0;
  let surfaceChain: Promise<void> = Promise.resolve();
  let surfaceFailure: unknown;
  let recoveryChain: Promise<void> = Promise.resolve();
  let graphicPreviewEpoch = 0;
  let requestedGraphicPreviewKey: string | undefined;
  const graphicPreviews = new Map<string, { key: string; url: string }>();
  const previewTasks = new Set<Promise<unknown>>();
  const trackPreview = <T,>(task: Promise<T>): Promise<T> => {
    previewTasks.add(task);
    void task.then(() => previewTasks.delete(task), () => previewTasks.delete(task));
    return task;
  };
  const host = document.createElement('section');
  host.id = 'graphic-studio';
  host.hidden = true;
  host.setAttribute('aria-label', t('Nástroje dokumentu'));
  host.dataset.uiAriaLabel = 'Nástroje dokumentu';
  host.innerHTML = `<header class="studio-header"><strong><span data-ui-text="Nástroje dokumentu">Nástroje dokumentu</span></strong>
    <label><span data-ui-text="Název">Název </span><input id="studio-name" maxlength="120" value="Můj návrh"></label>
    <button type="button" id="document-undo"><span data-ui-text="↶ Zpět">↶ Zpět</span></button><button type="button" id="document-redo"><span data-ui-text="↷ Znovu">↷ Znovu</span></button>
    <button type="button" id="document-navigation"><span data-ui-text="Navigace PDF">Navigace PDF</span></button>
    <button type="button" id="studio-templates"><span data-ui-text="Šablony">Šablony</span></button><button type="button" id="studio-brand"><span data-ui-text="Moje značka">Moje značka</span></button>
    <button type="button" id="studio-pages"><span data-ui-text="Správa stránek">Správa stránek</span></button><button type="button" id="studio-import-pdf"><span data-ui-text="Přidat PDF">Přidat PDF</span></button><button type="button" id="studio-open"><span data-ui-text="Otevřít projekt">Otevřít projekt</span></button>
    <button type="button" id="studio-save"><span data-ui-text="Uložit projekt">Uložit projekt</span></button><button type="button" id="studio-export"><span data-ui-text="Exportovat">Exportovat</span></button>
    </header>
    <div class="studio-storage"><label><input id="studio-autosave" type="checkbox" checked><span data-ui-text="Automatická obnova dokumentu"> Automatická obnova dokumentu</span></label>
    <button type="button" id="studio-recover"><span data-ui-text="Obnovit poslední projekt">Obnovit poslední projekt</span></button><button type="button" id="studio-clear"><span data-ui-text="Smazat lokální kopii">Smazat lokální kopii</span></button>
    <span id="studio-status" role="status" aria-live="polite"><span data-ui-text="Projekt se ukládá pouze na tomto zařízení.">Projekt se ukládá pouze na tomto zařízení.</span></span></div>
    <div id="studio-canvas-host"></div>
    <input id="studio-project-file" type="file" accept=".zpdf,.json,application/json" hidden>
    <input id="studio-pdf-file" type="file" accept=".pdf,application/pdf" hidden>`;
  document.body.append(host);
  const sharedHeader = host.querySelector<HTMLElement>('.studio-header');
  if (!sharedHeader) throw new Error(t('Chybí lišta dokumentu.'));
  sharedHeader.id = 'document-toolbar';
  sharedHeader.hidden = true;
  const toolsMenu = document.createElement('details'); toolsMenu.id = 'document-tools';
  const toolsSummary = document.createElement('summary'); setUIText(toolsSummary, () => t('Nástroje dokumentu'));
  const toolsActions = document.createElement('div'); toolsActions.className = 'document-tool-actions';
  toolsMenu.append(toolsSummary, toolsActions);
  sharedHeader.querySelector('strong')?.replaceWith(toolsMenu);
  for (const id of ['document-navigation', 'studio-templates', 'studio-brand', 'studio-pages', 'studio-import-pdf', 'studio-open']) {
    const action = sharedHeader.querySelector(`#${id}`); if (action) toolsActions.append(action);
  }
  toolsActions.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('button, label.btn')) toolsMenu.open = false;
  });
  document.body.append(sharedHeader);
  new ResizeObserver(() => document.body.style.setProperty('--document-toolbar-height', sharedHeader.hidden ? '0px' : `${sharedHeader.offsetHeight}px`)).observe(sharedHeader);
  const query = <T extends HTMLElement>(selector: string) => {
    const element = host.querySelector<T>(selector) ?? sharedHeader.querySelector<T>(selector);
    if (!element) throw new Error(t('Chybí ovládací prvek studia.'));
    return element;
  };
  const canvasHost = query<HTMLDivElement>('#studio-canvas-host');
  const name = query<HTMLInputElement>('#studio-name');
  const autosave = query<HTMLInputElement>('#studio-autosave');
  const status = query<HTMLSpanElement>('#studio-status');
  const report = (message: string) => { bindUIMessage(status, message); };
  const download = (bytes: Uint8Array | string, mime: string, extension: string) => {
    const blob = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(controller?.getProject().name || 'navrh').replace(/[^\p{L}\p{N} _-]/gu, '_')}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const current = (): StudioProject => {
    if (!controller) throw new Error(t('Nejprve vytvořte návrh.'));
    return controller.getProject();
  };
  const viewState = (): DocumentViewState => controller?.getViewState?.()
    ?? { pageIndex: getApp()?.getCurrentPageIndex() ?? 0, selectedIds: [] };
  const updateHistoryButtons = () => {
    query<HTMLButtonElement>('#document-undo').disabled = busy || !coordinator?.canUndo;
    query<HTMLButtonElement>('#document-redo').disabled = busy || !coordinator?.canRedo;
    controller?.refreshHistory?.();
  };
  const recordCommitted = (project: StudioProject) => {
    if (applyingHistory) return;
    coordinator?.recordExternal({ revision: documentRevision, nativeRevision: nativeLinked && nativeDocumentOpen ? getApp()?.getNativeRevision?.() ?? 0 : 0, project, view: viewState() });
    updateHistoryButtons();
  };
  const nativeHost = document.getElementById('text-editor-app');
  const attachGraphicPreviews = () => {
    const project = controller?.getProject();
    for (const slot of document.querySelectorAll<HTMLElement>('#stage .continuous-page')) {
      const old = slot.querySelector<HTMLImageElement>(':scope > .design-pdf-overlay');
      const page = project?.pages[Number(slot.dataset.pageIndex)];
      const url = page && graphicPreviews.get(page.id)?.url;
      if (!nativeLinked || !url || slot.contains(document.getElementById('pageWrap')) || slot.querySelector('.studio-native-overlay')) {
        old?.remove(); continue;
      }
      const image = old ?? document.createElement('img');
      if (!old) { image.className = 'design-pdf-overlay'; image.alt = ''; image.draggable = false; image.setAttribute('aria-hidden', 'true'); slot.append(image); }
      if (image.getAttribute('src') !== url) image.src = url;
    }
  };
  const clearGraphicPreviews = () => {
    ++graphicPreviewEpoch;
    requestedGraphicPreviewKey = undefined;
    document.querySelectorAll('.design-pdf-overlay').forEach(image => image.remove());
    for (const preview of graphicPreviews.values()) URL.revokeObjectURL(preview.url);
    graphicPreviews.clear();
  };
  const refreshGraphicPreviews = async () => {
    if (!controller) return;
    const project = current();
    const requested = JSON.stringify(project.pages.map(page => [page.id, page.width, page.height, page.objects]));
    if (requested === requestedGraphicPreviewKey) { attachGraphicPreviews(); return; }
    requestedGraphicPreviewKey = requested;
    const epoch = ++graphicPreviewEpoch;
    const pages = new Map(project.pages.filter(page => page.objects.length).map(page => [page.id, page]));
    for (const [id, preview] of graphicPreviews) {
      if (!pages.has(id)) { graphicPreviews.delete(id); URL.revokeObjectURL(preview.url); }
    }
    attachGraphicPreviews();
    const staged = new Map<string, { key: string; url: string }>();
    try {
      for (const [id, page] of pages) {
        const key = JSON.stringify([page.width, page.height, page.objects]);
        if (graphicPreviews.get(id)?.key === key) continue;
        const design: StudioProject = { ...project, sourcePdf: undefined, pages: [{ ...page, sourcePageIndex: undefined, syntheticBackground: undefined, background: 'none' }] };
        const svg = await exportSvg(design, id);
        if (epoch !== graphicPreviewEpoch) return;
        staged.set(id, { key, url: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) });
      }
      if (epoch !== graphicPreviewEpoch) return;
      const previous: string[] = [];
      for (const [id, preview] of staged) {
        const old = graphicPreviews.get(id); if (old) previous.push(old.url);
        graphicPreviews.set(id, preview);
      }
      staged.clear();
      attachGraphicPreviews();
      previous.forEach(url => URL.revokeObjectURL(url));
    } catch {
      if (epoch === graphicPreviewEpoch) { requestedGraphicPreviewKey = undefined; report(t('Náhled PDF se nepodařilo obnovit.')); }
    } finally {
      for (const preview of staged.values()) URL.revokeObjectURL(preview.url);
    }
  };
  new MutationObserver(attachGraphicPreviews).observe(document.getElementById('stage')!, { childList: true, subtree: true });
  const attachSurface = (surface = getApp()?.getPageSurface?.()) => {
    if (!nativeLinked || !controller || !surface || !nativeHost) return;
    const workspace = canvasHost.querySelector<HTMLElement>('.studio-workspace');
    if (!workspace) return;
    if (nativeHost.parentElement !== workspace) workspace.append(nativeHost);
    nativeHost.hidden = false;
    canvasHost.classList.add('studio-native-surface');
    controller.attachNativeSurface?.(surface);
    attachGraphicPreviews();
  };
  const detachSurface = () => {
    controller?.detachNativeSurface?.();
    canvasHost.classList.remove('studio-native-surface');
    if (nativeHost) {
      nativeHost.hidden = true;
      // Keep the native DOM alive when the canvas controller is replaced.
      document.body.append(nativeHost);
    }
  };
  const adoptNative = (project: StudioProject) => {
    if (!controller) return;
    if (layoutKey(project) !== layoutKey(current())) {
      const view = controller.getViewState?.();
      const wasApplying = applyingHistory; applyingHistory = true;
      try { controller.setProject(project, { recordHistory: true }); if (view) controller.restoreViewState?.(view); }
      finally { applyingHistory = wasApplying; }
      attachSurface();
    } else if (project.sourcePdf) controller.updateNativeSource?.(project.sourcePdf);
    void trackPreview(refreshGraphicPreviews());
  };
  const restoreUnifiedView = async (view: DocumentViewState) => {
    const project = current();
    const byId = view.pageId ? project.pages.findIndex(page => page.id === view.pageId) : -1;
    const index = byId >= 0 ? byId : Math.max(0, Math.min(view.pageIndex ?? 0, project.pages.length - 1));
    if (nativeLinked) { await getApp()?.selectStudioPage?.(index); attachSurface(); }
    controller?.restoreViewState?.({ ...view, pageId: project.pages[index].id });
  };
  const persist = () => {
    window.clearTimeout(saveTimer);
    recoveryAbort?.abort();
    if (!recoveryAllowed) { report(t('Automatická obnova vypnutá; dřívější kopii lze smazat.')); return; }
    if (!autosave.checked || (!controller && !nativeDocumentOpen)) return;
    const abort = new AbortController(); recoveryAbort = abort;
    const revision = documentRevision;
    saveTimer = window.setTimeout(() => {
      recoveryChain = recoveryChain.catch(() => {}).then(async () => {
        if (abort.signal.aborted || !autosave.checked) return;
        let project = controller?.getProject();
        let nativeRevision = 0;
        if (nativeLinked && nativeDocumentOpen) {
          const app = getApp();
          const snapshot = await app?.createRecoverySnapshot?.();
          if (!snapshot) {
            if (!abort.signal.aborted) report(t('Rozepsané změny ještě nejsou uloženy pro obnovu. Dokončete úpravu textu nebo uložte projekt.'));
            return;
          }
          nativeRevision = snapshot.revision;
          project = project && nativeLinked ? await mergeNativeSnapshot(project, snapshot.bytes) : await fromPdf(snapshot.bytes);
          if (app !== getApp() || app.getNativeRevision?.() !== nativeRevision) return;
        }
        if (!project || abort.signal.aborted || revision !== documentRevision) return;
        await writeRecovery(serializeProject(project), revision, nativeRevision, abort.signal, viewState());
        if (!abort.signal.aborted && revision === documentRevision) report(t('Obnova práce uložena v tomto prohlížeči.'));
      });
      void recoveryChain.catch(() => { if (!abort.signal.aborted) report(t('Obnova se neuložila. Stáhněte projekt tlačítkem Uložit projekt.')); });
    }, 700);
  };
  const backgrounds = async () => {
    const epoch = ++backgroundEpoch;
    const project = current();
    previewSource = project.sourcePdf;
    for (const page of project.pages) {
      if (page.sourcePageIndex === undefined) continue;
      const data = await renderPdfBackground(project, page.id);
      if (epoch !== backgroundEpoch) return;
      if (data) controller?.setPageBackground(page.id, data);
    }
  };
  const showProject = (project: StudioProject, save = true, recordHistory = false) => {
    if (!recordHistory && !applyingHistory) { recoveryAllowed = true; resetCoordinator(); clearGraphicPreviews(); }
    ++documentRevision;
    host.hidden = false;
    sharedHeader.hidden = false;
    document.body.classList.add('unified-document');
    const matchingNative = nativeDocumentOpen && project.sourcePdf === nativeSource && layoutKey(project) === nativeLayout;
    if (!matchingNative) { nativeLinked = false; detachSurface(); }
    document.body.dataset.editorMode = 'unified';
    name.value = project.name;
    if (controller) controller.setProject(project, { recordHistory });
    else controller = mountStudioCanvas(canvasHost, project, (next, committed = true) => {
      ++documentRevision; name.value = next.name; persist();
      if (applyingHistory) return;
      if (committed) {
        void trackPreview(refreshGraphicPreviews());
        if (nativeLinked) checkpointNative();
        else recordCommitted(next);
      }
      if (nativeLinked && layoutKey(next) !== nativeLayout) void queueNativeSurface();
      if (next.sourcePdf !== previewSource) void trackPreview(backgrounds()).catch(() => report(t('Náhled PDF se nepodařilo obnovit.')));
    }, {
      undo: () => void navigateHistory('undo'), redo: () => void navigateHistory('redo'),
      canUndo: () => coordinator?.canUndo ?? false, canRedo: () => coordinator?.canRedo ?? false,
      structuralChange: prepare => { void guarded(async () => {
        await settleNative();
        let targetPage: string | undefined;
        await coordinator!.transact('pages', async before => {
          const next = prepare(before.project); targetPage = next.pageId; return next.project;
        });
        if (targetPage) {
          const index = current().pages.findIndex(page => page.id === targetPage);
          if (index >= 0) await getApp()?.selectStudioPage?.(index);
          controller?.restoreViewState?.({ pageId: targetPage, selectedIds: [] });
        }
      }); },
    });
    if (!applyingHistory) recordCommitted(project);
    void trackPreview(refreshGraphicPreviews());
    if (matchingNative) { nativeLinked = true; attachSurface(); }
    else void queueNativeSurface();
    if (save) persist();
    void trackPreview(backgrounds()).catch(() => report(t('Náhled původního PDF se nepodařilo vykreslit. Projekt zůstává zachovaný.')));
  };
  const guarded = async (action: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    canvasHost.inert = true;
    const nativeHost = document.getElementById('text-editor-app');
    if (nativeHost) nativeHost.inert = true;
    for (const button of sharedHeader.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true;
    document.querySelectorAll<HTMLButtonElement>('.studio-dialog > button').forEach(button => { button.disabled = true; });
    try { await surfaceChain; await action(); }
    catch (error) { report(error instanceof Error && !('code' in error) ? error.message : t('Operace se nezdařila.')); }
    finally {
      busy = quarantined;
      canvasHost.inert = quarantined;
      if (nativeHost) nativeHost.inert = quarantined;
      for (const button of sharedHeader.querySelectorAll<HTMLButtonElement>('button')) button.disabled = quarantined;
      document.querySelectorAll<HTMLButtonElement>('.studio-dialog > button').forEach(button => { button.disabled = quarantined; });
      updateHistoryButtons();
    }
  };
  const replaceAllowed = () => !controller || window.confirm(t('Nahradit aktuální grafický návrh? Pro zachování samostatné kopie nejprve použijte Uložit projekt.'));
  const modal = (title: string, mount: (body: HTMLDivElement, close: () => void) => (() => void) | void) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'studio-dialog';
    const heading = document.createElement('h2'); heading.textContent = title;
    const closeButton = document.createElement('button'); setUIText(closeButton, () => t('Zavřít')); closeButton.type = 'button';
    const body = document.createElement('div');
    dialog.append(heading, closeButton, body);
    document.body.append(dialog);
    const close = () => dialog.close();
    const cleanup = mount(body, close);
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('paste', event => event.stopPropagation());
    dialog.addEventListener('drop', event => event.stopPropagation());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    closeButton.addEventListener('click', () => { if (!busy) close(); });
    dialog.addEventListener('close', () => { if (cleanup) cleanup(); dialog.remove(); }, { once: true });
    dialog.showModal();
  };
  const templates = () => modal(t('Vyberte šablonu'), (body, close) => mountTemplatePicker(body, project => {
    if (!replaceAllowed()) return;
    showProject(project); close();
  }));
  const fromPdf = async (bytes: Uint8Array): Promise<StudioProject> => {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    return { version: 1, name: 'Grafika z PDF', sourcePdf: bytes64(bytes), pages: pdf.getPages().map((page, sourcePageIndex): StudioPage => {
      return { id: crypto.randomUUID(), name: `Strana ${sourcePageIndex + 1}`, ...visibleSize(page), background: '#ffffff', sourcePageIndex, objects: [] };
    }) };
  };
  const welcome = document.querySelector('.welcome-actions');
  const templateEntry = document.createElement('button'); setUIText(templateEntry, () => t('Začít ze šablony')); templateEntry.addEventListener('click', templates); welcome?.append(templateEntry);
  const syncNative = async () => {
    const bytes = await getApp()?.exportSnapshot();
    if (!bytes) throw new Error(t('Převzetí změn PDF bylo zrušeno.'));
    const base = nativeLinked && controller ? current() : nativeCheckpointProject;
    const project = base ? await mergeNativeSnapshot(base, bytes) : await fromPdf(bytes);
    nativeCheckpointProject = project; explicitNativeRevision = documentRevision;
    adoptNative(project);
    nativeSource = project.sourcePdf; nativeLayout = layoutKey(project);
    return project;
  };
  const captureNative = async (commit = true): Promise<StudioProject> => {
    const app = getApp();
    const snapshot = app?.captureStudioSnapshot ? await app.captureStudioSnapshot({ commit }) : await app?.createRecoverySnapshot?.();
    if (!snapshot) throw new Error(t('Rozepsané změny ještě nejsou uloženy pro obnovu. Dokončete úpravu textu nebo uložte projekt.'));
    const base = nativeLinked && controller ? current() : nativeCheckpointProject;
    const project = base ? await mergeNativeSnapshot(base, snapshot.bytes) : await fromPdf(snapshot.bytes);
    if (app !== getApp() || app.getNativeRevision?.() !== snapshot.revision) throw new Error(t('Operace se nezdařila.'));
    return project;
  };
  const resetCoordinator = () => {
    coordinator?.dispose(); nativeCheckpointProject = undefined; explicitNativeRevision = -1;
    coordinator = new DocumentCoordinator({
      getRevision: () => documentRevision,
      getNativeRevision: () => nativeLinked && nativeDocumentOpen ? getApp()?.getNativeRevision?.() ?? 0 : 0,
      captureView: viewState,
      captureProject: async () => nativeLinked && nativeDocumentOpen
        ? explicitNativeRevision === documentRevision && nativeCheckpointProject ? structuredClone(nativeCheckpointProject) : captureNative()
        : current(),
      commitProject: async (project, expected, signal, view) => {
        if (signal.aborted || expected !== documentRevision) return false;
        const previous = current(), previousView = viewState();
        applyingHistory = true;
        try {
          showProject(project, true, true);
          nativeCheckpointProject = project;
          if (view) controller?.restoreViewState?.(view);
          await surfaceChain;
          if (surfaceFailure) {
            showProject(previous, true, true);
            await restoreUnifiedView(previousView);
            return false;
          }
          if (view) await restoreUnifiedView(view);
        } finally { applyingHistory = false; }
        return { project: current(), view: viewState() };
      },
    });
    updateHistoryButtons();
  };
  const checkpointNative = () => {
    const revision = documentRevision, owner = coordinator;
    nativeCheckpointChain = nativeCheckpointChain.catch(() => {}).then(async () => {
      if (revision !== documentRevision || owner !== coordinator || !nativeLinked) return;
      const project = await captureNative(false);
      if (revision !== documentRevision || owner !== coordinator || !nativeLinked) return;
      nativeCheckpointProject = project;
      adoptNative(project);
      nativeSource = project.sourcePdf; nativeLayout = layoutKey(project);
      recordCommitted(project);
    }).catch(() => {});
  };
  const settleNative = async () => {
    await nativeCheckpointChain;
    if (nativeLinked && nativeDocumentOpen) {
      const project = await captureNative();
      nativeCheckpointProject = project; explicitNativeRevision = documentRevision;
      adoptNative(project); nativeSource = project.sourcePdf; nativeLayout = layoutKey(project);
      recordCommitted(project);
    }
  };
  const navigateHistory = (direction: 'undo' | 'redo') => guarded(async () => {
    await settleNative();
    await coordinator?.[direction]();
    updateHistoryButtons();
  });
  resetCoordinator();
  // Reuse the existing protected document and find controls in the shared strip.
  for (const element of [document.querySelector('#toolbar label[for="file"]'), document.querySelector('#toolbar .document-actions'), document.getElementById('find')]) {
    if (element) toolsActions.append(element);
  }
  query('#document-undo').addEventListener('click', () => void navigateHistory('undo'));
  query('#document-redo').addEventListener('click', () => void navigateHistory('redo'));
  // A source/layout change rebases the protected engine; selecting an object never does.
  const queueNativeSurface = (): Promise<void> => {
    const epoch = ++surfaceEpoch;
    surfaceFailure = undefined;
    host.dataset.surfacePending = 'true';
    surfaceChain = surfaceChain.catch(() => {}).then(async () => {
      if (epoch !== surfaceEpoch || !controller) return;
      const project = current();
      if (nativeDocumentOpen && project.sourcePdf === nativeSource && layoutKey(project) === nativeLayout) {
        nativeLinked = true; attachSurface(); return;
      }
      const prepared = await prepareNativeDocument(project);
      if (epoch !== surfaceEpoch) return;
      internalOpen = true;
      let opened: boolean;
      try { opened = await launchPdf(new File([new Uint8Array(prepared.bytes)], 'dokument.pdf', { type: 'application/pdf' }), { checkpointed: true, protectedSource: !recoveryAllowed }); }
      finally { internalOpen = false; }
      if (!opened) throw new Error(t('Náhled PDF se nepodařilo obnovit.'));
      if (epoch !== surfaceEpoch) return;
      const app = getApp();
      const snapshot = app?.captureStudioSnapshot
        ? await app.captureStudioSnapshot({ commit: false }) : await app?.createRecoverySnapshot?.();
      if (epoch !== surfaceEpoch) return;
      if (!snapshot || app !== getApp() || app.getNativeRevision?.() !== snapshot.revision)
        throw new Error(t('Náhled PDF se nepodařilo obnovit.'));
      const view = controller.getViewState?.();
      const latest = current();
      if (layoutKey(latest) !== layoutKey(project)) { void queueNativeSurface(); return; }
      const linked = { ...latest, sourcePdf: bytes64(snapshot.bytes),
        pages: latest.pages.map((page, index) => ({ ...page, sourcePageIndex: prepared.project.pages[index].sourcePageIndex })) };
      const isDesign = designPagePredicate(prepared.project);
      await markSyntheticPages(linked, prepared.project.pages.flatMap((page, index) => isDesign(page) ? [index] : []));
      if (epoch !== surfaceEpoch || !controller) return;
      const final = current();
      if (layoutKey(final) !== layoutKey(latest)) { void queueNativeSurface(); return; }
      linked.name = final.name;
      linked.pages = final.pages.map((page, index) => ({ ...page, width: linked.pages[index].width, height: linked.pages[index].height, sourcePageIndex: linked.pages[index].sourcePageIndex, syntheticBackground: linked.pages[index].syntheticBackground }));
      applyingHistory = true;
      try {
        controller.setProject(linked, { recordHistory: true });
        if (view) controller.restoreViewState?.(view);
      } finally { applyingHistory = false; }
      nativeSource = linked.sourcePdf; nativeLayout = layoutKey(linked);
      nativeCheckpointProject = linked;
      nativeDocumentOpen = true; nativeLinked = true;
      attachSurface();
      if (view) {
        const index = Math.max(0, linked.pages.findIndex(page => page.id === view.pageId));
        await getApp()?.selectStudioPage?.(index);
        attachSurface();
        controller.restoreViewState?.(view);
      }
      updateHistoryButtons(); persist();
    }).catch(error => { surfaceFailure = error; report(t('Náhled PDF se nepodařilo obnovit.')); }).finally(() => {
      if (epoch === surfaceEpoch) delete host.dataset.surfacePending;
    });
    return surfaceChain;
  };
  const openPageManager = (): void => void guarded(async () => {
    const usingNative = !controller || (nativeLinked && nativeDocumentOpen);
    await settleNative();
    const project = usingNative ? nativeCheckpointProject! : current();
    const managerRevision = documentRevision;
    const activeIndex = usingNative ? getApp()?.getCurrentPageIndex() ?? 0 : Math.max(0, project.pages.findIndex(page => page.id === controller?.getActivePageId()));
    modal(t('Správa stránek'), (body, close) => mountPageManager(body, project, activeIndex, async request => {
      let failure: unknown;
      await guarded(async () => {
        try {
          let next: StudioProject | undefined;
          if (request.kind === 'merge') {
            if (request.files.some(file => file.size > 50 * 1024 * 1024) || request.files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error(t('PDF je příliš velké (limit 50 MB).'));
            const inputs: Uint8Array[] = [];
            for (const file of request.files) inputs.push(new Uint8Array(await file.arrayBuffer()));
            next = await mergeProjectPdfs(project, inputs);
          } else {
            const indices = parsePageSelection(request.selection, project.pages.length);
            if (request.kind === 'extract') download(await exportSelectedPages(project, indices), 'application/pdf', 'pdf');
            else if (request.kind === 'split') download(await splitProjectPages(project, indices), 'application/zip', 'zip');
            else if (request.kind === 'crop') {
              const factor = request.unit === 'mm' ? 72 / 25.4 : 1;
              const { top, right, bottom, left } = request.margins;
              next = await applyPageAction(project, { kind: 'crop', indices, margins: { top: top * factor, right: right * factor, bottom: bottom * factor, left: left * factor } });
            } else if (request.kind === 'rotate') next = await applyPageAction(project, { kind: 'rotate', indices, angle: request.angle });
            else if (request.kind === 'move') next = await applyPageAction(project, { kind: 'move', indices, direction: request.direction });
            else next = await applyPageAction(project, { kind: request.kind, indices });
          }
          if (next) {
            if (managerRevision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
            const prepared = next;
            await coordinator!.transact(request.kind, async () => prepared);
          }
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
    }, close));
  });
  const openNavigation = (): void => void guarded(async () => {
    await settleNative();
    const project = nativeLinked && nativeDocumentOpen ? nativeCheckpointProject! : current();
    const prepared = project.sourcePdf && project.pages.every((page, index) => page.sourcePageIndex === index)
      ? { bytes: base64Bytes(project.sourcePdf), project: structuredClone(project) }
      : await prepareNativeDocument(project);
    let bytes = prepared.bytes;
    let revision = documentRevision;
    const pageIndex = nativeLinked ? getApp()?.getCurrentPageIndex() ?? 0 : Math.max(0, project.pages.findIndex(page => page.id === controller?.getActivePageId()));
    const navigation = await readNavigation(bytes);
    modal(t('Navigace PDF'), body => mountNavigationPanel(body, navigation, project.pages.length, pageIndex, async change => {
      let failure: unknown, result = navigation;
      await guarded(async () => {
        try {
          if (revision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          const changed = await editNavigation(bytes, change);
          result = await readNavigation(changed);
          await coordinator!.transact(change.kind, async () => ({ ...structuredClone(prepared.project), sourcePdf: bytesBase64(changed) }));
          bytes = changed; revision = documentRevision;
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
      return result;
    }));
  });
  query('#document-navigation').addEventListener('click', openNavigation);
  query('#studio-pages').addEventListener('click', openPageManager);
  name.addEventListener('change', () => void guarded(async () => {
    const title = name.value.trim() || t('Můj návrh');
    await settleNative();
    await coordinator!.transact('rename', async before => ({ ...before.project, name: title }));
  }));
  query('#studio-templates').addEventListener('click', templates);
  query('#studio-brand').addEventListener('click', () => modal(t('Moje značka'), body => mountBrandKit(body)));
  query('#studio-save').addEventListener('click', () => void guarded(async () => {
    const project = nativeLinked && nativeDocumentOpen ? await syncNative() : current();
    recordCommitted(project);
    download(await serializePortableProject(project), 'application/json', 'zpdf'); report(t('Editovatelný projekt připraven ke stažení.'));
  }));
  const projectInput = query<HTMLInputElement>('#studio-project-file');
  query('#studio-open').addEventListener('click', () => projectInput.click());
  projectInput.addEventListener('change', () => void guarded(async () => {
    const file = projectInput.files?.[0]; projectInput.value = '';
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) throw new Error(t('Projekt je příliš velký (limit 100 MB).'));
    const project = await parsePortableProject(await file.text());
    await validateProjectSource(project);
    if (replaceAllowed()) showProject(project);
  }));
  const pdfInput = query<HTMLInputElement>('#studio-pdf-file');
  query('#studio-import-pdf').addEventListener('click', () => pdfInput.click());
  pdfInput.addEventListener('change', () => void guarded(async () => {
    const file = pdfInput.files?.[0]; pdfInput.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) throw new Error(t('PDF je příliš velké (limit 50 MB).'));
    await settleNative();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await coordinator!.transact('merge', before => mergeProjectPdfs(before.project, [bytes]));
    report(t('Stránky PDF přidány na konec dokumentu.'));
  }));
  query('#studio-recover').addEventListener('click', () => void guarded(async () => {
    window.clearTimeout(saveTimer);
    await recoveryChain.catch(() => {});
    const saved = await readRecoveryState();
    if (!saved) { report(t('Žádný uložený projekt k obnovení.')); return; }
    const project = await parsePortableProject(saved.serialized);
    await validateProjectSource(project);
    if (replaceAllowed()) {
      showProject(project);
      await surfaceChain;
      if (saved.view) await restoreUnifiedView(saved.view);
    }
  }));
  query('#studio-clear').addEventListener('click', () => void guarded(async () => {
    if (!window.confirm(t('Smazat lokální kopii pro obnovu? Otevřený návrh zůstane zachovaný.'))) return;
    autosave.checked = false;
    recoveryAbort?.abort(); cancelRecoveryWrites();
    window.clearTimeout(saveTimer);
    await clearRecovery(); report(t('Lokální kopie smazána. Automatická obnova je vypnutá.'));
  }));
  autosave.addEventListener('change', () => { if (autosave.checked) persist(); else { recoveryAbort?.abort(); cancelRecoveryWrites(); window.clearTimeout(saveTimer); report(t('Automatická obnova vypnutá; dřívější kopii lze smazat.')); } });
  query('#studio-export').addEventListener('click', () => modal(t('Export dokumentu'), (body, close) => {
    body.innerHTML = `<form class="studio-export-form"><label><span data-ui-text="Formát">Formát</span><select name="format"><option value="pdf" data-ui-text="PDF — text a vektory">PDF — text a vektory</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="svg" data-ui-text="SVG — grafické stránky bez původního PDF">SVG — grafické stránky bez původního PDF</option><option value="pptx" data-ui-text="PowerPoint PPTX">PowerPoint PPTX</option></select></label>
      <label><span data-ui-text="Stránky">Stránky</span><select name="pages"><option value="all" data-ui-text="Všechny">Všechny</option><option value="current" data-ui-text="Aktuální stránka">Aktuální stránka</option></select></label>
      <label><span data-ui-text="Měřítko obrázků">Měřítko obrázků</span><select name="scale"><option value="1" data-ui-text="1× (72 DPI)">1× (72 DPI)</option><option value="2" selected data-ui-text="2× (144 DPI)">2× (144 DPI)</option><option value="4.1667" data-ui-text="300 DPI">300 DPI</option></select></label>
      <label><span data-ui-text="Kvalita JPEG / WebP">Kvalita JPEG / WebP</span><input name="quality" type="number" min="0.1" max="1" step="0.1" value="0.9"></label>
      <p><span data-ui-text="Více obrázků se stáhne jako ZIP. SVG exportuje jednu grafickou stránku. PPTX zachová podporované texty a tvary; původní PDF a složité prvky vloží jako obrázky. PowerPoint používá jednotnou velikost snímků. Pro plnou editovatelnost uchovejte také projekt.">Více obrázků se stáhne jako ZIP. SVG exportuje jednu grafickou stránku. PPTX zachová podporované texty a tvary; původní PDF a složité prvky vloží jako obrázky. PowerPoint používá jednotnou velikost snímků. Pro plnou editovatelnost uchovejte také projekt.</span></p>
      <button type="submit"><span data-ui-text="Exportovat návrh">Exportovat návrh</span></button><p role="alert"></p></form>`;
    const form = body.querySelector('form');
    if (!form) return;
    form.addEventListener('submit', event => { event.preventDefault(); void guarded(async () => {
      const submit = form.querySelector('button'); const error = form.querySelector('[role="alert"]');
      if (submit) submit.disabled = true;
      try {
        const data = new FormData(form);
        const format = data.get('format');
        const snapshot = nativeLinked && nativeDocumentOpen ? await syncNative() : current();
        recordCommitted(snapshot);
        const project = structuredClone(snapshot);
        const pageId = nativeLinked && nativeDocumentOpen ? project.pages[getApp()?.getCurrentPageIndex() ?? 0]?.id : controller?.getActivePageId();
        if (data.get('pages') === 'current') project.pages = project.pages.filter(p => p.id === pageId);
        report(t('Připravuji export…'));
        if (format === 'pdf') {
          const bytes = await exportPdf(project);
          download(bytes, 'application/pdf', 'pdf');
        } else if (format === 'svg') {
          if (!pageId) throw new Error(t('Vyberte stránku.'));
          download(await exportSvg(project, pageId), 'image/svg+xml', 'svg');
        } else if (format === 'pptx') download(await exportPptx(project), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx');
        else if (format === 'png' || format === 'jpeg' || format === 'webp') {
          const result = await exportImages(project, { format, scale: Number(data.get('scale')), quality: Number(data.get('quality')), pageIds: project.pages.map(p => p.id) });
          download(result.bytes, result.mime, result.extension);
        }
        report(t('Export připraven ke stažení.')); close();
      } catch (caught) { if (error) setUIText(error, () => caught instanceof Error ? caught.message : t('Export se nezdařil.')); }
      finally { if (submit) submit.disabled = false; }
    }); });
  }));
  for (const surface of [host, sharedHeader]) for (const type of ['keydown', 'keyup', 'paste', 'copy', 'cut', 'drop']) surface.addEventListener(type, event => {
    const target = event.target;
    if (target instanceof Element && target.closest('#text-editor-app') && !target.closest('.studio-native-overlay')) return;
    event.stopPropagation();
    if (event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); query<HTMLButtonElement>('#studio-save').click();
    }
  });
  window.addEventListener('keydown', event => {
    if (nativeLinked && nativeDocumentOpen && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      const target = event.target as HTMLElement;
      const direction = event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo';
      if (!target.closest('input, textarea, [contenteditable="true"]') && (direction === 'undo' ? coordinator?.canUndo : coordinator?.canRedo)) {
        event.preventDefault(); event.stopImmediatePropagation();
        void navigateHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
        return;
      }
    }
    if (!nativeDocumentOpen || !nativeLinked || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault(); event.stopImmediatePropagation(); query<HTMLButtonElement>('#studio-save').click();
  }, true);
  document.getElementById('save')?.addEventListener('click', event => {
    if (!nativeLinked || !controller) return;
    event.preventDefault(); event.stopImmediatePropagation(); query<HTMLButtonElement>('#studio-export').click();
  }, true);
  window.addEventListener('click', event => {
    if (!nativeLinked || !nativeDocumentOpen || busy) return;
    const button = (event.target as Element).closest('#undo, #redo');
    if (!button || !(button.id === 'undo' ? coordinator?.canUndo : coordinator?.canRedo)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void navigateHistory(button.id === 'undo' ? 'undo' : 'redo');
  }, true);
  window.addEventListener('editor:before-document-open', event => {
    if (busy && !internalOpen) { event.preventDefault(); return; }
    if (internalOpen || !controller) return;
    if (!window.confirm(t('Otevřít jiný dokument a nahradit aktuální návrh včetně grafických prvků? Pro zachování editovatelné kopie nejprve uložte projekt.'))) event.preventDefault();
  });
  window.addEventListener('editor:document-opened', event => {
    if (internalOpen) return;
    const epoch = ++surfaceEpoch; ++documentRevision; nativeDocumentOpen = true; recoveryAbort?.abort();
    const createdDesign = (event as CustomEvent<{ createdDesign?: StudioProject }>).detail?.createdDesign;
    nativeLinked = false; clearGraphicPreviews(); detachSurface(); controller?.destroy(); controller = undefined;
    nativeSource = undefined; nativeLayout = '';
    sharedHeader.hidden = false; document.body.classList.add('unified-document'); document.body.dataset.editorMode = 'unified';
    resetCoordinator(); recoveryAllowed = getApp()?.isRecoveryAllowed?.() ?? true;
    window.clearTimeout(saveTimer);
    void guarded(async () => {
      const app = getApp();
      const snapshot = app?.captureStudioSnapshot ? await app.captureStudioSnapshot() : await app?.createRecoverySnapshot?.();
      if (!snapshot || app !== getApp()) throw new Error(t('Náhled PDF se nepodařilo obnovit.'));
      const project = createdDesign ? structuredClone(createdDesign) : await fromPdf(snapshot.bytes);
      if (createdDesign) {
        const isDesign = designPagePredicate(createdDesign);
        project.sourcePdf = bytes64(snapshot.bytes);
        await markSyntheticPages(project, createdDesign.pages.flatMap((page, index) => isDesign(page) ? [index] : []));
        await validateProjectSource(project);
      }
      if (epoch !== surfaceEpoch || app !== getApp() || app.getNativeRevision?.() !== snapshot.revision) return;
      nativeSource = project.sourcePdf; nativeLayout = layoutKey(project);
      nativeCheckpointProject = project;
      applyingHistory = true;
      try { showProject(project, false, true); }
      finally { applyingHistory = false; }
      nativeLinked = true; attachSurface(); recordCommitted(project); persist();
    });
  });
  window.addEventListener('editor:page-rendered', event => {
    attachSurface((event as CustomEvent<ReturnType<NonNullable<NativeApp['getPageSurface']>>>).detail);
  });
  window.addEventListener('pointerdown', event => {
    if (!nativeLinked || busy || !(event.target instanceof Element)) return;
    if (!event.target.closest('#document-toolbar, .studio-library, .studio-properties, .studio-text-toolbar, .studio-storage')) return;
    try { getApp()?.releaseSelection?.(); }
    catch {
      event.preventDefault(); event.stopImmediatePropagation();
      report(t('Operace se nezdařila.'));
    }
  }, true);
  window.addEventListener('editor:graphic-selected', event => {
    try { getApp()?.releaseSelection?.(); }
    catch { event.preventDefault(); report(t('Operace se nezdařila.')); return; }
    canvasHost.dataset.selection = 'graphic';
  });
  window.addEventListener('editor:native-selected', () => {
    controller?.clearSelection?.();
    canvasHost.dataset.selection = 'native';
  });
  window.addEventListener('editor:graphic-page-selected', event => {
    const index = (event as CustomEvent<{pageIndex: number}>).detail.pageIndex;
    if (nativeLinked && Number.isSafeInteger(index)) void getApp()?.selectStudioPage?.(index);
  });
  window.addEventListener('editor:document-changed', () => {
    ++documentRevision;
    if (!internalOpen && nativeLinked && nativeDocumentOpen) { clearDesignProvenance(); persist(); checkpointNative(); }
  });
  // Recovery is offered before creating a fresh project, so entering the studio cannot overwrite it.
  const recoverEntry = document.createElement('button'); setUIText(recoverEntry, () => t('Obnovit dokument'));
  recoverEntry.addEventListener('click', () => void guarded(async () => {
    const saved = await readRecoveryState();
    if (!saved) { window.alert(t('V tomto prohlížeči není uložený projekt.')); return; }
    const project = await parsePortableProject(saved.serialized);
    await validateProjectSource(project);
    if (replaceAllowed()) {
      showProject(project);
      await surfaceChain;
      if (saved.view) await restoreUnifiedView(saved.view);
    }
  }));
  welcome?.append(recoverEntry);
  return {
    readProjectSnapshot: async () => {
      if (busy || quarantined) throw new Error(t('Operace se nezdařila.'));
      let result: { project: StudioProject; revision: number; view: ReturnType<typeof viewState> } | undefined;
      let failure: unknown;
      await guarded(async () => {
        try {
          await surfaceChain;
          await settleNative();
          result = { project: structuredClone(current()), revision: documentRevision, view: viewState() };
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
      if (!result) throw new Error(t('Operace se nezdařila.'));
      return result;
    },
    runProjectOperation: async (label: string, prepare: (project: StudioProject, signal: AbortSignal) => Promise<StudioProject>, expectedRevision?: number, externalSignal?: AbortSignal): Promise<void> => {
      externalSignal?.throwIfAborted();
      if (busy || quarantined) throw new Error(t('Operace se nezdařila.'));
      let failure: unknown;
      await guarded(async () => {
        try {
          if (expectedRevision !== undefined && expectedRevision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          await surfaceChain;
          await settleNative();
          externalSignal?.throwIfAborted();
          if (expectedRevision !== undefined && expectedRevision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          await coordinator!.transact(label, (before, signal) => prepare(before.project, signal), externalSignal);
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
    },
    setLayoutGuides: (pageId: string, guides: readonly LocalGuide[]) => {
      if (busy || quarantined) throw new Error(t('Operace se nezdařila.'));
      controller?.setGuides?.(pageId, guides);
    },
    getLayoutGuides: (pageId: string): readonly LocalGuide[] => {
      if (busy || quarantined) throw new Error(t('Operace se nezdařila.'));
      return controller?.getGuides?.(pageId) ?? [];
    },
    applyRedactions: async (marks: readonly RedactionMark[], expectedRevision: number, confirmed: boolean, externalSignal?: AbortSignal): Promise<void> => {
      if (busy || !confirmed) throw new Error(t('Operace se nezdařila.'));
      const signal = externalSignal ?? new AbortController().signal;
      signal.throwIfAborted();
      let failure: unknown;
      await guarded(async () => {
        try {
          if (documentRevision !== expectedRevision) throw new Error('Redaction preview is stale');
          await settleNative();
          const before = await coordinator!.capture(signal);
          if (before.revision !== expectedRevision) throw new Error('Redaction preview is stale');
          // This profile cannot preserve or sanitize editable overlays or project
          // datasets/chart specifications, even when no chart was placed on a page.
          if (before.project.pages.some(page => page.objects.length) || before.project.dataTables?.length || before.project.dataCharts?.length) throw new Error('Redakce dokumentu s grafickými objekty zatím není podporována.');
          const app = getApp();
          if (!app?.discardDocumentForSanitization || !app.isDocumentDiscardedForSanitization || !controller?.purgeForSanitization) throw new Error('Document purge unavailable');
          const prepared = await prepareNativeDocument(before.project);
          const redacted = await prepareRedaction(prepared.bytes, marks, undefined, signal);
          const candidate = await fromPdf(redacted.bytes);
          candidate.name = 'Vyčištěný dokument';
          await validateProjectSource(candidate);
          // Drain saves before observing storage; this revocation is reversible
          // and does not delete any data if later scope checks reject the request.
          window.clearTimeout(saveTimer); recoveryAbort?.abort(); cancelRecoveryWrites();
          await recoveryChain.catch(() => {});
          const purge = await prepareRecoveryPurge(before.project.pages.map(page => page.id));
          signal.throwIfAborted();
          await commitSanitized({
            assertCurrent: () => {
              if (documentRevision !== expectedRevision || app !== getApp() || before.nativeRevision !== (app.getNativeRevision?.() ?? 0)) throw new Error('Redaction preview is stale');
            },
            revokeRecovery: async () => {
              recoveryAllowed = false; autosave.checked = false;
              window.clearTimeout(saveTimer); recoveryAbort?.abort(); cancelRecoveryWrites();
              await recoveryChain.catch(() => {});
            },
            purgeRecovery: purge,
            discardCurrent: async () => {
              ++surfaceEpoch; ++backgroundEpoch; ++documentRevision;
              clearGraphicPreviews(); previewSource = undefined;
              await Promise.allSettled([...previewTasks]);
              coordinator?.dispose(); coordinator?.forgetHistory(); coordinator = undefined;
              nativeCheckpointProject = undefined; explicitNativeRevision = -1;
              nativeSource = undefined; nativeLayout = ''; nativeLinked = false; nativeDocumentOpen = false;
              clearDesignProvenance();
              detachSurface(); await controller!.purgeForSanitization!(); controller = undefined;
              canvasHost.replaceChildren();
              await app.discardDocumentForSanitization!();
              if (!app.isDocumentDiscardedForSanitization!()) throw new Error('Native purge incomplete');
            },
            install: async () => {
              internalOpen = true;
              try {
                if (!await launchPdf(new File([new Uint8Array(redacted.bytes)], 'sanitized.pdf', { type: 'application/pdf' }), { checkpointed: true })) throw new Error('Sanitized candidate could not open');
              } finally { internalOpen = false; }
              const canonical = await app.captureStudioSnapshot?.({ commit: false });
              if (!canonical || app !== getApp() || canonical.revision !== app.getNativeRevision?.()) throw new Error('Sanitized native snapshot unavailable');
              clearDesignProvenance();
              candidate.sourcePdf = bytes64(canonical.bytes);
              await validateProjectSource(candidate);
              nativeDocumentOpen = true;
              nativeSource = candidate.sourcePdf; nativeLayout = layoutKey(candidate);
              resetCoordinator(); applyingHistory = true;
              try { showProject(candidate, false); } finally { applyingHistory = false; }
              nativeLinked = true; nativeCheckpointProject = candidate; explicitNativeRevision = documentRevision;
              coordinator!.forgetHistory();
              recordCommitted(candidate);
            },
            verify: async () => {
              if (!controller || current().sourcePdf !== candidate.sourcePdf || current().pages.some(page => page.objects.length) || coordinator?.canUndo || coordinator?.canRedo || graphicPreviews.size) throw new Error('Sanitized state verification failed');
            },
            quarantine: async () => {
              quarantined = true; recoveryAllowed = false; autosave.checked = false;
              window.clearTimeout(saveTimer); recoveryAbort?.abort(); cancelRecoveryWrites();
              coordinator?.forgetHistory();
              document.body.inert = true;
              report('Odstranění starých kopií není dokončeno. Editor je uzamčen; výsledek nelze potvrdit jako vyčištěný.');
            },
          }, signal);
          report('Obsah byl odstraněn a uložená historie aktuálního dokumentu vymazána.');
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
    },
    applyOcrReconstruction: async (proposal: OcrReconstructionProposal, signal?: AbortSignal): Promise<void> => {
      signal?.throwIfAborted();
      if (busy) throw new Error(t('Operace se nezdařila.'));
      let failure: unknown;
      await guarded(async () => {
        try {
          if (proposal.revision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          await surfaceChain;
          await settleNative();
          signal?.throwIfAborted();
          if (proposal.revision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          await coordinator!.transact('OCR', (before, active) => prepareOcrReconstruction(before.project, proposal, active), signal);
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
    },
    getPageSurface: () => getApp()?.getPageSurface?.() ?? null,
    readPdfSnapshot: async (): Promise<{ bytes: Uint8Array; revision: number }> => {
      if (busy) throw new Error(t('Operace se nezdařila.'));
      let result: { bytes: Uint8Array; revision: number } | undefined;
      let failure: unknown;
      await guarded(async () => {
        try {
          await settleNative();
          const prepared = await prepareNativeDocument(nativeLinked && nativeDocumentOpen ? nativeCheckpointProject! : current());
          result = { bytes: new Uint8Array(prepared.bytes), revision: documentRevision };
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
      if (!result) throw new Error(t('Operace se nezdařila.'));
      return result;
    },
    runPdfOperation: async (label: string, prepare: (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>, expectedRevision?: number, externalSignal?: AbortSignal): Promise<void> => {
      externalSignal?.throwIfAborted();
      if (busy) throw new Error(t('Operace se nezdařila.'));
      let failure: unknown;
      await guarded(async () => {
        try {
          if (expectedRevision !== undefined && expectedRevision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          await surfaceChain;
          await settleNative();
          externalSignal?.throwIfAborted();
          if (expectedRevision !== undefined && expectedRevision !== documentRevision) throw new Error(t('Operace se nezdařila.'));
          await coordinator!.transact(label, async (before, signal) => {
            const prepared = await prepareNativeDocument(before.project);
            signal.throwIfAborted();
            const bytes = await prepare(prepared.bytes, signal);
            signal.throwIfAborted();
            const merged = await mergeNativeSnapshot(prepared.project, bytes);
            if (merged.pages.length !== before.project.pages.length) throw new Error(t('Operace se nezdařila.'));
            return merged;
          }, externalSignal);
        } catch (error) { failure = error; }
      });
      if (failure) throw failure;
    },
    mountDocumentPanel: (title: string, mount: (body: HTMLElement, close: () => void) => void | (() => void)): void => modal(title, mount),
    registerDocumentAction: (label: string, action: () => void | Promise<void>): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button'; setUIText(button, () => t(label));
      button.addEventListener('click', () => { void Promise.resolve(action()).catch(() => report(t('Operace se nezdařila.'))); });
      toolsActions.append(button);
      return button;
    },
  };
}
