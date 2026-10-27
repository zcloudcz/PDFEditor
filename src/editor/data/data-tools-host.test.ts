import { beforeEach, expect, it, vi } from 'vitest';
import type { StudioProject } from '../studio/types';
const canvas = vi.hoisted(() => ({
  project: undefined as StudioProject | undefined,
}));
vi.mock('../studio/canvas', () => ({
  mountStudioCanvas: (_root: HTMLElement, project: StudioProject) => {
    canvas.project = structuredClone(project);
    return {
      getProject: () => structuredClone(canvas.project!),
      setProject: (next: StudioProject) => {
        canvas.project = structuredClone(next);
      },
      getActivePageId: () => 'p',
      getViewState: () => ({ pageId: 'p', selectedIds: [] as string[] }),
      setPageBackground: vi.fn(),
      destroy: vi.fn(),
      updateNativeSource: (sourcePdf: string) => {
        canvas.project!.sourcePdf = sourcePdf;
      },
    };
  },
}));
vi.mock('../studio/exports', () => ({
  exportPdf: vi.fn(async (project: StudioProject) => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    for (const page of project.pages) doc.addPage([page.width, page.height]);
    return doc.save();
  }),
  exportSvg: vi.fn(async () => '<svg/>'),
  exportImages: vi.fn(),
  exportPptx: vi.fn(),
  renderPdfBackground: vi.fn(async () => null),
}));
vi.mock('../studio/recovery', () => ({
  clearRecovery: vi.fn(),
  readRecoveryState: vi.fn(),
  writeRecovery: vi.fn(),
  cancelRecoveryWrites: vi.fn(),
  prepareRecoveryPurge: vi.fn(),
}));
import { setupStudio } from '../studio/host';
import { setupDataTools } from './data-tools';
import {
  serializePortableProject,
  parsePortableProject,
} from '../studio/project-io';
import { PDFDocument } from 'pdf-lib';
const click = (text: string) => {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent === text)!;
  expect(button, text).toBeTruthy();
  button.click();
};
beforeEach(() => {
  document.body.innerHTML =
    '<div class="welcome-actions"></div><div id="text-editor-app"><div id="toolbar"></div><div id="stage"></div></div>';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  URL.createObjectURL = vi.fn(() => 'blob:data-host');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
it('commits actual data-panel edits through the real host/coordinator and undo, then reopens the portable scene and source', async () => {
  const native = await PDFDocument.create();
  native.addPage([900, 700]);
  let bytes = await native.save();
  const app = {
    getCurrentPageIndex: () => 0,
    getNativeRevision: () => 1,
    exportSnapshot: async () => bytes,
    captureStudioSnapshot: async () => ({ bytes, revision: 1 }),
  };
  const host = setupStudio(
    () => app,
    async (file) => {
      bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
      return true;
    }
  );
  const source: StudioProject = {
    version: 1,
    sourcePdf: btoa(String.fromCharCode(...bytes)),
    name: 'Host data',
    pages: [
      {
        id: 'p',
        sourcePageIndex: 0,
        name: 'Page',
        width: 900,
        height: 700,
        background: '#ffffff',
        objects: [],
      },
    ],
    dataTables: [
      {
        id: 'd',
        columns: [
          { id: 'label', label: 'Label' },
          { id: 'value', label: 'Value', type: 'number' },
        ],
        rows: [['Before', 12]],
      },
    ],
  };
  const text = await serializePortableProject(source),
    upload = document.querySelector<HTMLInputElement>('#studio-project-file')!;
  Object.defineProperty(upload, 'files', {
    value: [{ size: text.length, text: async () => text }],
  });
  upload.dispatchEvent(new Event('change'));
  await vi.waitFor(() => {
    expect(canvas.project?.dataTables?.[0].rows[0][0]).toBe('Before');
    expect(
      document
        .querySelector('#graphic-studio')
        ?.getAttribute('data-surface-pending')
    ).not.toBe('true');
  });
  setupDataTools({ ...host, t: (value) => value });
  click('Tabulky, grafy a CSV');
  await vi.waitFor(() =>
    expect(
      document.querySelector('input[aria-label="Buňka 1: Label"]')
    ).toBeTruthy()
  );
  const cell = document.querySelector<HTMLInputElement>(
    'input[aria-label="Buňka 1: Label"]'
  )!;
  cell.value = 'After';
  cell.dispatchEvent(new Event('change'));
  expect(canvas.project!.dataTables![0].rows[0][0]).toBe('Before');
  click('Vložit tabulku');
  const allow = [
    ...document.querySelectorAll<HTMLInputElement>('label input'),
  ].find(
    (i) => i.parentElement?.textContent === 'Potvrdit nahrazení ručních úprav'
  )!;
  allow.checked = true;
  click('Použít');
  await vi.waitFor(() =>
    expect(canvas.project!.dataTables![0].rows[0][0]).toBe('After')
  );
  const result = await host.readProjectSnapshot();
  const reopened = await parsePortableProject(
    await serializePortableProject(result.project)
  );
  expect(reopened.dataTables![0].rows[0][0]).toBe('After');
  expect(
    reopened.pages[0].objects.some(
      (o) => o.groupId === 'd' && o.text === 'After'
    )
  ).toBe(true);
  expect(reopened.sourcePdf).toBeTruthy();
  click('Zrušit');
  document.querySelector<HTMLButtonElement>('#document-undo')!.click();
  await vi.waitFor(() =>
    expect(canvas.project!.dataTables![0].rows[0][0]).toBe('Before')
  );
});
