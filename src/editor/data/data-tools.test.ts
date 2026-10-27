import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { Blob as NodeBlob } from 'node:buffer';
import { setupDataTools } from './data-tools';
import { tableToObjects } from './data-panel';
import { chartToObjects, dataPrimitive } from './charts';
import {
  parsePortableProject,
  serializePortableProject,
} from '../studio/project-io';
import type { StudioProject } from '../studio/types';
import type { LayoutToolsApi } from '../studio/layout-tools';
const fixture = (): StudioProject => ({
  version: 1,
  name: 'Data',
  pages: [
    {
      id: 'p',
      name: 'Page',
      width: 900,
      height: 700,
      background: '#ffffff',
      objects: [],
    },
  ],
  dataTables: [
    {
      id: 'dataset',
      columns: [
        { id: 'name', label: 'Jméno' },
        { id: 'amount', label: 'Částka', type: 'number' },
      ],
      rows: [
        ['First', 12],
        ['=SUM(A1)', 7],
      ],
    },
  ],
  dataCharts: [
    {
      id: 'chart',
      tableId: 'dataset',
      type: 'bar',
      labelColumnId: 'name',
      valueColumnIds: ['amount'],
      legend: true,
    },
  ],
});
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label
  )!;
const input = (label: string) =>
  [...document.querySelectorAll<HTMLInputElement>('label input')].find(
    (i) => i.parentElement?.textContent === label
  )!;
const select = (label: string) =>
  document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const cell = (label: string, value: string) => {
  const el = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`
  )!;
  el.value = value;
  el.dispatchEvent(new Event('change'));
};
function harness(source = fixture()) {
  let current = structuredClone(source),
    revision = 1,
    action = () => {},
    dispose: (() => void) | void;
  const body = document.createElement('div');
  document.body.append(body);
  const api: LayoutToolsApi = {
    t: (s) => s,
    registerDocumentAction: vi.fn((_label, fn) => {
      action = fn;
      return document.createElement('button');
    }),
    mountDocumentPanel: (_title, mount) => {
      dispose = mount(body, () => {
        if (typeof dispose === 'function') dispose();
      });
    },
    readProjectSnapshot: vi.fn(async () => ({
      project: structuredClone(current),
      revision,
      view: { pageId: 'p', selectedIds: [] },
    })),
    runProjectOperation: vi.fn(async (_label, prepare, expected, signal) => {
      if (expected !== revision || signal?.aborted) throw new Error('Stale');
      const next = await prepare(structuredClone(current), signal!);
      if (signal?.aborted) throw new Error('Cancelled');
      current = next;
      revision++;
    }),
    setLayoutGuides: vi.fn(),
    readPdfSnapshot: vi.fn(),
    runPdfOperation: vi.fn(),
  };
  setupDataTools(api);
  return {
    api,
    open: action,
    close: () => {
      if (typeof dispose === 'function') dispose();
    },
    get: () => current,
    stale: () => revision++,
  };
}
beforeEach(() => {
  document.body.replaceChildren();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
describe('shared data tools actual UI', () => {
  it('stages cell edits, asks before replacing customized primitives, and saves editable scene plus data', async () => {
    const source = fixture();
    source.pages[0].objects = [
      ...tableToObjects(source.dataTables![0], { x: 40, y: 30, width: 350 }),
      ...chartToObjects(source.dataTables![0], source.dataCharts![0]),
    ];
    const h = harness(source);
    h.open();
    await settle();
    cell('Buňka 1: Částka', '42');
    expect(h.get().dataTables![0].rows[0][1]).toBe(12);
    button('Použít').click();
    await settle();
    expect(h.api.runProjectOperation).not.toHaveBeenCalled();
    input('Potvrdit nahrazení ručních úprav').checked = true;
    input('Povolit přesah stránky').checked = true;
    button('Použít').click();
    await settle();
    expect(h.get().dataTables![0].rows[0][1]).toBe(42);
    const saved = await parsePortableProject(
      await serializePortableProject(h.get())
    );
    expect(saved.dataCharts![0].id).toBe('chart');
    expect(saved.dataTables![0].rows[1][0]).toBe('=SUM(A1)');
    const cells = saved.pages[0].objects.filter((o) => o.groupId === 'dataset');
    expect(cells.some((o) => o.text === '42')).toBe(true);
    expect(Math.min(...cells.map((o) => o.x))).toBe(40);
    expect(
      saved.pages[0].objects.some(
        (o) => o.groupId === 'chart' && o.text === '42'
      )
    ).toBe(true);
    expect(h.api.runProjectOperation).toHaveBeenCalledTimes(1);
  });
  it('cancel and stale Apply leave the current document untouched', async () => {
    const h = harness();
    h.open();
    await settle();
    cell('Buňka 1: Jméno', 'discard');
    button('Zrušit').click();
    expect(h.get()).toEqual(fixture());
    h.open();
    await settle();
    cell('Buňka 1: Jméno', 'stale');
    h.stale();
    button('Použít').click();
    await settle();
    expect(h.get()).toEqual(fixture());
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('imports literal CSV and converts numeric columns explicitly without formula evaluation', async () => {
    const h = harness({ ...fixture(), dataTables: [], dataCharts: [] });
    h.open();
    await settle();
    const file = input('Importovat CSV');
    Object.defineProperty(file, 'files', {
      value: [
        {
          size: 30,
          arrayBuffer: async () =>
            new TextEncoder().encode('Name;Value\n=SUM(A1);12.5').buffer,
        },
      ],
    });
    select('Oddělovač CSV').value = ';';
    button('Načíst CSV').click();
    await settle();
    expect(h.get().dataTables).toEqual([]);
    const numeric = select('Číselné sloupce');
    numeric.options[1].selected = true;
    button('Převést vybrané sloupce na čísla').click();
    button('Použít').click();
    await settle();
    expect(h.get().dataTables![0].rows).toEqual([['=SUM(A1)', 12.5]]);
  });
  it('rejects invalid numeric conversion without changing the imported cells', async () => {
    const h = harness();
    h.open();
    await settle();
    const numeric = select('Číselné sloupce');
    numeric.options[0].selected = true;
    button('Převést vybrané sloupce na čísla').click();
    expect(h.get()).toEqual(fixture());
    expect(document.body.textContent).toContain('Číselné hodnoty vyžadují');
  });
  it('creates selectable chart primitives with authoritative durable settings', async () => {
    const h = harness();
    h.open();
    await settle();
    const values = select('Číselné řady');
    values.options[1].selected = true;
    select('Typ grafu').value = 'line';
    button('Připravit graf').click();
    input('Potvrdit nahrazení ručních úprav').checked = true;
    input('Povolit přesah stránky').checked = true;
    button('Použít').click();
    await settle();
    const saved = await parsePortableProject(
      await serializePortableProject(h.get())
    );
    const spec = saved.dataCharts!.find((c) => c.id !== 'chart')!;
    expect(spec.type).toBe('line');
    expect(
      saved.pages[0].objects
        .filter((o) => o.groupId === spec.id)
        .some((o) => o.kind === 'path')
    ).toBe(true);
  });
  it('never mounts late controls after disposal during snapshot acquisition', async () => {
    const h = harness();
    let done!: (
      value: Awaited<ReturnType<LayoutToolsApi['readProjectSnapshot']>>
    ) => void;
    vi.mocked(h.api.readProjectSnapshot).mockReturnValueOnce(
      new Promise((resolve) => {
        done = resolve;
      })
    );
    h.open();
    h.close();
    done({
      project: fixture(),
      revision: 1,
      view: { pageId: 'p', selectedIds: [] },
    });
    await settle();
    expect(document.querySelector('input')).toBeNull();
  });
  it('previews bindings and exports separate portable projects without applying them to the document', async () => {
    const source = fixture();
    const object = dataPrimitive('text', '', {
      name: 'Recipient',
      text: 'Template',
      width: 400,
      height: 50,
      fontFamily: 'Liberation Sans',
      fontSize: 12,
    });
    delete object.groupId;
    source.pages[0].objects.push(object);
    const h = harness(source);
    h.open();
    await settle();
    const binding = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Vazby CSV: Recipient"]'
    )!;
    binding.value = 'name';
    button('Náhled prvních variant').click();
    expect(document.body.textContent).toContain('=SUM(A1)');
    vi.stubGlobal('Blob', NodeBlob);
    button('Exportovat dávky ZIP').click();
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = vi.mocked(URL.createObjectURL).mock
      .calls[0][0] as unknown as NodeBlob;
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const files = Object.keys(zip.files);
    expect(files).toEqual(['project-1.json']);
    const reopened = await parsePortableProject(
      await zip.file(files[0])!.async('string')
    );
    expect(reopened.pages).toHaveLength(2);
    expect(reopened.pages[1].objects.some((o) => o.text === '=SUM(A1)')).toBe(
      true
    );
    expect(h.get()).toEqual(source);
    expect(h.api.runProjectOperation).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('cancels a ZIP during preflight without downloading a partial batch', async () => {
    const source = fixture();
    source.dataTables![0].rows = Array.from({ length: 100 }, (_, i) => [
      `Row ${i}`,
      i,
    ]);
    const object = dataPrimitive('text', '', {
      name: 'Recipient',
      text: 'Template',
      width: 400,
      height: 50,
      fontSize: 12,
    });
    delete object.groupId;
    source.pages[0].objects.push(object);
    const h = harness(source);
    h.open();
    await settle();
    document.querySelector<HTMLSelectElement>(
      'select[aria-label="Vazby CSV: Recipient"]'
    )!.value = 'name';
    button('Exportovat dávky ZIP').click();
    button('Zrušit export').click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Export byl zrušen.')
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(h.get()).toEqual(source);
  });
  it('regenerates changed data groups even after switching to another dataset', async () => {
    const source = fixture();
    source.pages[0].objects = tableToObjects(source.dataTables![0], {
      width: 800,
    });
    source.dataTables!.push({
      id: 'other',
      columns: [{ id: 'a', label: 'Other' }],
      rows: [['Untouched']],
    });
    const h = harness(source);
    h.open();
    await settle();
    cell('Buňka 1: Částka', '55');
    const dataset = select('Datová sada');
    dataset.value = 'other';
    dataset.dispatchEvent(new Event('change'));
    input('Potvrdit nahrazení ručních úprav').checked = true;
    button('Použít').click();
    await settle();
    expect(h.get().dataTables![0].rows[0][1]).toBe(55);
    expect(
      h
        .get()
        .pages[0].objects.some(
          (o) => o.groupId === 'dataset' && o.text === '55'
        )
    ).toBe(true);
  });
  it('reports newly created chart overflow instead of silently clipping a small page', async () => {
    const source = fixture();
    source.pages[0].width = 150;
    source.pages[0].height = 100;
    const h = harness(source);
    h.open();
    await settle();
    select('Číselné řady').options[1].selected = true;
    button('Připravit graf').click();
    input('Potvrdit nahrazení ručních úprav').checked = true;
    button('Použít').click();
    await settle();
    expect(document.body.textContent).toContain(
      'Datové objekty přesahují stránku.'
    );
    expect(h.api.runProjectOperation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(source);
  });
  it('restores customized table and chart primitives from unchanged source only after explicit acknowledgment and Apply', async () => {
    const source = fixture();
    source.pages[0].objects = [
      ...tableToObjects(source.dataTables![0], { width: 800 }),
      ...chartToObjects(source.dataTables![0], source.dataCharts![0]),
    ];
    source.pages[0].objects.find(
      (o) => o.groupId === 'dataset' && o.text === '12'
    )!.text = 'Manual table';
    source.pages[0].objects.find(
      (o) => o.groupId === 'chart' && o.text === '12'
    )!.text = 'Manual chart';
    const h = harness(source);
    h.open();
    await settle();
    button('Obnovit datové objekty').click();
    button('Použít').click();
    await settle();
    expect(h.api.runProjectOperation).not.toHaveBeenCalled();
    expect(h.get()).toEqual(source);
    input('Potvrdit nahrazení ručních úprav').checked = true;
    input('Povolit přesah stránky').checked = true;
    button('Použít').click();
    await settle();
    expect(h.api.runProjectOperation).toHaveBeenCalledTimes(1);
    expect(h.get().dataTables![0].rows[0][1]).toBe(12);
    expect(
      h
        .get()
        .pages[0].objects.some(
          (o) => o.text === 'Manual table' || o.text === 'Manual chart'
        )
    ).toBe(false);
    expect(
      h
        .get()
        .pages[0].objects.some(
          (o) => o.groupId === 'dataset' && o.text === '12'
        )
    ).toBe(true);
    expect(
      h
        .get()
        .pages[0].objects.some((o) => o.groupId === 'chart' && o.text === '12')
    ).toBe(true);
  });
  it('requires Apply before exporting staged data, then exports matching source and regenerated table/chart artwork', async () => {
    const source = fixture();
    const recipient = dataPrimitive('text', '', {
      name: 'Recipient',
      text: 'Template',
      width: 400,
      height: 50,
      fontSize: 12,
    });
    delete recipient.groupId;
    source.pages[0].objects = [
      recipient,
      ...tableToObjects(source.dataTables![0], { width: 800 }),
      ...chartToObjects(source.dataTables![0], source.dataCharts![0]),
    ];
    const h = harness(source);
    h.open();
    await settle();
    document.querySelector<HTMLSelectElement>(
      'select[aria-label="Vazby CSV: Recipient"]'
    )!.value = 'name';
    cell('Buňka 1: Částka', '42');
    vi.stubGlobal('Blob', NodeBlob);
    button('Exportovat dávky ZIP').click();
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      'Změny jsou připraveny. Potvrďte je tlačítkem Použít.'
    );
    expect(h.get()).toEqual(source);
    input('Potvrdit nahrazení ručních úprav').checked = true;
    input('Povolit přesah stránky').checked = true;
    button('Použít').click();
    await settle();
    document.querySelector<HTMLSelectElement>(
      'select[aria-label="Vazby CSV: Recipient"]'
    )!.value = 'name';
    input('Povolit přesah stránky').checked = true;
    button('Exportovat dávky ZIP').click();
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    );
    const blob = vi.mocked(URL.createObjectURL).mock
      .calls[0][0] as unknown as NodeBlob;
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const reopened = await parsePortableProject(
      await zip.file('project-1.json')!.async('string')
    );
    expect(reopened.dataTables![0].rows[0][1]).toBe(42);
    const firstPage = reopened.pages[0];
    expect(
      firstPage.objects.some(
        (o) => o.groupId === reopened.dataTables![0].id && o.text === '42'
      )
    ).toBe(true);
    expect(
      firstPage.objects.some(
        (o) => o.groupId === reopened.dataCharts![0].id && o.text === '42'
      )
    ).toBe(true);
    expect(firstPage.objects.some((o) => o.text === '12')).toBe(false);
    vi.unstubAllGlobals();
  });
});
