import { describe, it, expect, vi } from 'vitest';
import { mountNavigationPanel } from './navigation-panel';
import type { PdfNavigation } from './navigation';
const initial = (): PdfNavigation => ({ bookmarks: [{ id: 'a', title: '<img src=x onerror=alert(1)>', destination: { pageIndex: 0, view: 'Fit' }, children: [{ id: 'b', title: 'Child', destination: null, children: [] }] }], links: [{ id: 'link', pageIndex: 0, destination: null, uri: 'https://example.test/path', rect: [0,0,100,20] }], destinations: [] });
describe('PDF navigation panel', () => {
  it('renders bookmark hierarchy and external URIs as inert text', () => {
    const host = document.createElement('div'); const dispose = mountNavigationPanel(host, initial(), 3, 0, vi.fn());
    expect(host.querySelector('img,a')).toBeNull();
    expect(host.querySelector('[data-bookmark-id="a"] [data-bookmark-id="b"]')).not.toBeNull();
    expect(host.textContent).toContain('https://example.test/path'); dispose(); expect(host.children).toHaveLength(0);
  });
  it('submits page targets as zero-based indices with the selected parent and preserves titles', async () => {
    const host = document.createElement('div'), run = vi.fn(async () => initial());
    mountNavigationPanel(host, initial(), 3, 1, run);
    const form = host.querySelector('form')!;
    form.querySelector<HTMLInputElement>('input[type=text]')!.value = 'New chapter';
    form.querySelector<HTMLInputElement>('input[type=number]')!.value = '3';
    form.querySelector('select')!.value = 'a';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ kind: 'add-bookmark', title: 'New chapter', pageIndex: 2, parentId: 'a' }));
  });
  it('renames and removes bookmarks and changes or removes link targets', async () => {
    const host = document.createElement('div'), run = vi.fn(async () => initial());
    mountNavigationPanel(host, initial(), 3, 0, run);
    const click = async (kind: string) => { host.querySelector<HTMLButtonElement>(`[data-navigation-action="${kind}"]`)!.click(); await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false)); };
    host.querySelector<HTMLInputElement>('[data-bookmark-id="a"] input')!.value = 'Rename';
    await click('rename-bookmark'); expect(run).toHaveBeenLastCalledWith({ kind: 'rename-bookmark', id: 'a', title: 'Rename' });
    await click('remove-bookmark'); expect(run).toHaveBeenLastCalledWith({ kind: 'remove-bookmark', id: 'a' });
    host.querySelector<HTMLInputElement>('[data-link-id="link"] input')!.value = '2';
    await click('set-link-destination'); expect(run).toHaveBeenLastCalledWith({ kind: 'set-link-destination', id: 'link', pageIndex: 1 });
    await click('remove-link'); expect(run).toHaveBeenLastCalledWith({ kind: 'remove-link', id: 'link' });
  });
  it('blocks repeated mutations during a pending command and keeps controls usable after failure', async () => {
    const host = document.createElement('div'); let reject!: (error: Error) => void;
    const run = vi.fn(() => new Promise<PdfNavigation>((_, fail) => { reject = fail; }));
    mountNavigationPanel(host, initial(), 3, 0, run);
    const remove = host.querySelector<HTMLButtonElement>('[data-navigation-action="remove-bookmark"]')!;
    remove.click(); remove.click(); expect(run).toHaveBeenCalledTimes(1); expect(remove.disabled).toBe(true);
    reject(new Error('Failure'));
    await vi.waitFor(() => expect(remove.disabled).toBe(false)); expect(host.querySelector('[role=alert]')!.textContent).toBe('Failure');
  });
});
