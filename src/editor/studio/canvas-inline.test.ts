import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mountStudioCanvas } from './canvas';
import type { StudioProject } from './types';
const fixture = (): StudioProject => ({ version: 1, name: 'Inline', pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [{ id: 'text', kind: 'text', name: 'Text', text: 'Edit me', fontSize: 24, x: 50, y: 60, width: 240, height: 100, rotation: 15, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false }] }] });
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('canvas inline interaction', () => {
  it('keeps the hit target stable across two pointer clicks before double-click', () => {
    const container = document.createElement('div'); document.body.append(container);
    const controller = mountStudioCanvas(container, fixture(), vi.fn());
    const drawing = container.querySelector<SVGSVGElement>('.studio-paper');
    const hit = container.querySelector('[data-object="text"] > rect');
    if (!drawing || !hit) throw new Error('Missing canvas target');
    drawing.setPointerCapture = vi.fn();
    for (let click = 0; click < 2; click++) {
      hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 70, clientY: 80 }));
      drawing.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 70, clientY: 80 }));
      expect(hit.isConnected).toBe(true);
    }
    hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 70, clientY: 80 }));
    expect(container.querySelector('.studio-inline-text')).not.toBeNull();
    expect(container.querySelector('.studio-paper')?.getAttribute('role')).toBe('group'); controller.destroy();
  });
  it('double-click edits on the canvas and Escape commits one undoable session', () => {
    const container = document.createElement('div'); document.body.append(container);
    const controller = mountStudioCanvas(container, fixture(), vi.fn());
    container.querySelector('[data-object="text"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = container.querySelector<HTMLElement>('.studio-inline-text');
    expect(editor).not.toBeNull(); expect(document.activeElement).toBe(editor);
    expect(editor?.closest('[data-inline-editor]')?.getAttribute('transform')).toContain('rotate(15');
    if (!editor) throw new Error('Missing editor');
    editor.textContent = 'Přímá úprava'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(controller.getProject().pages[0].objects[0].text).toBe('Přímá úprava');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('.studio-inline-text')).toBeNull();
    container.querySelector<HTMLButtonElement>('[data-toolbar-action="undo"]')?.click();
    expect(controller.getProject().pages[0].objects[0].text).toBe('Edit me'); controller.destroy();
  });
  it('exposes top text controls and does not edit locked text', () => {
    const container = document.createElement('div'); document.body.append(container);
    const project = fixture(); project.pages[0].objects[0].locked = true;
    const controller = mountStudioCanvas(container, project, vi.fn());
    container.querySelector('[data-object="text"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.querySelector('.studio-inline-text')).toBeNull(); controller.destroy();
  });
  it('Enter on a selected text opens the inline surface with text selected', () => {
    const container = document.createElement('div'); document.body.append(container);
    const controller = mountStudioCanvas(container, fixture(), vi.fn());
    container.querySelector<HTMLButtonElement>('.studio-layer button')?.click();
    container.querySelector('.studio-paper')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(container.querySelector('.studio-inline-text')).not.toBeNull();
    expect(document.getSelection()?.toString()).toBe('Edit me');
    expect(container.querySelector('.studio-text-toolbar [data-text-style="bold"]')).not.toBeNull();
    controller.destroy();
  });
  it('keeps the outside undo button alive for the first click that commits editing', () => {
    const container = document.createElement('div'); document.body.append(container);
    const controller = mountStudioCanvas(container, fixture(), vi.fn());
    container.querySelector('[data-object="text"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = container.querySelector<HTMLElement>('.studio-inline-text');
    if (!editor) throw new Error('Missing editor');
    editor.textContent = 'Changed'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const undo = container.querySelector<HTMLButtonElement>('[data-toolbar-action="undo"]');
    undo?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(undo?.isConnected).toBe(true); undo?.click();
    expect(controller.getProject().pages[0].objects[0].text).toBe('Edit me'); controller.destroy();
  });
  it('preserves spaces and updates toolbar emphasis without leaving edit mode', () => {
    const container = document.createElement('div'); document.body.append(container);
    const project = fixture(); project.pages[0].objects[0].text = ' a  b';
    const controller = mountStudioCanvas(container, project, vi.fn());
    expect(container.querySelector('.studio-paper text')?.getAttribute('xml:space')).toBe('preserve');
    container.querySelector<HTMLButtonElement>('.studio-layer button')?.click();
    container.querySelector('.studio-paper')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const bold = container.querySelector<HTMLButtonElement>('[data-text-style="bold"]');
    bold?.click(); expect(bold?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.studio-inline-text')).not.toBeNull(); controller.destroy();
  });
});
