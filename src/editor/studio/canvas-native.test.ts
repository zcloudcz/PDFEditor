import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountStudioCanvas } from './canvas';
import type { StudioProject } from './types';
const project = (): StudioProject => ({ version: 1, name: 'Shared', pages: [{ id: 'p', name: 'Page', sourcePageIndex: 0, width: 600, height: 800, background: '#fff', objects: [{ id: 'text', kind: 'text', name: 'Text', text: 'Editable', x: 30, y: 40, width: 180, height: 50, rotation: 0, opacity: 1, fill: '#000', stroke: 'none', strokeWidth: 0, locked: false }] }] });
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('shared native and graphics surface', () => {
  it('renders local guides in the shared native page and snaps graphics to them without persisting them', () => {
    const { controller, native } = setup();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    controller.setGuides!('p', [{ axis: 'x', position: 47 }]);
    expect(native.querySelector('[data-local-guide="x"]')?.getAttribute('x1')).toBe('47');
    const drawing = native.querySelector<SVGSVGElement>('svg')!; drawing.setPointerCapture = vi.fn();
    drawing.querySelector('[data-object]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 30, clientY: 40 }));
    drawing.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 45, clientY: 40 }));
    drawing.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(controller.getProject().pages[0].objects[0].x).toBe(47);
    expect(JSON.stringify(controller.getProject())).not.toContain('guide');
    controller.setGuides!('p', []); expect(native.querySelector('[data-local-guide]')).toBeNull(); controller.destroy();
  });
  it('explicitly retires project, selection, background and history for sanitization', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const controller = mountStudioCanvas(container, { ...project(), sourcePdf: 'old-source' }, vi.fn());
    controller.setPageBackground('p', 'data:image/png;base64,AA==');
    controller.setProject({ ...project(), name: 'New revision' }, { recordHistory: true });
    await controller.purgeForSanitization!();
    expect(controller.getProject()).toEqual({ version: 1, name: '', pages: [] });
    expect(controller.getViewState?.().selectedIds).toEqual([]);
    expect(container.children).toHaveLength(0);
  });
  function setup() {
    const container = document.createElement('div'); document.body.append(container);
    const controller = mountStudioCanvas(container, project(), vi.fn());
    const native = document.createElement('div'); const pdf = document.createElement('canvas'); native.append(pdf); container.append(native);
    return { controller, container, native, pdf };
  }
  it('uses native geometry without replacing the native page or painting its PDF background twice', () => {
    const { controller, native, pdf } = setup();
    controller.setPageBackground('p', 'data:image/png;base64,AA==');
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1.25 });
    const drawing = native.querySelector('.studio-paper');
    expect(drawing?.getAttribute('width')).toBe('750'); expect(drawing?.getAttribute('height')).toBe('1000');
    expect(drawing?.classList.contains('studio-native-overlay')).toBe(true);
    expect(drawing?.querySelector('image')).toBeNull(); expect(pdf.isConnected).toBe(true);
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 800, height: 600, zoom: .5 });
    expect(native.querySelector('.studio-paper')?.getAttribute('viewBox')).toBe('0 0 800 600');
    expect(native.querySelector('.studio-paper')?.getAttribute('width')).toBe('400');
    expect(native.querySelectorAll('.studio-paper')).toHaveLength(1); expect(pdf.isConnected).toBe(true);
    controller.destroy(); expect(pdf.isConnected).toBe(true); expect(native.querySelector('.studio-paper')).toBeNull();
  });
  it('announces graphic selection before handling it and blocks native mouse handlers for graphic hits', () => {
    const { controller, native } = setup();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    const nativeMouse = vi.fn(); native.addEventListener('mousedown', nativeMouse);
    const selected = vi.fn(); window.addEventListener('editor:graphic-selected', selected);
    const drawing = native.querySelector<SVGSVGElement>('svg')!; drawing.setPointerCapture = vi.fn();
    const target = drawing.querySelector('[data-object]')!;
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(selected).toHaveBeenCalledOnce();
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); expect(nativeMouse).not.toHaveBeenCalled();
    drawing.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    controller.clearSelection!(); expect(controller.getViewState?.().selectedIds).toEqual([]);
    window.removeEventListener('editor:graphic-selected', selected); controller.destroy();
  });
  it('keeps an inline caret session across geometry updates', () => {
    const { controller, native } = setup();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    native.querySelector('[data-object]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = native.querySelector('.studio-inline-text'); expect(input).not.toBeNull();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 2 });
    expect(native.querySelector('.studio-inline-text')).toBe(input); expect(native.querySelector('svg')?.getAttribute('width')).toBe('1200');
    controller.destroy();
  });
  it('retains graphic text selection when only the native source checkpoint changes', () => {
    const { controller, native } = setup();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    native.querySelector('[data-object]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = native.querySelector('.studio-inline-text');
    controller.updateNativeSource!('checkpoint');
    expect(controller.getProject().sourcePdf).toBe('checkpoint');
    expect(native.querySelector('.studio-inline-text')).toBe(input);
    expect(controller.getViewState?.().selectedIds).toEqual(['text']); controller.destroy();
  });
  it('does not select or mutate graphics when native draft handoff is rejected', () => {
    const { controller, native } = setup();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    const reject = (event: Event) => event.preventDefault();
    window.addEventListener('editor:graphic-selected', reject);
    native.querySelector('[data-object]')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    expect(controller.getViewState?.().selectedIds).toEqual([]);
    expect(controller.getProject().pages[0].objects[0].x).toBe(30);
    window.removeEventListener('editor:graphic-selected', reject); controller.destroy();
  });
  it('leaves native keyboard selection and deletion to the PDF editor', () => {
    const { controller, container, native, pdf } = setup(); native.id = 'text-editor-app';
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    pdf.tabIndex = 0; pdf.focus();
    pdf.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(controller.getViewState?.().selectedIds).toEqual([]);
    container.querySelector('.studio-paper')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(controller.getViewState?.().selectedIds).toEqual(['text']); controller.destroy();
  });
  it('announces keyboard and restored graphic selections while leaving empty native restoration alone', () => {
    const { controller, native } = setup();
    controller.attachNativeSurface!({ container: native, pageIndex: 0, width: 600, height: 800, zoom: 1 });
    const notify = vi.fn(); window.addEventListener('editor:graphic-selected', notify);
    controller.restoreViewState!({ pageId: 'p', selectedIds: ['text'] });
    expect(notify).toHaveBeenCalledOnce();
    controller.restoreViewState!({ pageId: 'p', selectedIds: [] });
    expect(notify).toHaveBeenCalledOnce();
    const drawing = native.querySelector<SVGSVGElement>('.studio-paper')!; drawing.focus();
    drawing.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(notify).toHaveBeenCalledTimes(2);
    window.removeEventListener('editor:graphic-selected', notify); controller.destroy();
  });
});
