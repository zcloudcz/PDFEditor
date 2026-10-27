import { setUIText, t } from '../i18n';
import type { StudioProject } from './types';
import { PageOperationError } from '../pdf/page-operations';
import type { CropMargins } from './page-actions';

export type PageManagerAction = 'delete' | 'duplicate' | 'reverse' | 'move' | 'rotate' | 'extract' | 'crop' | 'merge' | 'split';
export type PageManagerRequest =
  | { kind: 'delete' | 'duplicate' | 'reverse' | 'extract' | 'split'; selection: string }
  | { kind: 'rotate'; selection: string; angle: 90 | -90 | 180 }
  | { kind: 'move'; selection: string; direction: 'up' | 'down' }
  | { kind: 'crop'; selection: string; margins: CropMargins; unit: 'pt' | 'mm' }
  | { kind: 'merge'; files: File[] };

/** Selection UI only; the host owns snapshots, transactions, and downloads. */
export function mountPageManager(
  body: HTMLDivElement,
  project: StudioProject,
  activeIndex: number,
  run: (request: PageManagerRequest) => Promise<void>,
  close: () => void,
): () => void {
  const form = document.createElement('form');
  form.className = 'studio-page-manager';
  const modeLabel = document.createElement('label');
  const modeCaption = document.createElement('span'); setUIText(modeCaption, () => t('Rozsah stránek'));
  const mode = document.createElement('select'); mode.name = 'selectionMode';
  for (const [value, message] of [['range', 'Rozsah stránek'], ['current', 'Aktuální stránka'], ['all', 'Všechny']] as const) {
    const option = document.createElement('option'); option.value = value; setUIText(option, () => t(message)); mode.append(option);
  }
  modeLabel.append(modeCaption, mode);
  const label = document.createElement('label');
  const caption = document.createElement('span');
  setUIText(caption, () => t('Rozsah stránek'));
  const selection = document.createElement('input');
  selection.name = 'pages';
  selection.type = 'text';
  selection.required = true;
  selection.value = String(Math.min(Math.max(0, activeIndex), project.pages.length - 1) + 1);
  selection.placeholder = '1, 3-5';
  selection.dir = 'ltr';
  selection.maxLength = 2000;
  const chosenPages = () => mode.value === 'current' ? String(Math.min(Math.max(0, activeIndex), project.pages.length - 1) + 1)
    : mode.value === 'all' ? `1-${project.pages.length}` : selection.value;
  mode.addEventListener('change', () => { selection.disabled = mode.value !== 'range'; });
  label.append(caption, selection);
  const list = document.createElement('ol');
  for (const page of project.pages) {
    const item = document.createElement('li');
    item.textContent = page.name;
    list.append(item);
  }
  const actions = document.createElement('div');
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  let busy = false;
  let disposed = false;
  const dialog = body.closest('dialog');
  const closeButton = dialog?.querySelector<HTMLButtonElement>(':scope > button');
  const preventBusyClose = (event: Event) => { if (busy) event.preventDefault(); };
  dialog?.addEventListener('cancel', preventBusyClose);
  const execute = (request: PageManagerRequest) => {
    if (busy || disposed || (request.kind !== 'merge' && mode.value === 'range' && !selection.reportValidity())) return;
    busy = true;
    if (closeButton) closeButton.disabled = true;
    error.textContent = '';
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) control.disabled = true;
    let pending: Promise<void>;
    try { pending = run(request); } catch (caught) { pending = Promise.reject(caught); }
    void pending.then(() => { if (!disposed) close(); }).catch(caught => {
      if (!disposed) setUIText(error, () => {
        if (caught instanceof PageOperationError) {
          if (caught.code === 'unsupported-structure') return t('Změna pořadí nebo počtu stránek PDF s formuláři, záložkami nebo přílohami není podporována. Zachovejte původní stránky pro bezpečný export.');
          if (caught.code === 'invalid-selection') return t('Vyberte stránku.');
          if (caught.code === 'invalid-crop') return t('Neplatné okraje ořezu.');
          if (caught.code === 'limit-exceeded') return t('Neplatný nebo příliš velký soubor projektu.');
          return t('Operace se nezdařila.');
        }
        return caught instanceof Error ? caught.message : t('Operace se nezdařila.');
      });
    }).finally(() => {
      busy = false;
      if (closeButton) closeButton.disabled = false;
      if (!disposed) {
        for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) control.disabled = false;
        selection.disabled = mode.value !== 'range';
      }
    });
  };
  const actionButton = (kind: PageManagerAction, message: string, request: () => PageManagerRequest | undefined) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pageAction = kind;
    setUIText(button, () => t(message));
    button.addEventListener('click', () => {
      if (busy || disposed) return;
      const value = request();
      if (value) execute(value);
    });
    return button;
  };
  for (const [angle, label] of [[90, 'Otočit o 90°'], [-90, 'Otočit o −90°'], [180, 'Otočit o 180°']] as const) {
    const button = actionButton('rotate', label, () => ({ kind: 'rotate', selection: chosenPages(), angle }));
    button.dataset.angle = String(angle); actions.append(button);
  }
  for (const [direction, label] of [['up', 'Přesunout stránku nahoru'], ['down', 'Přesunout stránku dolů']] as const) {
    const button = actionButton('move', label, () => ({ kind: 'move', selection: chosenPages(), direction }));
    button.dataset.direction = direction; actions.append(button);
  }
  for (const [kind, message] of [
    ['duplicate', 'Duplikovat'], ['reverse', 'Obrátit pořadí'], ['delete', 'Smazat'],
    ['extract', 'Exportovat vybrané stránky'], ['split', 'Rozdělit do ZIP'],
  ] as const) actions.append(actionButton(kind, message, () => ({ kind, selection: chosenPages() })));

  const crop = document.createElement('fieldset');
  const cropTitle = document.createElement('legend'); setUIText(cropTitle, () => t('Oříznout stránky')); crop.append(cropTitle);
  const marginInputs = new Map<keyof CropMargins, HTMLInputElement>();
  for (const [key, text] of [['top', 'Horní okraj'], ['right', 'Pravý okraj'], ['bottom', 'Dolní okraj'], ['left', 'Levý okraj']] as const) {
    const label = document.createElement('label'); const caption = document.createElement('span'); setUIText(caption, () => t(text));
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '14400'; input.step = 'any'; input.value = '0'; input.required = true; input.name = `crop-${key}`;
    marginInputs.set(key, input); label.append(caption, input); crop.append(label);
  }
  const unitsLabel = document.createElement('label'); const unitsCaption = document.createElement('span'); setUIText(unitsCaption, () => t('Jednotky'));
  const units = document.createElement('select'); units.name = 'crop-unit';
  for (const value of ['pt', 'mm']) { const option = document.createElement('option'); option.value = option.textContent = value; units.append(option); }
  unitsLabel.append(unitsCaption, units); crop.append(unitsLabel);
  const warning = document.createElement('p'); setUIText(warning, () => t('Ořez pouze skryje obsah mimo stránku; neodstraní jej.')); crop.append(warning);
  crop.append(actionButton('crop', 'Oříznout stránky', () => {
    if ([...marginInputs.values()].some(input => !input.reportValidity())) return undefined;
    const margins = { top: 0, right: 0, bottom: 0, left: 0 };
    marginInputs.forEach((input, key) => { margins[key] = Number(input.value); });
    return { kind: 'crop', selection: chosenPages(), margins, unit: units.value === 'mm' ? 'mm' : 'pt' };
  }));

  const merge = document.createElement('fieldset'); const mergeTitle = document.createElement('legend'); setUIText(mergeTitle, () => t('Připojit PDF')); merge.append(mergeTitle);
  const filesLabel = document.createElement('label'); const filesCaption = document.createElement('span'); setUIText(filesCaption, () => t('Vyberte soubory PDF'));
  const files = document.createElement('input'); files.type = 'file'; files.name = 'mergeFiles'; files.accept = '.pdf,application/pdf'; files.multiple = true;
  filesLabel.append(filesCaption, files); merge.append(filesLabel);
  merge.append(actionButton('merge', 'Připojit PDF', () => {
    const selectedFiles = Array.from(files.files ?? []);
    if (!selectedFiles.length) { setUIText(error, () => t('Vyberte soubory PDF')); return undefined; }
    return { kind: 'merge', files: selectedFiles };
  }));
  form.addEventListener('submit', event => event.preventDefault());
  form.append(modeLabel, label, list, actions, crop, merge, error);
  body.append(form);
  return () => { disposed = true; dialog?.removeEventListener('cancel', preventBusyClose); };
}
