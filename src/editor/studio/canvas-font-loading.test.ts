import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountStudioCanvas } from './canvas';
import type { StudioProject } from './types';

const fixture = (): StudioProject => ({ version: 1, name: 'Fonts', pages: [{ id: 'p', name: 'Page', width: 500, height: 500, background: '#ffffff', objects: [{ id: 't', kind: 'text', name: 'Text', text: 'Cold font', fontFamily: 'Liberation Sans', x: 10, y: 10, width: 200, height: 40, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false }] }] });
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('does not report a cold font as failed and refreshes validation after it loads', async () => {
  let complete!: (value: Response) => void;
  const fetchFont = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', fetchFont);
  const container = document.createElement('div'); document.body.append(container);
  const controller = mountStudioCanvas(container, fixture(), vi.fn());
  container.querySelector<HTMLButtonElement>('.studio-layer button')!.click();
  expect(container.querySelector('.studio-properties')!.textContent).not.toContain('Lokální písmo nelze načíst.');
  complete(new Response(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf')));
  await vi.waitFor(() => expect(container.querySelector('[data-object="t"] path')).not.toBeNull());
  expect(container.querySelector('.studio-properties')!.textContent).not.toContain('Lokální písmo nelze načíst.');
  expect(fetchFont).toHaveBeenCalledOnce(); controller.destroy();
});

it.each(['textarea', 'input'] as const)('preserves the focused %s draft when a delayed font finishes loading', async kind => {
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
  const project = fixture(); project.pages[0].objects[0].fontFamily = kind === 'textarea' ? 'Liberation Sans Italic' : 'Liberation Sans BoldItalic';
  const container = document.createElement('div'); document.body.append(container);
  const controller = mountStudioCanvas(container, project, vi.fn());
  controller.restoreViewState!({ pageId: 'p', selectedIds: ['t'] });
  const control = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(kind === 'textarea' ? '.studio-properties textarea' : '.studio-properties input[type="number"]')!;
  control.focus(); control.value = kind === 'textarea' ? 'Unfinished typing' : '123';
  if (kind === 'textarea') control.setSelectionRange(2, 7, 'backward');
  complete(new Response(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf')));
  await vi.waitFor(() => expect(container.querySelector('[data-object="t"] path')).not.toBeNull());
  expect(control.isConnected).toBe(true);
  expect(document.activeElement).toBe(control);
  expect(control.value).toBe(kind === 'textarea' ? 'Unfinished typing' : '123');
  if (kind === 'textarea') {
    expect(control.selectionStart).toBe(2); expect(control.selectionEnd).toBe(7); expect(control.selectionDirection).toBe('backward');
  }
  controller.destroy();
});

it('reports a failed font after loading settles without retry render cycles', async () => {
  let complete!: (value: Response) => void;
  const fetchFont = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', fetchFont);
  const project = fixture(); project.pages[0].objects[0].fontFamily = 'Liberation Sans Bold';
  const container = document.createElement('div'); document.body.append(container);
  const controller = mountStudioCanvas(container, project, vi.fn());
  container.querySelector<HTMLButtonElement>('.studio-layer button')!.click();
  expect(container.querySelector('.studio-properties')!.textContent).not.toContain('Lokální písmo nelze načíst.');
  complete(new Response('', { status: 404 }));
  await vi.waitFor(() => expect(container.querySelector('.studio-properties')!.textContent).toContain('Lokální písmo nelze načíst.'));
  expect(fetchFont).toHaveBeenCalledOnce(); controller.destroy();
});

it('does not restore a stale selected-text warning after selection changes while loading', async () => {
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
  const project = fixture(); project.pages[0].objects[0].fontFamily = 'Noto Sans Arabic';
  const container = document.createElement('div'); document.body.append(container);
  const controller = mountStudioCanvas(container, project, vi.fn());
  controller.restoreViewState!({ pageId: 'p', selectedIds: ['t'] });
  controller.clearSelection!();
  complete(new Response('', { status: 404 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(container.querySelector('.studio-properties')!.textContent).not.toContain('Lokální písmo nelze načíst.');
  expect(controller.getViewState!().selectedIds).toEqual([]); controller.destroy();
});

it('does not render detached UI when a font settles after disposal', async () => {
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
  const project = fixture(); project.pages[0].objects[0].fontFamily = 'Noto Sans Devanagari';
  const container = document.createElement('div'); document.body.append(container);
  const controller = mountStudioCanvas(container, project, vi.fn());
  controller.destroy();
  const afterDestroy = container.innerHTML;
  complete(new Response('', { status: 404 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(container.innerHTML).toBe(afterDestroy);
});
