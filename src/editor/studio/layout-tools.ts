import { t } from '../i18n';
import type { StandardPdfToolsApi } from '../pdf/standard-tools';
import { mountLayoutPanel } from './layout-panel';
import type { LocalGuide } from './layout-rules';
import type { StudioProject } from './types';

export interface LayoutToolsApi extends StandardPdfToolsApi {
  readProjectSnapshot(): Promise<{ project: StudioProject; revision: number; view: { pageId?: string; selectedIds: string[] } }>;
  runProjectOperation(label: string, prepare: (project: StudioProject, signal: AbortSignal) => Promise<StudioProject>, expectedRevision?: number, signal?: AbortSignal): Promise<void>;
  setLayoutGuides(pageId: string, guides: readonly LocalGuide[]): void;
  getLayoutGuides?(pageId: string): readonly LocalGuide[];
}

export function setupLayoutTools(api: LayoutToolsApi): void {
  api.registerDocumentAction('Rozvržení návrhu', () => api.mountDocumentPanel('Rozvržení návrhu', body => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const controller = new AbortController();
    void api.readProjectSnapshot().then(snapshot => {
      if (disposed) return;
      const pageId = snapshot.view.pageId ?? snapshot.project.pages[0].id;
      cleanup = mountLayoutPanel(body, {
        getProject: () => snapshot.project,
        getView: () => ({ pageId, selectedIds: snapshot.view.selectedIds }),
        setGuides: (id, guides) => api.setLayoutGuides(id, guides),
        getGuides: id => api.getLayoutGuides?.(id) ?? [],
        async apply(project) {
          await api.runProjectOperation('Rozvržení návrhu', async () => project, snapshot.revision, controller.signal);
          snapshot = await api.readProjectSnapshot();
        },
      });
    }).catch(() => {
      if (disposed) return;
      const error = document.createElement('p'); error.setAttribute('role', 'alert');
      error.textContent = t('Operace se nezdařila.'); body.append(error);
    });
    return () => { disposed = true; controller.abort(); cleanup?.(); };
  }));
}
