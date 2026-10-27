import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPageManager } from './page-manager';
import type { StudioProject } from './types';

const project: StudioProject = { version: 1, name: 'Test', pages: [{ id: 'p', name: 'Original', width: 300, height: 400, background: '#ffffff', objects: [] }] };
let dispose: (() => void) | undefined;
beforeEach(() => { document.body.innerHTML = '<dialog><button>Close</button><div id="body"></div></dialog>'; });
afterEach(() => dispose?.());
function setup(run = vi.fn(async () => {}), pages = project, activeIndex = 0) {
  const body = document.getElementById('body');
  if (!(body instanceof HTMLDivElement)) throw new Error('Missing fixture');
  const close = vi.fn(); dispose = mountPageManager(body, pages, activeIndex, run, close);
  return { run, close };
}
function click(selector: string) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error('Missing button');
  element.click();
}
function fill(name: string, value: string) {
  const element = document.querySelector(`[name="${name}"]`);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error('Missing input');
  element.value = value;
}

describe('page manager extended requests', () => {
  it('offers current, all and custom range selection without losing the active page', async () => {
    const pages: StudioProject = { ...project, pages: [project.pages[0], { ...project.pages[0], id: 'q' }, { ...project.pages[0], id: 'r' }] };
    const run = vi.fn(async () => { throw new Error('Keep panel open'); });
    setup(run, pages, 1);
    fill('selectionMode', 'current'); document.querySelector<HTMLSelectElement>('[name="selectionMode"]')?.dispatchEvent(new Event('change'));
    fill('pages', ''); click('[data-page-action="extract"]');
    expect(run).toHaveBeenLastCalledWith({ kind: 'extract', selection: '2' });
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>('[name="selectionMode"]')?.disabled).toBe(false));
    fill('selectionMode', 'all'); document.querySelector<HTMLSelectElement>('[name="selectionMode"]')?.dispatchEvent(new Event('change')); click('[data-page-action="split"]');
    expect(run).toHaveBeenLastCalledWith({ kind: 'split', selection: '1-3' });
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>('[name="selectionMode"]')?.disabled).toBe(false));
    fill('selectionMode', 'range'); document.querySelector<HTMLSelectElement>('[name="selectionMode"]')?.dispatchEvent(new Event('change')); fill('pages', '1,3'); click('[data-page-action="rotate"][data-angle="90"]');
    expect(run).toHaveBeenLastCalledWith({ kind: 'rotate', selection: '1,3', angle: 90 });
  });
  it.each([90, -90, 180])('passes explicit rotation %s and current selection', async angle => {
    const { run } = setup(); fill('pages', '1'); click(`[data-page-action="rotate"][data-angle="${angle}"]`);
    expect(run).toHaveBeenCalledWith({ kind: 'rotate', selection: '1', angle });
  });
  it('passes move direction and selected range to the shared page action', () => {
    const { run } = setup(); fill('pages', '1'); click('[data-page-action="move"][data-direction="up"]');
    expect(run).toHaveBeenCalledWith({ kind: 'move', selection: '1', direction: 'up' });
  });
  it('passes crop margin units without converting or applying geometry in the panel', () => {
    const { run } = setup(); fill('crop-top', '10'); fill('crop-left', '25.4'); fill('crop-unit', 'mm');
    click('[data-page-action="crop"]');
    expect(run).toHaveBeenCalledWith({ kind: 'crop', selection: '1', unit: 'mm', margins: { top: 10, right: 0, bottom: 0, left: 25.4 } });
  });
  it('does not submit a negative crop margin', () => {
    const { run } = setup(); fill('crop-left', '-1'); click('[data-page-action="crop"]'); expect(run).not.toHaveBeenCalled();
  });
  it('split is a download request over the range', () => {
    const { run } = setup(); click('[data-page-action="split"]'); expect(run).toHaveBeenCalledWith({ kind: 'split', selection: '1' });
  });
  it('merges chosen local files even if the page-range input is empty', () => {
    const { run } = setup(); fill('pages', '');
    const files = [new File(['pdf'], 'first.pdf', { type: 'application/pdf' }), new File(['pdf2'], 'second.pdf', { type: 'application/pdf' })];
    const input = document.querySelector('[name="mergeFiles"]');
    Object.defineProperty(input, 'files', { value: files });
    click('[data-page-action="merge"]'); expect(run).toHaveBeenCalledWith({ kind: 'merge', files });
  });
  it('refuses empty file selection and prevents repeat actions while pending', async () => {
    let finish: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { close } = setup(run);
    click('[data-page-action="merge"]'); expect(run).not.toHaveBeenCalled();
    click('[data-page-action="split"]'); click('[data-page-action="split"]');
    expect(run).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLSelectElement>('[name="crop-unit"]')?.disabled).toBe(true);
    const event = new Event('cancel', { cancelable: true }); document.querySelector('dialog')?.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    finish?.(); await Promise.resolve(); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
  });
  it('restores controls after a synchronous action failure so the user can retry', async () => {
    const run = vi.fn().mockImplementationOnce(() => { throw new Error('Preparation failed'); }).mockResolvedValue(undefined);
    const { close } = setup(run);
    click('[data-page-action="split"]');
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe('Preparation failed'));
    expect(document.querySelector<HTMLInputElement>('[name="pages"]')?.disabled).toBe(false);
    click('[data-page-action="split"]');
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(run).toHaveBeenCalledTimes(2);
  });
});
