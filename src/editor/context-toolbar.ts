import { t } from './i18n';
import './context-toolbar.css';

type SelectionOwner = { clear(): void; isClear(): boolean };
const selectionOwners = new Set<SelectionOwner>();
/** Directly clear every mounted toolbar owner, including detached Range nodes. */
export function clearNativeContextSelection(): void {
  for (const owner of selectionOwners) owner.clear();
  window.getSelection()?.removeAllRanges();
}
export function isNativeContextSelectionClear(): boolean {
  return [...selectionOwners].every(owner => owner.isClear()) && !window.getSelection()?.rangeCount;
}

/** Reuse the native engine's controls, listeners and selection contract. */
export function setupNativeContextToolbar(): () => void {
  const toolbar = document.getElementById('toolbar');
  const inspector = document.getElementById('inspector');
  if (!toolbar || !inspector || document.getElementById('native-text-toolbar')) return () => {};
  const bar = document.createElement('div');
  bar.id = 'native-text-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('Format'));
  bar.dataset.uiAriaLabel = 'Format';
  const anchors: Array<{ element: HTMLElement; marker: Comment }> = [];
  const hiddenHeadings: HTMLElement[] = [];
  const group = (ids: string[], label: string) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'native-text-control-group';
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', t(label));
    wrapper.dataset.uiAriaLabel = label;
    for (const id of ids) {
      const element = document.getElementById(id);
      if (!element) continue;
      const marker = document.createComment(`native-control:${id}`);
      element.before(marker);
      anchors.push({ element, marker });
      wrapper.append(element);
    }
    bar.append(wrapper);
  };
  // Keep container IDs intact: native wireUI/syncInspector iterate their children.
  group(['fFamily', 'fSize'], 'Font');
  group(['fToggles'], 'Style');
  group(['fColor'], 'Color');
  group(['fAlign'], 'Alignment');
  const spacing = document.getElementById('fLine')?.closest('label');
  if (spacing) {
    const marker = document.createComment('native-control:line-spacing');
    spacing.before(marker);
    anchors.push({ element: spacing, marker });
    spacing.classList.add('native-line-spacing');
    bar.append(spacing);
  }
  for (const key of ['Font', 'Alignment', 'Style']) {
    const marker = inspector.querySelector(`[data-ui-text="${key}"]`);
    const heading = marker?.closest('h3');
    if (heading && !heading.hidden) { heading.hidden = true; hiddenHeadings.push(heading); }
  }
  const family = document.getElementById('fFamily');
  if (family) { family.setAttribute('aria-label', t('Font')); family.dataset.uiAriaLabel = 'Font'; }
  toolbar.append(bar);

  let savedRange: Range | undefined;
  let savedEditor: HTMLElement | undefined;
  const selectionOwner: SelectionOwner = {
    clear: () => { savedRange = undefined; savedEditor = undefined; },
    isClear: () => savedRange === undefined && savedEditor === undefined,
  };
  selectionOwners.add(selectionOwner);
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const editor = start?.closest<HTMLElement>('#text-editor-app .editor [contenteditable="true"]');
    if (editor?.contains(range.endContainer)) { savedRange = range.cloneRange(); savedEditor = editor; }
  };
  const restoreSelection = (focus = false) => {
    if (!savedRange || !savedEditor?.isConnected || !savedEditor.contains(savedRange.startContainer) || !savedEditor.contains(savedRange.endContainer)) return;
    if (focus) savedEditor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
  };
  const controls = () => Array.from(bar.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select'));
  const update = () => {
    const disabled = inspector.hidden || inspector.hasAttribute('disabled');
    bar.setAttribute('aria-disabled', String(disabled));
    const all = controls();
    for (const control of all) {
      control.disabled = disabled;
      if (control instanceof HTMLButtonElement && (control.dataset.t || control.dataset.a)) {
        const value = String(control.classList.contains('on'));
        if (control.getAttribute('aria-pressed') !== value) control.setAttribute('aria-pressed', value);
      }
    }
    const buttons = all.filter(control => control instanceof HTMLButtonElement);
    const current = buttons.find(control => control.tabIndex === 0 && !control.disabled) ?? buttons.find(control => !control.disabled);
    all.forEach(control => { control.tabIndex = control.disabled ? -1 : !(control instanceof HTMLButtonElement) || control === current ? 0 : -1; });
  };
  const observer = new MutationObserver(update);
  observer.observe(inspector, { attributes: true, attributeFilter: ['disabled', 'hidden'] });
  observer.observe(bar, { subtree: true, attributes: true, attributeFilter: ['class'] });
  const mouseDown = (event: MouseEvent) => {
    rememberSelection();
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button')) restoreSelection();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); restoreSelection(true); return;
    }
    // Text/number/select controls retain their native arrows and editing shortcuts.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (!(event.target instanceof HTMLButtonElement)) return;
    const all = controls().filter(control => control instanceof HTMLButtonElement && !control.disabled);
    const index = all.indexOf(event.target);
    let target: number | undefined;
    if (event.key === 'ArrowRight') target = (index + 1) % all.length;
    if (event.key === 'ArrowLeft') target = (index + all.length - 1) % all.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = all.length - 1;
    if (target === undefined || !all[target]) return;
    event.preventDefault(); event.stopPropagation();
    all.forEach((control, i) => { control.tabIndex = i === target ? 0 : -1; });
    all[target].focus();
  };
  const shortcut = (event: KeyboardEvent) => {
    if (!event.altKey || event.key !== 'F10' || document.body.dataset.editorMode === 'studio') return;
    if (!(event.target instanceof Element) || !event.target.closest('#text-editor-app .editor')) return;
    rememberSelection();
    const target = controls().find(control => !control.disabled);
    if (target) { event.preventDefault(); event.stopPropagation(); target.focus(); }
  };
  // Change/input listeners execute on the original controls and use native lastSel.
  bar.addEventListener('mousedown', mouseDown, true);
  bar.addEventListener('click', click, true);
  bar.addEventListener('keydown', keyDown);
  document.addEventListener('selectionchange', rememberSelection);
  document.addEventListener('keydown', shortcut, true);
  update();
  return () => {
    selectionOwner.clear(); selectionOwners.delete(selectionOwner);
    observer.disconnect();
    document.removeEventListener('selectionchange', rememberSelection);
    document.removeEventListener('keydown', shortcut, true);
    for (const { element, marker } of anchors) { marker.replaceWith(element); }
    hiddenHeadings.forEach(heading => { heading.hidden = false; });
    bar.remove();
  };
}
