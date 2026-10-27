import { validateDataTable, type DataTable } from './table';
import { validateChartSpec, type ChartSpec } from './charts';

/** Kept below the containing project's limit so validation never expands unbounded data. */
export function validateProjectData(value: {
  dataTables?: DataTable[];
  dataCharts?: ChartSpec[];
}): void {
  if (value.dataTables !== undefined && !Array.isArray(value.dataTables) || value.dataCharts !== undefined && !Array.isArray(value.dataCharts)) throw new Error('Invalid project data arrays');
  const tables = value.dataTables ?? [],
    charts = value.dataCharts ?? [];
  if (
    !Array.isArray(tables) ||
    tables.length > 20 ||
    !Array.isArray(charts) ||
    charts.length > 100
  )
    throw new Error('Project data exceeds limits');
  const ids = new Set<string>(),
    byId = new Map<string, DataTable>();
  let bytes = 0;
  for (const table of tables) {
    validateDataTable(table);
    if (ids.has(table.id)) throw new Error('Duplicate project data identity');
    ids.add(table.id);
    byId.set(table.id, table);
    bytes += new TextEncoder().encode(JSON.stringify(table)).length;
    if (bytes > 10 * 1024 * 1024)
      throw new Error('Project data exceeds limits');
  }
  for (const chart of charts) {
    const table = chart && byId.get(chart.tableId);
    if (!table) throw new Error('Chart references missing table');
    validateChartSpec(chart, table);
    if (ids.has(chart.id)) throw new Error('Duplicate project data identity');
    ids.add(chart.id);
  }
}
