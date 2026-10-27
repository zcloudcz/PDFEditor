import type { StudioObject } from '../studio/types';
import { validateDataTable, type DataTable } from './table';
export interface ChartSpec {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'scatter';
  tableId: string;
  labelColumnId: string;
  valueColumnIds: string[];
  xColumnId?: string;
  locale?: string;
  legend?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
}
const palette = [
  '#2563eb',
  '#db2777',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
];
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!
  );
const short = (s: string) =>
  [...s].length > 24 ? [...s].slice(0, 23).join('') + '…' : s;
export function validateChartSpec(
  value: unknown,
  table?: DataTable
): asserts value is ChartSpec {
  const s = value as ChartSpec;
  if (
    !s ||
    typeof s.id !== 'string' ||
    !s.id ||
    s.id.length > 200 ||
    !['bar', 'line', 'pie', 'scatter'].includes(s.type) ||
    typeof s.tableId !== 'string' ||
    !s.tableId ||
    s.tableId.length > 200 ||
    typeof s.labelColumnId !== 'string' ||
    !s.labelColumnId ||
    !Array.isArray(s.valueColumnIds) ||
    !s.valueColumnIds.length ||
    s.valueColumnIds.length > 6 ||
    new Set(s.valueColumnIds).size !== s.valueColumnIds.length ||
    s.valueColumnIds.some(
      (id) => typeof id !== 'string' || !id || id.length > 200
    )
  )
    throw new Error('Invalid chart specification');
  if (
    Object.keys(s).some(
      (k) =>
        ![
          'id',
          'type',
          'tableId',
          'labelColumnId',
          'valueColumnIds',
          'xColumnId',
          'locale',
          'legend',
          'xAxisLabel',
          'yAxisLabel',
        ].includes(k)
    )
  )
    throw new Error('Unsupported chart field');
  for (const key of [
    'id',
    'xColumnId',
    'locale',
    'xAxisLabel',
    'yAxisLabel',
  ] as const)
    if (
      s[key] !== undefined &&
      (typeof s[key] !== 'string' ||
        s[key]!.length > 200 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s[key]!))
    )
      throw new Error('Invalid chart label');
  if (s.legend !== undefined && typeof s.legend !== 'boolean')
    throw new Error('Invalid chart legend');
  if (s.locale !== undefined) new Intl.NumberFormat(s.locale);
  if (s.type === 'pie' && s.valueColumnIds.length !== 1)
    throw new Error('Pie requires one series');
  if (table) {
    validateDataTable(table);
    const ids = table.columns.map((c) => c.id);
    if (
      table.id !== s.tableId ||
      !ids.includes(s.labelColumnId) ||
      s.valueColumnIds.some((id) => !ids.includes(id)) ||
      (s.xColumnId !== undefined && !ids.includes(s.xColumnId))
    )
      throw new Error('Missing chart column');
  }
}
export function dataPrimitive(
  kind: StudioObject['kind'],
  groupId: string,
  props: Partial<StudioObject>
): StudioObject {
  return {
    id: crypto.randomUUID(),
    kind,
    name: 'Data',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: 1,
    fill: '#000000',
    stroke: 'none',
    strokeWidth: 0,
    locked: false,
    groupId,
    ...props,
  };
}
/** Editable grouped primitives; authoritative data/spec remain separately serialized. */
export function chartToObjects(
  table: DataTable,
  spec: ChartSpec,
  groupId: string = spec.id
): StudioObject[] {
  validateChartSpec(spec, table);
  if (table.rows.length > 200)
    throw new Error('Chart supports at most 200 rows');
  const out: StudioObject[] = [];
  const add = (kind: StudioObject['kind'], p: Partial<StudioObject>) =>
    out.push(dataPrimitive(kind, groupId, p));
  const text = (value: string, x: number, y: number, width = 95) =>
    add('text', {
      text: short(value),
      name: value.slice(0, 300).replace(/[\uD800-\uDBFF]$/, ''),
      x,
      y,
      width,
      height: 18,
      fontSize: 11,
      fontFamily: 'Liberation Sans',
      fill: '#111827',
    });
  const column = (id: string) => table.columns.findIndex((c) => c.id === id);
  const label = column(spec.labelColumnId),
    series = spec.valueColumnIds.map(column);
  const numeric = (cell: unknown): number | null => {
    if (cell === null) return null;
    if (typeof cell !== 'number' || !Number.isFinite(cell))
      throw new Error('Chart values must be finite numbers or null');
    return cell;
  };
  const values = series.map((c) => table.rows.map((row) => numeric(row[c])));
  const format = new Intl.NumberFormat(spec.locale ?? 'en-US', {
    maximumFractionDigits: 3,
  });
  const caption = (s: string, x: number, y: number, w?: number) =>
    text(s, x, y, w);
  if (spec.type === 'pie') {
    if (spec.legend !== false && table.rows.length > 18)
      throw new Error('Pie legend supports at most 18 rows');
    const v = values[0];
    if (v.some((n) => n !== null && n < 0))
      throw new Error('Pie values must be nonnegative');
    const scale = Math.max(0, ...v.map((n) => n ?? 0));
    const total = scale
      ? v.reduce<number>((sum, n) => sum + (n ?? 0) / scale, 0)
      : 0;
    let angle = -Math.PI / 2;
    v.forEach((n, i) => {
      if (!n || !total) return;
      const fraction = n / scale / total,
        color = palette[i % palette.length];
      if (fraction >= 1 - 1e-12)
        add('ellipse', { x: 165, y: 40, width: 260, height: 260, fill: color });
      else {
        const end = angle + fraction * 2 * Math.PI;
        const p = (a: number) =>
          `${50 + 50 * Math.cos(a)} ${50 + 50 * Math.sin(a)}`;
        add('path', {
          x: 165,
          y: 40,
          width: 260,
          height: 260,
          fill: color,
          path: `M50 50 L${p(angle)} A50 50 0 ${fraction > 0.5 ? 1 : 0} 1 ${p(end)} Z`,
        });
        angle = end;
      }
      if (spec.legend !== false)
        caption(
          `${String(table.rows[i][label] ?? '')}: ${format.format(n)}`,
          435,
          40 + i * 18,
          195
        );
    });
  } else {
    const maxAbs = Math.max(1, ...values.flat().map((v) => Math.abs(v ?? 0)));
    const scaled = values
      .flat()
      .filter((v): v is number => v !== null)
      .map((v) => v / maxAbs);
    const lo = Math.min(0, ...scaled),
      hi = Math.max(0, ...scaled),
      span = hi - lo || 1;
    const y = (n: number) => 310 - ((n / maxAbs - lo) / span) * 260;
    add('line', {
      x: 70,
      y: 50,
      width: 0.01,
      height: 260,
      fill: 'none',
      stroke: '#374151',
      strokeWidth: 1,
    });
    add('line', {
      x: 70,
      y: y(0),
      width: 480,
      height: 0.01,
      fill: 'none',
      stroke: '#374151',
      strokeWidth: 1,
    });
    caption(format.format(lo * maxAbs), 0, 300);
    caption(format.format(hi * maxAbs), 0, 40);
    const xs = spec.xColumnId
      ? table.rows.map((row) => numeric(row[column(spec.xColumnId!)]))
      : table.rows.map((_, i) => i);
    const xm = Math.max(1, ...xs.map((n) => Math.abs(n ?? 0))),
      xl = Math.min(0, ...xs.map((n) => (n ?? 0) / xm)),
      xh = Math.max(1 / xm, ...xs.map((n) => (n ?? 0) / xm));
    const x = (i: number) =>
      spec.type === 'scatter'
        ? 70 + (((xs[i] ?? 0) / xm - xl) / (xh - xl)) * 480
        : 70 + ((i + 0.5) / Math.max(1, table.rows.length)) * 480;
    values.forEach((v, s) => {
      let previous: { x: number; y: number } | undefined;
      v.forEach((n, i) => {
        if (n === null || (spec.type === 'scatter' && xs[i] === null)) {
          previous = undefined;
          return;
        }
        const px = x(i),
          py = y(n),
          color = palette[s];
        if (spec.type === 'bar') {
          const w = 440 / Math.max(1, table.rows.length) / series.length;
          add('rect', {
            x: px - 220 / Math.max(1, table.rows.length) + s * w,
            y: Math.min(py, y(0)),
            width: w * 0.9,
            height: Math.max(0.01, Math.abs(y(0) - py)),
            fill: color,
          });
        } else {
          if (spec.type === 'line' && previous)
            add('path', {
              x: 70,
              y: 50,
              width: 480,
              height: 260,
              path: `M${(previous.x - 70) / 4.8} ${(previous.y - 50) / 2.6} L${(px - 70) / 4.8} ${(py - 50) / 2.6}`,
              fill: 'none',
              stroke: color,
              strokeWidth: 1.5,
            });
          add('ellipse', {
            x: px - 3,
            y: py - 3,
            width: 6,
            height: 6,
            fill: color,
          });
          previous = { x: px, y: py };
        }
        if (table.rows.length <= 10)
          caption(format.format(n), px - 12, py - 20, 90);
      });
    });
    const step = Math.max(1, Math.ceil(table.rows.length / 6));
    table.rows.forEach((row, i) => {
      if (i % step === 0)
        caption(String(row[label] ?? ''), x(i) - 25, 320, 100);
    });
    if (spec.legend)
      series.forEach((c, i) => {
        const x = 70 + (i % 3) * 180,
          y = 360 + Math.floor(i / 3) * 18;
        add('rect', { x, y: y + 5, width: 10, height: 10, fill: palette[i] });
        caption(table.columns[c].label, x + 15, y, 155);
      });
  }
  if (spec.xAxisLabel) caption(spec.xAxisLabel, 245, 340, 200);
  if (spec.yAxisLabel) caption(spec.yAxisLabel, 5, 15, 180);
  return out;
}
export function renderChartSvg(table: DataTable, spec: ChartSpec): string {
  const objects = chartToObjects(table, spec);
  const body = objects
    .map((o) => {
      const attrs = `fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.strokeWidth}"`;
      if (o.kind === 'text')
        return `<text x="${o.x}" y="${o.y + 12}" font-size="11"><title>${escape(o.name)}</title>${escape(o.text ?? '')}</text>`;
      if (o.kind === 'line')
        return `<line x1="${o.x}" y1="${o.y}" x2="${o.x + o.width}" y2="${o.y + o.height}" ${attrs}/>`;
      if (o.kind === 'path')
        return `<path d="${o.path}" transform="translate(${o.x} ${o.y}) scale(${o.width / 100} ${o.height / 100})" ${attrs}/>`;
      if (o.kind === 'ellipse')
        return o.width === o.height
          ? `<circle cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" r="${o.width / 2}" ${attrs}/>`
          : `<ellipse cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" ${attrs}/>`;
      return `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" ${attrs}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400" role="img"><title>${escape(spec.id ?? 'Chart')}</title>${body}</svg>`;
}
