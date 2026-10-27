import { describe, it, expect, vi } from 'vitest';
import { tableToObjects, mountDataPanel } from './data-panel';
import { chartToObjects } from './charts';
import { validateProject } from '../studio/project-validation';
import { parseCsv } from './table';
const table = {
  id: 't',
  columns: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', type: 'number' as const },
  ],
  rows: [
    ['<unsafe>', 1.5],
    [null, 2],
  ],
};
describe('editable data scene', () => {
  it('table is editable primitives with cell text and a stable group', () => {
    const objects = tableToObjects(table, { locale: 'cs-CZ' }, 'group');
    expect(objects.filter((o) => o.kind === 'text').map((o) => o.text)).toEqual(
      ['A', 'B', '<unsafe>', '1,5', '', '2']
    );
    expect(objects.every((o) => o.groupId === 'group')).toBe(true);
    validateProject({
      version: 1,
      name: 't',
      pages: [
        {
          id: 'p',
          name: 'p',
          width: 640,
          height: 400,
          background: '#ffffff',
          objects,
        },
      ],
    });
  });
  it('refuses table scene exceeding bounds rather than silently truncating rows', () => {
    expect(() =>
      tableToObjects({
        ...table,
        rows: Array.from({ length: 501 }, () => ['a', 1]),
      })
    ).toThrow();
  });
  for (const type of ['bar', 'line', 'pie', 'scatter'] as const)
    it(type + ' produces legal editable scene objects', () => {
      const objects = chartToObjects(table, {
        id: 'c',
        type,
        tableId: 't',
        labelColumnId: 'a',
        valueColumnIds: ['b'],
        legend: true,
      });
      validateProject({
        version: 1,
        name: 't',
        pages: [
          {
            id: 'p',
            name: 'p',
            width: 640,
            height: 400,
            background: '#ffffff',
            objects,
          },
        ],
      });
    });
  it('panel commits literal cells, reports invalid numeric cells, and removes listeners', () => {
    const container = document.createElement('div');
    let current = structuredClone(table);
    const error = vi.fn(),
      commit = vi.fn((t) => {
        current = t;
      });
    const dispose = mountDataPanel(container, {
      getTable: () => current,
      onTableChange: commit,
      onError: error,
      labels: {
        cell: 'Cell',
        previous: 'Previous',
        next: 'Next',
        page: 'Page',
      },
    });
    const inputs = container.querySelectorAll('input');
    inputs[0].value = '=1+2';
    inputs[0].dispatchEvent(new Event('change'));
    expect(current.rows[0][0]).toBe('=1+2');
    const number = container.querySelectorAll('input')[1];
    number.value = 'NaN';
    number.dispatchEvent(new Event('change'));
    expect(error).toHaveBeenCalledOnce();
    expect(current.rows[0][1]).toBe(1.5);
    dispose();
    expect(container.children.length).toBe(0);
  });
  it('CSV refuses UTF8 invalid bytes and malicious field delimiters', () => {
    expect(() => parseCsv(new Uint8Array([0xff]))).toThrow();
    expect(() => parseCsv('a,b', { delimiter: '"' as ',' })).toThrow();
  });
});

describe('review regressions: Unicode and rotated overflow', () => {
  it.each(['a'.repeat(299) + '😀', '😀'.repeat(160), 'ordinary label'])(
    'keeps chart primitive names valid within 300 UTF16 units: %s',
    (label) => {
      const data = { ...table, rows: [[label, 1.5]] };
      const objects = chartToObjects(data, {
        id: 'c',
        type: 'bar',
        tableId: 't',
        labelColumnId: 'a',
        valueColumnIds: ['b'],
      });
      expect(objects.every((o) => o.name.length <= 300)).toBe(true);
      validateProject({
        version: 1,
        name: 'Test',
        pages: [
          {
            id: 'p',
            name: 'Page',
            width: 640,
            height: 400,
            background: '#ffffff',
            objects,
          },
        ],
      });
      const names = objects.filter((o) => o.kind === 'text').map((o) => o.name);
      expect(
        names.some(
          (name) =>
            name ===
            [...label].reduce(
              (s, c) => (s.length + c.length <= 300 ? s + c : s),
              ''
            )
        )
      ).toBe(true);
    }
  );
});

describe('data panel keyboard focus regression', () => {
  it('commits a numeric draft without detaching the focused field or its next tab target', () => {
    const container = document.createElement('div');
    document.body.append(container);
    let current = structuredClone(table);
    const onError = vi.fn(),
      onTableChange = vi.fn((value) => {
        current = value;
      });
    const dispose = mountDataPanel(container, {
      getTable: () => current,
      onTableChange,
      onError,
      labels: {
        cell: 'Cell',
        previous: 'Previous',
        next: 'Next',
        page: 'Page',
      },
    });
    try {
      const fields = container.querySelectorAll('input'),
        numeric = fields[1],
        next = fields[2];
      numeric.focus();
      numeric.value = '42';
      numeric.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onTableChange).not.toHaveBeenCalled();
      numeric.dispatchEvent(new Event('change', { bubbles: true }));
      expect(current.rows[0][1]).toBe(42);
      expect(onTableChange).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(numeric);
      expect(container.querySelectorAll('input')[1]).toBe(numeric);
      expect(container.querySelectorAll('input')[2]).toBe(next);
      expect(next.isConnected).toBe(true);
      next.focus();
      expect(document.activeElement).toBe(next);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      dispose();
      container.remove();
    }
  });
});
