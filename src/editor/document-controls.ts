import { setUIText, t } from './i18n';
import { fitZoom, pageDimensions, type FitMode, type PaperSize } from './page-settings';
import { prepareNativeDocument } from './studio/document-bridge';
import type { StudioProject } from './studio/types';

export type DocumentLaunchOptions = { checkpointed?: boolean; protectedSource?: boolean; createdDesign?: StudioProject };

type NativeApp = {
  getZoom(): number;
  setZoom(value: number): void;
  getDocDescription(): { pageSize?: { w: number; h: number } | null; meta?: unknown };
  addBlankPage?: (size: { width: number; height: number }) => Promise<unknown>;
};

export function setupDocumentControls(getApp: () => NativeApp | undefined, launch: (file: File, options?: DocumentLaunchOptions) => Promise<boolean>) {
  const toolbar = document.getElementById('toolbar')!;
  const stage = document.getElementById('stage')!;
  const welcomeActions = document.querySelector('.welcome-actions')!;
  const newWelcome = document.createElement('button');
  setUIText(newWelcome, () => t('Vytvořit PDF'));
  newWelcome.id = 'create-document';
  welcomeActions.append(newWelcome);
  const actions = document.createElement('div');
  actions.className = 'tgroup document-actions';
  actions.innerHTML = '<button type="button" class="btn" id="new-document"><span data-ui-text="Nové PDF">Nové PDF</span></button><button type="button" class="btn" id="add-blank-page"><span data-ui-text="Přidat stránku">Přidat stránku</span></button>';
  toolbar.append(actions);

  document.getElementById('zoomFit')!.hidden = true;
  const fitControls = document.createElement('div');
  fitControls.className = 'fit-controls';
  fitControls.setAttribute('aria-label', t('Přizpůsobení stránky'));
  fitControls.dataset.uiAriaLabel = 'Přizpůsobení stránky';
  fitControls.innerHTML = '<button type="button" class="btn" data-fit="page"><span data-ui-text="Celá stránka">Celá stránka</span></button><button type="button" class="btn" data-fit="width"><span data-ui-text="Přizpůsobit šířce">Přizpůsobit šířce</span></button><button type="button" class="btn" data-fit="height"><span data-ui-text="Přizpůsobit výšce">Přizpůsobit výšce</span></button>';
  document.getElementById('viewbar')!.prepend(fitControls);
  let selectedFit: FitMode | null = null;
  let fitFrame = 0;
  const markFit = () => {
    for (const button of fitControls.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.fit === selectedFit));
  };
  const applyFit = () => {
    if (!selectedFit) return;
    const app = getApp();
    const size = app?.getDocDescription().pageSize;
    if (!app || !size) return;
    const style = getComputedStyle(stage);
    const w = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const stageBounds = stage.getBoundingClientRect();
    const barBounds = document.getElementById('viewbar')!.getBoundingClientRect();
    const barOverlap = barBounds.top < stageBounds.bottom && barBounds.bottom > stageBounds.top
      ? Math.max(0, stageBounds.bottom - barBounds.top) : 0;
    const h = stage.clientHeight - parseFloat(style.paddingTop) - Math.max(parseFloat(style.paddingBottom), barOverlap + 8);
    const zoom = fitZoom(selectedFit, size.w, size.h, w, h);
    if (zoom !== null && Math.abs(zoom - app.getZoom()) > .001) app.setZoom(zoom);
  };
  const scheduleFit = () => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(applyFit); };
  fitControls.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-fit]');
    if (!button) return;
    selectedFit = button.dataset.fit as FitMode;
    markFit();
    applyFit();
  });
  const manualZoom = () => { selectedFit = null; markFit(); };
  for (const id of ['zoomIn', 'zoomOut']) document.getElementById(id)!.addEventListener('click', manualZoom, true);
  stage.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) manualZoom(); }, { capture: true, passive: true });
  new ResizeObserver(scheduleFit).observe(stage);
  new MutationObserver(scheduleFit).observe(document.getElementById('pageLabel')!, { childList: true, characterData: true, subtree: true });
  window.addEventListener('editor:document-opened', () => { selectedFit = 'page'; markFit(); scheduleFit(); });
  markFit();

  const dialog = document.createElement('dialog');
  dialog.className = 'page-dialog';
  dialog.setAttribute('aria-labelledby', 'page-dialog-title');
  dialog.innerHTML = `<form id="page-form">
    <h2 id="page-dialog-title"><span data-ui-text="Vytvořit PDF">Vytvořit PDF</span></h2>
    <label for="paper-size"><span data-ui-text="Velikost papíru">Velikost papíru</span></label>
    <select id="paper-size"><option value="a4" data-ui-text="A4 (210 × 297 mm)">A4 (210 × 297 mm)</option><option value="letter" data-ui-text="Letter (216 × 279 mm)">Letter (216 × 279 mm)</option><option value="custom" data-ui-text="Vlastní rozměry">Vlastní rozměry</option></select>
    <fieldset id="custom-size" hidden><legend><span data-ui-text="Rozměry v milimetrech">Rozměry v milimetrech</span></legend><label for="paper-width"><span data-ui-text="Šířka">Šířka</span></label><input id="paper-width" type="number" min="25" max="2000" step="0.1" value="210" required><label for="paper-height"><span data-ui-text="Výška">Výška</span></label><input id="paper-height" type="number" min="25" max="2000" step="0.1" value="297" required></fieldset>
    <label for="paper-orientation"><span data-ui-text="Orientace">Orientace</span></label><select id="paper-orientation"><option value="portrait" data-ui-text="Na výšku">Na výšku</option><option value="landscape" data-ui-text="Na šířku">Na šířku</option></select>
    <p id="page-dialog-error" role="alert"></p>
    <div class="dialog-actions"><button type="button" id="cancel-page"><span data-ui-text="Zrušit">Zrušit</span></button><button type="submit" id="confirm-page"><span data-ui-text="Vytvořit">Vytvořit</span></button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const size = dialog.querySelector<HTMLSelectElement>('#paper-size')!;
  const custom = dialog.querySelector<HTMLFieldSetElement>('#custom-size')!;
  const error = dialog.querySelector<HTMLElement>('#page-dialog-error')!;
  const submit = dialog.querySelector<HTMLButtonElement>('#confirm-page')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('#cancel-page')!;
  let adding = false;
  let busy = false;
  const syncSize = () => { custom.hidden = size.value !== 'custom'; custom.disabled = custom.hidden; };
  size.addEventListener('change', syncSize);
  syncSize();
  const open = (append: boolean) => {
    adding = append;
    error.textContent = '';
    setUIText(dialog.querySelector('#page-dialog-title')!, () => append ? t('Přidat prázdnou stránku na konec') : t('Vytvořit nové PDF'));
    setUIText(submit, () => append ? t('Přidat stránku') : t('Vytvořit'));
    dialog.showModal();
  };
  newWelcome.addEventListener('click', () => open(false));
  document.getElementById('new-document')!.addEventListener('click', () => open(false));
  document.getElementById('add-blank-page')!.addEventListener('click', () => open(true));
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    submit.disabled = cancel.disabled = true;
    error.textContent = '';
    try {
      const dimensions = pageDimensions(size.value as PaperSize, dialog.querySelector<HTMLSelectElement>('#paper-orientation')!.value === 'landscape', dialog.querySelector<HTMLInputElement>('#paper-width')!.valueAsNumber, dialog.querySelector<HTMLInputElement>('#paper-height')!.valueAsNumber);
      if (adding) {
        const app = getApp();
        if (!app?.addBlankPage) throw new Error(t('Přidávání stránek není dostupné.'));
        const result = await app.addBlankPage(dimensions);
        if (result === false) return;
      } else {
        const prepared = await prepareNativeDocument({ version: 1, name: 'Nový dokument', pages: [{
          id: crypto.randomUUID(), name: 'Strana 1', ...dimensions, background: '#ffffff', objects: [],
        }] });
        const opened = await launch(new File([new Uint8Array(prepared.bytes)], 'novy-dokument.pdf', { type: 'application/pdf' }), { createdDesign: prepared.project });
        if (!opened) { setUIText(error, () => t('Nový dokument nebyl otevřen.')); return; }
      }
      dialog.close();
      selectedFit = 'page';
      markFit();
      scheduleFit();
    } catch (caught) {
      setUIText(error, () => caught instanceof Error ? caught.message : t('Operace se nezdařila.'));
    } finally { busy = false; submit.disabled = cancel.disabled = false; }
  });
}
