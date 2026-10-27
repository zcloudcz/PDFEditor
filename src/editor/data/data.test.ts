import { describe, it, expect } from 'vitest';
import { parseCsv, validateDataTable, setCell } from './table';
import { renderChartSvg } from './charts';
import { generateVariants, previewVariants } from './bulk-create';
import type { StudioProject } from '../studio/types';
const csv = 'Name;Value\r\n"A;B";1,5\r\n"line\nnext";=SUM(A1)';
const table = {
  id: 't',
  columns: [
    { id: 'name', label: 'Name' },
    { id: 'value', label: 'Value' },
  ],
  rows: [
    ['<script>', 1.5],
    ['B', null],
    ['L'.repeat(200), -2],
  ],
};
const project: StudioProject = {
  version: 1,
  name: 'Test',
  pages: [
    {
      id: 'p',
      name: 'Page',
      width: 300,
      height: 200,
      background: '#ffffff',
      objects: [
        {
          id: 'o',
          kind: 'text',
          name: 'Text',
          x: 0,
          y: 0,
          width: 20,
          height: 10,
          rotation: 0,
          opacity: 1,
          fill: '#000000',
          stroke: 'none',
          strokeWidth: 0,
          locked: false,
          text: 'original',
          fontSize: 12,
        },
      ],
    },
  ],
};
describe('bounded CSV and cells', () => {
  it('handles quoted delimiter/newlines and keeps formulas as text', () => {
    expect(parseCsv(csv, { delimiter: ';', id: 't' }).rows).toEqual([
      ['A;B', '1,5'],
      ['line\nnext', '=SUM(A1)'],
    ]);
  });
  it('rejects malformed quotes/row width/oversize cells', () => {
    for (const value of [
      'a,b\n1',
      'a\n"bad',
      'a\n"x"junk',
      'a\nx'.padEnd(10020, 'x'),
    ])
      expect(() => parseCsv(value)).toThrow();
  });
  it('rejects nonfinite values and duplicate columns', () => {
    expect(() => validateDataTable({ ...table, rows: [[1, NaN]] })).toThrow();
    expect(() =>
      validateDataTable({
        ...table,
        columns: [
          { id: 'x', label: 'A' },
          { id: 'x', label: 'B' },
        ],
      })
    ).toThrow();
  });
  it('cell update is immutable and validates index', () => {
    expect(setCell(table, 0, 'value', 2).rows[0][1]).toBe(2);
    expect(table.rows[0][1]).toBe(1.5);
    expect(() => setCell(table, 99, 'value', 2)).toThrow();
  });
  it('decodes Windows1250 explicitly', () => {
    expect(
      parseCsv(new Uint8Array([0x4a, 0x6d, 0xe9, 0x6e, 0x6f, 10, 0x8e]), {
        encoding: 'windows-1250',
      }).rows[0][0]
    ).toBe('Ž');
  });
});
describe('durable vector chart specs', () => {
  for (const type of ['bar', 'line', 'scatter'] as const)
    it(type + ' escapes labels and skips missing numbers', () => {
      const svg = renderChartSvg(table, {
        id: 'c',
        type,
        tableId: 't',
        labelColumnId: 'name',
        valueColumnIds: ['value'],
        locale: 'cs-CZ',
        legend: true,
        xAxisLabel: '<X>',
        yAxisLabel: 'Y',
      });
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).not.toMatch(/NaN|Infinity|<script>/);
      expect(svg).toContain('1,5');
      expect(svg).toContain('&lt;X&gt;');
    });
  it('pie handles full circle and rejects negative values', () => {
    expect(
      renderChartSvg(
        { ...table, rows: [['Only', 4]] },
        {
          id: 'c',
          type: 'pie',
          tableId: 't',
          labelColumnId: 'name',
          valueColumnIds: ['value'],
        }
      )
    ).toContain('<circle');
    expect(() =>
      renderChartSvg(table, {
        id: 'c',
        type: 'pie',
        tableId: 't',
        labelColumnId: 'name',
        valueColumnIds: ['value'],
      })
    ).toThrow();
  });
  it('rejects numeric strings/NaN rather than guessing a locale', () => {
    expect(() =>
      renderChartSvg(
        { ...table, rows: [['A', '1,5']] },
        {
          id: 'c',
          type: 'bar',
          tableId: 't',
          labelColumnId: 'name',
          valueColumnIds: ['value'],
        }
      )
    ).toThrow();
  });
});
describe('local bulk variants', () => {
  const bindings = [
    { pageId: 'p', objectId: 'o', columnId: 'name', kind: 'text' as const },
  ];
  it('generates isolated variants split at 200 pages and reports overflow', async () => {
    const data = {
      ...table,
      rows: Array.from({ length: 201 }, () => ['Very long value', 1]),
    };
    const result = [];
    for await (const batch of generateVariants(
      project,
      data,
      bindings,
      new AbortController().signal
    ))
      result.push(batch);
    expect(result.map((p) => p.pages.length)).toEqual([200, 1]);
    expect(new Set(result[0].pages.map((p) => p.objects[0].id)).size).toBe(200);
    expect(project.pages[0].objects[0].text).toBe('original');
    expect(
      previewVariants(project, data, bindings).overflow.length
    ).toBeGreaterThan(0);
  });
  it('cancels between rows without exposing partial batches', async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      generateVariants(project, table, bindings, c.signal).next()
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('refuses stale bindings and unapproved remote image sources', async () => {
    await expect(
      generateVariants(
        project,
        table,
        [{ ...bindings[0], objectId: 'missing' }],
        new AbortController().signal
      ).next()
    ).rejects.toThrow();
    await expect(
      generateVariants(
        project,
        table,
        [{ ...bindings[0], kind: 'image' }],
        new AbortController().signal
      ).next()
    ).rejects.toThrow();
  });
});

// Resource and snapshot regressions use small explicit limits, never allocate huge fixtures.
describe('variant limits and image bindings', () => {
  const bindings = [
    { pageId: 'p', objectId: 'o', columnId: 'name', kind: 'text' as const },
  ];
  it('splits on object budget and enforces byte budget', async () => {
    const batches = [];
    for await (const p of generateVariants(
      project,
      table,
      bindings,
      new AbortController().signal,
      { maxObjects: 1 }
    ))
      batches.push(p);
    expect(batches).toHaveLength(3);
    await expect(
      generateVariants(project, table, bindings, new AbortController().signal, {
        maxBytes: 10,
      }).next()
    ).rejects.toThrow();
  });
  it('cancels after a yielded batch before starting another', async () => {
    const c = new AbortController(),
      g = generateVariants(project, table, bindings, c.signal, { maxPages: 1 });
    expect((await g.next()).value.pages).toHaveLength(1);
    c.abort();
    await expect(g.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('refuses image object replacement without approved locally embedded assets', async () => {
    const imageProject = structuredClone(project);
    imageProject.pages[0].objects[0] = {
      ...imageProject.pages[0].objects[0],
      kind: 'image',
      src: 'data:image/png;base64,iVBORw0KGgo=',
    };
    const data = { ...table, rows: [['https://example.com/image.png', 1]] };
    await expect(
      generateVariants(
        imageProject,
        data,
        [{ ...bindings[0], kind: 'image' }],
        new AbortController().signal
      ).next()
    ).rejects.toThrow();
    const good = {
      id: 'approved',
      src: 'data:image/png;base64,iVBORw0KGgo=',
      width: 1,
      height: 1,
      exifOrientation: 1,
      provenance: {
        kind: 'local-upload' as const,
        license: 'unspecified' as const,
        source: 'local upload' as const,
      },
    };
    const result = await generateVariants(
      imageProject,
      { ...data, rows: [['approved', 1]] },
      [{ ...bindings[0], kind: 'image' }],
      new AbortController().signal,
      { assets: [good] }
    ).next();
    expect(result.value.pages[0].objects[0].src).toBe(good.src);
  });
  it('refuses an accumulated oversize table before a full JSON serialization', () => {
    const huge = {
      ...table,
      rows: Array.from({ length: 600 }, () => ['x'.repeat(10000), 1]),
    };
    const original = JSON.stringify;
    let called = false;
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
      called = true;
      return original(...args);
    }) as typeof JSON.stringify;
    try {
      expect(() => validateDataTable(huge)).toThrow();
      expect(called).toBe(false);
    } finally {
      JSON.stringify = original;
    }
  });
});

describe('bulk data provenance', () => {
  it('rekeys chart/table IDs with their scene groups in each variant and each batch', async () => {
    const template = {
      ...structuredClone(project),
      dataTables: [structuredClone(table)],
      dataCharts: [
        {
          id: 'chart',
          type: 'bar' as const,
          tableId: 't',
          labelColumnId: 'name',
          valueColumnIds: ['value'],
        },
      ],
    };
    template.pages[0].objects.push(
      {
        ...template.pages[0].objects[0],
        id: 'cell',
        groupId: 't',
        text: 'cell',
      },
      {
        ...template.pages[0].objects[0],
        id: 'mark',
        groupId: 'chart',
        text: 'mark',
      }
    );
    const batches = [];
    for await (const p of generateVariants(
      template,
      table,
      [{ pageId: 'p', objectId: 'o', columnId: 'name', kind: 'text' }],
      new AbortController().signal,
      { maxPages: 2 }
    ))
      batches.push(p as typeof template);
    expect(batches[0].dataTables).toHaveLength(2);
    expect(batches[0].dataCharts).toHaveLength(2);
    expect(batches[0].dataCharts[0].tableId).toBe(batches[0].dataTables[0].id);
    expect(batches[0].pages[0].objects[1].groupId).toBe(
      batches[0].dataTables[0].id
    );
    expect(batches[0].pages[0].objects[2].groupId).toBe(
      batches[0].dataCharts[0].id
    );
    expect(batches[0].dataTables[0].id).not.toBe(batches[0].dataTables[1].id);
  });
});

describe('chart finite geometry and display bounds', () => {
  it('keeps extreme finite magnitudes finite in the SVG', () => {
    expect(
      renderChartSvg(
        {
          ...table,
          rows: [
            ['a', Number.MAX_VALUE],
            ['b', -Number.MAX_VALUE],
          ],
        },
        {
          id: 'c',
          type: 'line',
          tableId: 't',
          labelColumnId: 'name',
          valueColumnIds: ['value'],
        }
      )
    ).not.toMatch(/Infinity|NaN/);
  });
  it('limits crowded pie legends explicitly and honors legend=false', () => {
    const t = {
      ...table,
      rows: Array.from({ length: 19 }, (_, i) => ['A' + i, i + 1]),
    };
    expect(() =>
      renderChartSvg(t, {
        id: 'c',
        type: 'pie',
        tableId: 't',
        labelColumnId: 'name',
        valueColumnIds: ['value'],
        legend: true,
      })
    ).toThrow();
    expect(
      renderChartSvg(t, {
        id: 'c',
        type: 'pie',
        tableId: 't',
        labelColumnId: 'name',
        valueColumnIds: ['value'],
        legend: false,
      })
    ).not.toContain('<text');
  });
  it('does not allow empty ids or illegal XML controls in labels', () => {
    for (const patch of [{ id: '' }, { xAxisLabel: 'bad\u0000label' }])
      expect(() =>
        renderChartSvg(table, {
          id: 'c',
          type: 'bar',
          tableId: 't',
          labelColumnId: 'name',
          valueColumnIds: ['value'],
          ...patch,
        })
      ).toThrow();
  });
});

describe('bulk serialized schema limits', () => {
  it('splits before the project table count limit', async () => {
    const template = {
      ...structuredClone(project),
      dataTables: [structuredClone(table)],
    };
    const rows = {
      ...table,
      rows: Array.from({ length: 21 }, () => ['variant', 1]),
    };
    const batches = [];
    for await (const p of generateVariants(
      template,
      rows,
      [{ pageId: 'p', objectId: 'o', columnId: 'name', kind: 'text' }],
      new AbortController().signal
    ))
      batches.push(p);
    expect(batches.map((p) => p.pages.length)).toEqual([20, 1]);
  });
});

describe('review regression: rotated variant overflow', () => {
  it.each([
    { rotation: 90, x: 0, y: 30, outside: true },
    { rotation: 45, x: 0, y: 30, outside: true },
    { rotation: 90, x: 40, y: 30, outside: false },
    { rotation: 45, x: 40, y: 30, outside: false },
    { rotation: 0, x: 0, y: 30, outside: false },
  ])(
    'checks visible bounds $rotation degrees at $x',
    ({ rotation, x, y, outside }) => {
      const template = structuredClone(project);
      Object.assign(template.pages[0].objects[0], {
        x,
        y,
        width: 20,
        height: 80,
        rotation,
      });
      const result = previewVariants(
        template,
        table,
        [{ pageId: 'p', objectId: 'o', columnId: 'name', kind: 'text' }],
        { count: 1 }
      );
      expect(
        result.overflow.some((issue) => issue.reason === 'outside-page')
      ).toBe(outside);
    }
  );
});
