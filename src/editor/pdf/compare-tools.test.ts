// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { setupComparisonTools } from './compare-tools';
import { mountComparisonPanel } from './comparison-panel';
import { mountMeasurementPanel } from './measurement-panel';
import { comparePdf } from './compare';
import { exportPdf } from '../studio/exports';
import type { StandardPdfToolsApi } from './standard-tools';
import type { StudioProject } from '../studio/types';
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'));
vi.mock('./comparison-panel', () => ({ mountComparisonPanel: vi.fn(() => () => {}) }));
vi.mock('./measurement-panel', () => ({ mountMeasurementPanel: vi.fn(() => () => {}) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function wire(readPdfSnapshot: StandardPdfToolsApi['readPdfSnapshot'], readComparisonSnapshot?: StandardPdfToolsApi['readPdfSnapshot']) {
  const actions = new Map<string, () => void>();
  const api = { readPdfSnapshot, readComparisonSnapshot, runPdfOperation: vi.fn(),
    registerDocumentAction: (label: string, callback: () => void) => { actions.set(label, callback); return {} as HTMLButtonElement; },
    mountDocumentPanel: (_title: string, mount: (body: HTMLElement, close: () => void) => unknown) => { mount({} as HTMLElement, vi.fn()); },
  };
  setupComparisonTools(api);
  return { api, actions };
}

it('compares the combined native and editable graphics PDF while measurement retains native bytes', async () => {
  const doc = await PDFDocument.create(); doc.addPage([200, 200]); const bytes = await doc.save();
  const project: StudioProject = { version: 1, name: 'Combined', sourcePdf: Buffer.from(bytes).toString('base64'), pages: [{ id: 'p', name: 'Page', width: 200, height: 200, background: '#ffffff', sourcePageIndex: 0, objects: [{ id: 'r', kind: 'rect', name: 'Editable rectangle', x: 30, y: 30, width: 100, height: 100, rotation: 0, opacity: 1, fill: '#ff0000', stroke: 'none', strokeWidth: 0, locked: false }] }] };
  const combined = await exportPdf(structuredClone(project));
  const readNative = vi.fn(async () => ({ bytes, revision: 7 }));
  const readCombined = vi.fn(async () => ({ bytes: combined, revision: 7 }));
  const { api, actions } = wire(readNative, readCombined);
  actions.get('Porovnat PDF')!();
  const comparisonApi = vi.mocked(mountComparisonPanel).mock.calls[0][1];
  const captured = await comparisonApi.readPdfSnapshot();
  expect(captured.revision).toBe(7);
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  expect((await comparePdf(bytes, combined, new AbortController().signal)).pages[0].kind).toBe('changed');
  expect((await comparePdf(captured.bytes, combined, new AbortController().signal)).pages[0].kind).toBe('unchanged');
  expect(readCombined).toHaveBeenCalledOnce(); expect(readNative).not.toHaveBeenCalled();
  actions.get('Měření PDF')!();
  const measurementApi = vi.mocked(mountMeasurementPanel).mock.calls[0][1];
  expect(measurementApi.readPdfSnapshot).toBe(readNative);
  expect(measurementApi.runPdfOperation).toBe(api.runPdfOperation);
});

it('keeps the native comparison snapshot fallback for existing API users', () => {
  const readNative = vi.fn(async () => ({ bytes: new Uint8Array([1]), revision: 1 }));
  const { actions } = wire(readNative);
  actions.get('Porovnat PDF')!();
  expect(vi.mocked(mountComparisonPanel).mock.calls[0][1].readPdfSnapshot).toBe(readNative);
});

it('wires comparison and print to the same merged snapshot in the production entry', () => {
  const source = readFileSync('src/editor/main.ts', 'utf8');
  expect(source).toContain('readComparisonSnapshot: readMergedPdfSnapshot');
  expect(source).toContain('readPdfSnapshot: readMergedPdfSnapshot');
});
