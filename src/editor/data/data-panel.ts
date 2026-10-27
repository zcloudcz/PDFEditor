import type { StudioObject } from '../studio/types';
import { dataPrimitive } from './charts';
import {
  validateDataTable,
  setCell,
  type DataTable,
  type CellValue,
} from './table';
export interface TableLayout {
  x?: number;
  y?: number;
  width?: number;
  rowHeight?: number;
  locale?: string;
}
/** Full table as editable cells. Oversized tables require explicit pagination first. */
export function tableToObjects(
  table: DataTable,
  layout: TableLayout = {},
  groupId: string = table.id
): StudioObject[] {
  validateDataTable(table);
  if ((table.rows.length + 1) * table.columns.length > 1000)
    throw new Error('Table scene exceeds 1000 cells; paginate the table first');
  const { x = 0, y = 0, width = 600, rowHeight = 28 } = layout;
  if (
    ![x, y, width, rowHeight].every(Number.isFinite) ||
    width < 1 ||
    width > 14400 ||
    rowHeight < 12 ||
    rowHeight > 1000 ||
    (table.rows.length + 1) * rowHeight > 14400
  )
    throw new Error('Invalid table geometry');
  const formatter = new Intl.NumberFormat(layout.locale ?? 'en-US', {
    maximumFractionDigits: 10,
  });
  const rows: CellValue[][] = [
      table.columns.map((c) => c.label),
      ...table.rows,
    ],
    cellWidth = width / table.columns.length,
    out: StudioObject[] = [];
  rows.forEach((row, i) =>
    row.forEach((value, j) => {
      out.push(
        dataPrimitive('rect', groupId, {
          x: x + j * cellWidth,
          y: y + i * rowHeight,
          width: cellWidth,
          height: rowHeight,
          fill: i === 0 ? '#e5e7eb' : '#ffffff',
          stroke: '#9ca3af',
          strokeWidth: 0.5,
        })
      );
      out.push(
        dataPrimitive('text', groupId, {
          x: x + j * cellWidth + 4,
          y: y + i * rowHeight + 3,
          width: Math.max(0.01, cellWidth - 8),
          height: rowHeight - 6,
          fontFamily: i === 0 ? 'Liberation Sans Bold' : 'Liberation Sans',
          fontSize: 11,
          wrapText: true,
          text:
            value === null
              ? ''
              : typeof value === 'number'
                ? formatter.format(value)
                : value,
        })
      );
    })
  );
  return out;
}
export interface DataPanelHost {
  getTable(): DataTable;
  /** Host owns revision/snapshot validation and authoritative data+scene regeneration. */
  onTableChange(table: DataTable): void;
  onError(error: unknown): void;
  labels: { cell: string; previous: string; next: string; page: string };
}
/** Bounded accessible cell editor. Label localization belongs to the calling UI. */
export function mountDataPanel(
  container: HTMLElement,
  host: DataPanelHost
): () => void {
  let page = 0,
    disposed = false;
  const pageSize = 20;
  let controller = new AbortController();
  const render = () => {
    if (disposed) return;
    controller.abort();
    controller = new AbortController();
    const table = host.getTable();
    validateDataTable(table);
    container.replaceChildren();
    page = Math.min(
      page,
      Math.max(0, Math.ceil(table.rows.length / pageSize) - 1)
    );
    const grid = document.createElement('table'),
      head = document.createElement('thead'),
      header = document.createElement('tr');
    for (const column of table.columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = column.label;
      header.append(cell);
    }
    head.append(header);
    grid.append(head);
    const body = document.createElement('tbody');
    for (
      let row = page * pageSize;
      row < Math.min(table.rows.length, (page + 1) * pageSize);
      row++
    ) {
      const line = document.createElement('tr');
      table.columns.forEach((column, col) => {
        const cell = document.createElement('td'),
          input = document.createElement('input');
        input.type = 'text';
        input.value =
          table.rows[row][col] === null ? '' : String(table.rows[row][col]);
        input.maxLength = 10000;
        input.setAttribute(
          'aria-label',
          `${host.labels.cell} ${row + 1}: ${column.label}`
        );
        input.addEventListener(
          'change',
          () => {
            if (disposed) return;
            try {
              const raw = input.value;
              let value: CellValue = raw;
              if (column.type === 'number') {
                if (raw.trim() === '') value = null;
                else {
                  if (
                    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
                      raw.trim()
                    )
                  )
                    throw new Error(
                      'Numeric cells require a finite decimal with a dot'
                    );
                  value = Number(raw);
                  if (!Number.isFinite(value))
                    throw new Error('Numeric cells require finite values');
                }
              }
              host.onTableChange(
                setCell(host.getTable(), row, column.id, value)
              );
            } catch (error) {
              host.onError(error);
            }
          },
          { signal: controller.signal }
        );
        cell.append(input);
        line.append(cell);
      });
      body.append(line);
    }
    grid.append(body);
    container.append(grid);
    const nav = document.createElement('div');
    for (const [label, delta, disabled] of [
      [host.labels.previous, -1, page === 0],
      [host.labels.next, 1, (page + 1) * pageSize >= table.rows.length],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener(
        'click',
        () => {
          page += delta;
          render();
        },
        { signal: controller.signal }
      );
      nav.append(button);
    }
    const status = document.createElement('span');
    status.setAttribute('aria-live', 'polite');
    status.textContent = `${host.labels.page} ${page + 1} / ${Math.max(1, Math.ceil(table.rows.length / pageSize))}`;
    nav.append(status);
    container.append(nav);
  };
  render();
  return () => {
    disposed = true;
    controller.abort();
    container.replaceChildren();
  };
}
