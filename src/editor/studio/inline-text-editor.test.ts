import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineTextEditor } from './inline-text-editor';
import type { StudioObject } from './types';

const textObject = (): StudioObject => ({ id: 'text', kind: 'text', name: 'text', x: 10, y: 20, width: 300, height: 100, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false, text: 'Hello world', fontSize: 24, fontFamily: 'Liberation Sans' });
const select = (element: HTMLElement, start: number, end: number) => {
  const node = element.querySelector('span')?.firstChild;
  if (!node) throw new Error('Missing editable text');
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};
afterEach(() => { document.body.replaceChildren(); });

describe('inline rich text editing', () => {
  it('retains paragraph range offsets, style changes and undo with paragraph spacing', () => {
    const object = textObject(); object.text = 'First\nSecond'; object.paragraphSpacing = 12; object.tracking = 0.5;
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() }); document.body.append(editor.element);
    expect(editor.element.querySelectorAll('[data-text-paragraph]')).toHaveLength(2);
    expect(editor.element.textContent).toBe('First\nSecond');
    editor.focus(true); editor.format('bold');
    expect(object.text).toBe('First\nSecond'); expect(document.getSelection()?.toString()).toBe('First\nSecond');
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(object.text).toBe('First\nSecond'); expect(object.textRuns?.[0].bold).toBe(false);
    expect(editor.element.style.letterSpacing).toBe('0.5px'); editor.destroy();
  });
  it('formats only selected characters and preserves the range across combined emphasis', () => {
    const object = textObject();
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() });
    document.body.append(editor.element); editor.focus(); select(editor.element, 6, 11);
    editor.format('bold'); editor.format('italic'); editor.format('underline');
    expect(object.text).toBe('Hello world');
    expect(object.textRuns?.find(run => run.text === 'world')).toMatchObject({ bold: true, italic: true, underline: true });
    expect(object.textRuns?.[0]).toMatchObject({ text: 'Hello ', bold: false, italic: false });
    expect(document.getSelection()?.toString()).toBe('world'); editor.destroy();
  });
  it('retains a text range after focus moves into a formatting field', () => {
    const object = textObject();
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() });
    document.body.append(editor.element); editor.focus(); select(editor.element, 0, 5);
    const field = document.createElement('input'); document.body.append(field); field.focus();
    expect(editor.formatValues({ fontSize: 36, color: '#ff0000' })).toBe(true);
    expect(object.textRuns?.[0]).toMatchObject({ text: 'Hello', fontSize: 36, color: '#ff0000' });
    expect(object.textRuns?.[1]).toMatchObject({ text: ' world', fontSize: 24, color: '#000000' });
    expect(document.getSelection()?.toString()).toBe('Hello'); editor.destroy();
  });
  it('defers finish and publication until composition ends', () => {
    const object = textObject(), change = vi.fn(), finish = vi.fn();
    const editor = createInlineTextEditor(object, { label: 'Text', change, finish }); document.body.append(editor.element);
    editor.element.dispatchEvent(new CompositionEvent('compositionstart'));
    editor.element.textContent = '日本語'; editor.element.dispatchEvent(new InputEvent('input'));
    editor.finish(); expect(finish).not.toHaveBeenCalled(); expect(object.text).toBe('Hello world');
    editor.element.dispatchEvent(new CompositionEvent('compositionend'));
    expect(object.text).toBe('日本語'); expect(finish).toHaveBeenCalledOnce(); editor.destroy();
  });
  it('undoes and redoes formatting without deleting the text object', () => {
    const object = textObject();
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() }); document.body.append(editor.element); editor.focus(true);
    editor.format('bold'); expect(object.textRuns?.[0].bold).toBe(true);
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(object.textRuns?.[0].bold).toBe(false);
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(object.textRuns?.[0].bold).toBe(true); editor.destroy();
  });
  it('does not add a second vertical offset for a larger first text run', () => {
    const object = textObject(); object.textRuns = [{ text: 'Hello', fontSize: 40 }, { text: ' world', fontSize: 24 }];
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() });
    expect(editor.element.style.paddingTop).toBe('0px'); editor.destroy();
  });
  it('applies emphasis, size and color to subsequently typed text at a collapsed caret', () => {
    const object = textObject();
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() });
    document.body.append(editor.element); editor.focus(); select(editor.element, 5, 5);
    editor.format('bold'); editor.formatValues({ fontSize: 40, color: '#ff0000' });
    expect(editor.state('bold')).toBe(true);
    const caret = document.getSelection()?.anchorNode;
    if (!(caret instanceof Text)) throw new Error('Expected typing caret');
    caret.textContent = '!'; editor.element.dispatchEvent(new InputEvent('input'));
    expect(object.text).toBe('Hello! world');
    expect(object.textRuns?.find(run => run.text === '!')).toMatchObject({ bold: true, fontSize: 40, color: '#ff0000' });
    expect(object.textRuns?.find(run => run.text === 'Hello')?.fontSize).toBe(24); editor.destroy();
  });
  it('preserves the pending caret style when inserting a newline and pasting text', () => {
    const object = textObject();
    const editor = createInlineTextEditor(object, { label: 'Text', change: vi.fn(), finish: vi.fn() });
    document.body.append(editor.element); editor.focus(); select(editor.element, 5, 5); editor.format('bold');
    editor.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', cancelable: true }));
    expect(object.text).toBe('Hello\n world');
    expect(object.textRuns?.find(run => run.text === '\n')?.bold).toBe(true);
    const paste = new Event('paste', { cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'new' } });
    editor.element.dispatchEvent(paste);
    expect(object.text).toBe('Hello\nnew world');
    expect(object.textRuns?.find(run => run.text === 'new')?.bold).toBe(true); editor.destroy();
  });
});
