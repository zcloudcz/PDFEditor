export type CellValue = string | number | null;
export interface Column {
  id: string;
  label: string;
  type?: 'text' | 'number';
}
export interface DataTable {
  id: string;
  columns: Column[];
  rows: CellValue[][];
}
export const TABLE_LIMITS = {
  rows: 10000,
  columns: 100,
  cellLength: 10000,
  bytes: 5 * 1024 * 1024,
} as const;
const string = (v: unknown, max: number) =>
  typeof v === 'string' &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export function validateDataTable(value: unknown): asserts value is DataTable {
  const t = value as DataTable;
  if (
    !t ||
    !string(t.id, 200) ||
    !t.id ||
    !Array.isArray(t.columns) ||
    !t.columns.length ||
    t.columns.length > TABLE_LIMITS.columns ||
    !Array.isArray(t.rows) ||
    t.rows.length > TABLE_LIMITS.rows
  )
    throw new Error('Invalid data table');
  if (Object.keys(t).some((k) => !['id', 'columns', 'rows'].includes(k)))
    throw new Error('Unsupported data table field');
  const ids = new Set<string>();
  for (const c of t.columns) {
    if (
      !c ||
      !string(c.id, 200) ||
      !c.id ||
      ids.has(c.id) ||
      !string(c.label, 500) ||
      (c.type !== undefined && c.type !== 'text' && c.type !== 'number') ||
      Object.keys(c).some((k) => !['id', 'label', 'type'].includes(k))
    )
      throw new Error('Invalid table column');
    ids.add(c.id);
  }
  let units =
    t.id.length +
    t.columns.reduce((n, c) => n + c.id.length + c.label.length + 40, 0);
  for (const row of t.rows) {
    if (!Array.isArray(row) || row.length !== t.columns.length)
      throw new Error('Invalid table row width');
    row.forEach((cell, i) => {
      if (
        cell !== null &&
        !(typeof cell === 'number' && Number.isFinite(cell)) &&
        !string(cell, TABLE_LIMITS.cellLength)
      )
        throw new Error('Invalid table cell');
      units += (typeof cell === 'string' ? cell.length : 24) + 3;
      if (units > TABLE_LIMITS.bytes)
        throw new Error('Data table exceeds size limit');
      if (
        t.columns[i].type === 'number' &&
        cell !== null &&
        typeof cell !== 'number'
      )
        throw new Error('Numeric cells require explicit numeric values');
    });
  }
  if (new TextEncoder().encode(JSON.stringify(t)).length > TABLE_LIMITS.bytes)
    throw new Error('Data table exceeds size limit');
}
export function setCell(
  table: DataTable,
  row: number,
  columnId: string,
  value: CellValue
): DataTable {
  validateDataTable(table);
  const col = table.columns.findIndex((c) => c.id === columnId);
  if (!Number.isInteger(row) || row < 0 || row >= table.rows.length || col < 0)
    throw new Error('Unknown table cell');
  const next = {
    ...table,
    rows: table.rows.map((cells, i) =>
      i === row
        ? cells.map((cell, j) => (j === col ? value : cell))
        : [...cells]
    ),
  };
  validateDataTable(next);
  return next;
}
export interface CsvOptions {
  id?: string;
  delimiter?: ',' | ';' | '\t' | '|';
  encoding?: 'utf-8' | 'windows-1250';
}
/** No numeric or formula inference: conversion is an explicit cell edit. */
export function parseCsv(
  input: string | Uint8Array,
  options: CsvOptions = {}
): DataTable {
  if (input.length > TABLE_LIMITS.bytes)
    throw new Error('CSV exceeds size limit');
  if (options.encoding && !['utf-8', 'windows-1250'].includes(options.encoding))
    throw new Error('Unsupported CSV encoding');
  const text = (
    typeof input === 'string'
      ? input
      : new TextDecoder(options.encoding ?? 'utf-8', { fatal: true }).decode(
          input
        )
  ).replace(/^\uFEFF/, '');
  if (new TextEncoder().encode(text).length > TABLE_LIMITS.bytes)
    throw new Error('CSV exceeds size limit');
  const delimiter = options.delimiter ?? ',';
  if (![',', ';', '\t', '|'].includes(delimiter))
    throw new Error('Unsupported CSV delimiter');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    state: 'plain' | 'quoted' | 'closed' = 'plain';
  const pushCell = () => {
    if (row.length >= TABLE_LIMITS.columns) throw new Error('Too many columns');
    row.push(cell);
    cell = '';
    state = 'plain';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > TABLE_LIMITS.rows + 1) throw new Error('Too many rows');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else state = 'closed';
      } else cell += c;
    } else if (c === delimiter) pushCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else if (state === 'closed')
      throw new Error('Unexpected text after CSV quote');
    else if (c === '"') {
      if (cell) throw new Error('Unexpected CSV quote');
      state = 'quoted';
    } else cell += c;
    if (cell.length > TABLE_LIMITS.cellLength)
      throw new Error('CSV cell exceeds size limit');
  }
  if (state === 'quoted') throw new Error('Unclosed CSV quote');
  if (cell.length || row.length || state === 'closed') pushRow();
  if (!rows.length) throw new Error('CSV needs a header');
  const header = rows.shift()!;
  const table: DataTable = {
    id: options.id ?? crypto.randomUUID(),
    columns: header.map((label, i) => ({ id: `column-${i + 1}`, label })),
    rows,
  };
  validateDataTable(table);
  return table;
}
