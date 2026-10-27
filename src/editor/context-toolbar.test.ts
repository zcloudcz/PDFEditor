import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupNativeContextToolbar, clearNativeContextSelection, isNativeContextSelectionClear } from './context-toolbar';

let cleanup: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML = `<section id="text-editor-app"><div id="toolbar"></div>
    <div class="editor"><div contenteditable="true">One two three</div></div>
    <aside id="inspector"><h3><span data-ui-text="Font">Font</span></h3>
      <div><select id="fFamily"><option>Helvetica</option></select><input id="fSize" type="number"></div>
      <div id="fToggles"><button data-t="bold">B</button><button data-t="italic">I</button><button data-t="underline">U</button></div>
      <input id="fColor" type="color"><div id="fAlign"><button data-a="0">Left</button><button data-a="1">Center</button></div>
      <label><span>Line Spacing</span><input id="fLine" type="number"></label>
    </aside></section>`;
});
afterEach(() => { cleanup?.(); cleanup = undefined; delete document.body.dataset.editorMode; });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('native contextual text toolbar', () => {
  it('purges cached detached editor and Range references before reporting clear', () => {
    cleanup = setupNativeContextToolbar();
    const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
    const range = document.createRange(); range.selectNodeContents(editor);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    expect(isNativeContextSelectionClear()).toBe(false);
    editor.remove();
    const connected = vi.fn(() => false);
    Object.defineProperty(editor, 'isConnected', { configurable: true, get: connected });
    clearNativeContextSelection();
    expect(isNativeContextSelectionClear()).toBe(true);
    expect(window.getSelection()!.rangeCount).toBe(0);
    document.querySelector<HTMLButtonElement>('[data-t="bold"]')!.click();
    expect(connected).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('selectionchange'));
    expect(isNativeContextSelectionClear()).toBe(true);
  });
  it('moves original controls into native toolbar and retains their handlers and IDs', () => {
    const original = document.getElementById('fSize');
    const handler = vi.fn(); original?.addEventListener('change', handler);
    cleanup = setupNativeContextToolbar();
    expect(document.querySelector('#toolbar #fSize')).toBe(original);
    original?.dispatchEvent(new Event('change'));
    expect(handler).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#fSize')).toHaveLength(1);
    expect(document.querySelectorAll('#native-text-toolbar #fToggles button')).toHaveLength(3);
    expect(document.querySelector('#inspector #fSize')).toBeNull();
  });

  it('mirrors native selection availability and pressed states', async () => {
    cleanup = setupNativeContextToolbar();
    const inspector = document.getElementById('inspector');
    const bold = document.querySelector<HTMLButtonElement>('[data-t="bold"]');
    inspector?.setAttribute('disabled', '');
    await settle();
    expect(bold?.disabled).toBe(true);
    inspector?.removeAttribute('disabled'); bold?.classList.add('on');
    await settle();
    expect(bold?.disabled).toBe(false);
    expect(bold?.getAttribute('aria-pressed')).toBe('true');
  });

  it('restores a text range before original click listeners run', () => {
    cleanup = setupNativeContextToolbar();
    const editor = document.querySelector<HTMLElement>('[contenteditable]');
    const node = editor?.firstChild;
    if (!node) throw new Error('Missing test text');
    const range = document.createRange(); range.setStart(node, 4); range.setEnd(node, 7);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const bold = document.querySelector<HTMLButtonElement>('[data-t="bold"]');
    const handler = vi.fn(() => expect(window.getSelection()?.toString()).toBe('two'));
    bold?.addEventListener('click', handler);
    window.getSelection()?.removeAllRanges(); bold?.focus(); bold?.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('prevents button mousedown stealing caret but leaves editable controls usable', () => {
    cleanup = setupNativeContextToolbar();
    const buttonEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.querySelector('[data-t="bold"]')?.dispatchEvent(buttonEvent);
    expect(buttonEvent.defaultPrevented).toBe(true);
    const inputEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.getElementById('fSize')?.dispatchEvent(inputEvent);
    expect(inputEvent.defaultPrevented).toBe(false);
  });

  it('navigates buttons with arrows while numeric inputs retain native editing', () => {
    cleanup = setupNativeContextToolbar();
    const bold = document.querySelector<HTMLButtonElement>('[data-t="bold"]');
    bold?.focus(); bold?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-t="italic"]'));
    const input = document.getElementById('fSize');
    expect(input?.tabIndex).toBe(0);
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    input?.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });

  it('cleans up by restoring original inspector controls', () => {
    cleanup = setupNativeContextToolbar(); cleanup(); cleanup = undefined;
    expect(document.querySelector('#inspector #fFamily')).not.toBeNull();
    expect(document.querySelector('#native-text-toolbar')).toBeNull();
    expect(document.querySelector<HTMLElement>('h3')?.hidden).toBe(false);
  });

  it('provides a keyboard path into formatting and back to the text selection', () => {
    cleanup = setupNativeContextToolbar();
    const editor = document.querySelector<HTMLElement>('[contenteditable]');
    const node = editor?.firstChild;
    if (!node || !editor) throw new Error('Missing test editor');
    editor.tabIndex = 0;
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(node);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.getElementById('fFamily'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(editor);
    expect(window.getSelection()?.toString()).toBe('One two three');
  });
});
