import { describe, it, expect } from 'vitest';
import { migrateProject, toStudioProject } from './migrations';
import { validateProject } from '../studio/project-validation';
import type { StudioProject } from '../studio/types';
import { HistoryStore } from './history-store';

const project = () => ({ version: 1, name: 'Data', pages: [{ id: 'p', name: 'Page', width: 600, height: 400, background: '#ffffff', objects: [] }],
  dataTables: [{ id: 'table', columns: [{ id: 'label', label: 'Název' }, { id: 'value', label: 'Hodnota', type: 'number' }], rows: [['První', 12], ['=SUM(A1)', 7]] }],
  dataCharts: [{ id: 'chart', type: 'bar', tableId: 'table', labelColumnId: 'label', valueColumnIds: ['value'] }],
}) as unknown as StudioProject;

describe('durable project data', () => {
  it('rejects explicit null data arrays rather than silently dropping them on reopen', () => {
    expect(() => validateProject(Object.assign(project(), { dataTables: null }))).toThrow();
    expect(() => validateProject(Object.assign(project(), { dataCharts: null }))).toThrow();
  });
  it('detaches tabular source from caller mutations in history', () => {
    const source = project();
    const history = HistoryStore.create(80).recorded({revision: 1, nativeRevision: 1, project: source});
    source.dataTables![0].rows[0][1] = 999;
    expect(history.at(0)?.project.dataTables?.[0].rows[0][1]).toBe(12);
  });
  it('preserves editable chart source through portable v2 and reopening', async () => {
    const source = project();
    const portable = await migrateProject(source);
    expect(await toStudioProject(JSON.parse(JSON.stringify(portable)))).toEqual(source);
  });
  it('rejects dangling table references and duplicate data identities', () => {
    const source = project() as StudioProject & { dataCharts: {tableId:string}[]; dataTables: unknown[] };
    source.dataCharts[0].tableId = 'missing';
    expect(() => validateProject(source)).toThrow();
    const duplicate = project() as StudioProject & { dataTables: unknown[] };
    duplicate.dataTables.push(structuredClone(duplicate.dataTables[0]));
    expect(() => validateProject(duplicate)).toThrow();
  });
});
