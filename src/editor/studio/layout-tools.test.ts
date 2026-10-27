import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupLayoutTools, type LayoutToolsApi } from './layout-tools';
import { mountLayoutPanel, type LayoutPanelHost } from './layout-panel';
import type { StudioProject } from './types';
vi.mock('./layout-panel', () => ({ mountLayoutPanel: vi.fn(() => vi.fn()) }));
const project: StudioProject = { version: 1, name: 'Design', pages: [{ id: 'p', name: 'Page', width: 200, height: 100, background: '#ffffff', objects: [] }] };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => vi.clearAllMocks());
function setup() {
  let action: () => void = () => {}, dispose: (() => void) | void;
  let revision = 1;
  const api: LayoutToolsApi = {
    registerDocumentAction: vi.fn((_label, callback) => { action = callback; return document.createElement('button'); }),
    mountDocumentPanel: vi.fn((_title, mount) => { dispose = mount(document.createElement('div'), vi.fn()); }),
    readProjectSnapshot: vi.fn(async () => ({ project: structuredClone(project), revision, view: { pageId: 'p', selectedIds: [] } })),
    runProjectOperation: vi.fn(async (_label, prepare) => { await prepare(project, new AbortController().signal); revision++; }),
    setLayoutGuides: vi.fn(), readPdfSnapshot: vi.fn(), runPdfOperation: vi.fn(),
  };
  setupLayoutTools(api); return { api, open: () => action(), close: () => { if (typeof dispose === 'function') dispose(); } };
}
describe('layout tool shared-document transaction', () => {
  it('refreshes snapshot revisions after each successful apply and aborts on panel close', async () => {
    const { api, open, close } = setup(); open(); await flush();
    const host = vi.mocked(mountLayoutPanel).mock.calls[0][1] as LayoutPanelHost;
    await host.apply(project, host.getView()); await host.apply(project, host.getView());
    expect(vi.mocked(api.runProjectOperation).mock.calls.map(call => call[2])).toEqual([1, 2]);
    const signal = vi.mocked(api.runProjectOperation).mock.calls[1][3]!;
    close(); expect(signal.aborted).toBe(true);
  });
  it('does not mount controls after the panel closes during snapshot capture', async () => {
    const { api, open, close } = setup();
    let resolve!: (value: Awaited<ReturnType<LayoutToolsApi['readProjectSnapshot']>>) => void;
    vi.mocked(api.readProjectSnapshot).mockReturnValue(new Promise(done => { resolve = done; }));
    open(); close(); resolve({ project, revision: 1, view: { pageId: 'p', selectedIds: [] } }); await flush();
    expect(mountLayoutPanel).not.toHaveBeenCalled();
  });
});
