import JSZip from 'jszip';
import { t } from '../i18n';
import {
  panelButton,
  panelInput,
  panelCloseGuard,
} from '../pdf/standard-tools';
import type { LayoutToolsApi } from '../studio/layout-tools';
import type { StudioObject, StudioProject } from '../studio/types';
import { validateProject, base64Bytes } from '../studio/project-validation';
import { serializePortableProject } from '../studio/project-io';
import { encodedImageDimensions } from '../studio/image-effects';
import {
  validateEmbeddedImage,
  type EmbeddedImage,
} from '../studio/asset-library';
import { layoutText } from '../studio/text-layout';
import { mountDataPanel, tableToObjects } from './data-panel';
import {
  parseCsv,
  validateDataTable,
  TABLE_LIMITS,
  type DataTable,
} from './table';
import { chartToObjects, type ChartSpec } from './charts';
import {
  generateVariants,
  previewVariants,
  type DataBinding,
} from './bulk-create';

const MAX_ZIP = 100 * 1024 * 1024;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Shared-document UI. All data and scene changes remain staged until the revision-checked commit. */
export function setupDataTools(api: LayoutToolsApi): void {
  api.registerDocumentAction('Tabulky, grafy a CSV', () =>
    api.mountDocumentPanel('Tabulky, grafy a CSV', (body, close) => {
      const tr = api.t ?? t,
        guard = panelCloseGuard(body),
        lifetime = new AbortController();
      let disposed = false,
        busy = false,
        exportJob: AbortController | undefined,
        cleanupGrid: (() => void) | undefined;
      let snapshot: Awaited<ReturnType<LayoutToolsApi['readProjectSnapshot']>>;
      let draft: StudioProject,
        tableId = '',
        pageId = '',
        dirty = false;
      const changedTables = new Set<string>(),
        changedCharts = new Set<string>();
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      body.append(status);
      const fail = () => {
        if (!disposed) {
          status.setAttribute('role', 'alert');
          status.textContent = tr('Operace se nezdařila.');
        }
      };
      const report = (message: string) => {
        status.setAttribute('role', 'status');
        status.textContent = tr(message);
      };
      const changed = () => {
        dirty = true;
        report('Změny jsou připraveny. Potvrďte je tlačítkem Použít.');
      };
      const run = async (work: () => Promise<void>) => {
        if (busy || disposed) return;
        busy = true;
        guard.setBusy(true);
        const disabled = [
          ...body.querySelectorAll<
            HTMLInputElement | HTMLButtonElement | HTMLSelectElement
          >('input,button,select'),
        ].map((control) => ({ control, before: control.disabled }));
        for (const { control } of disabled)
          if (!control.hasAttribute('data-cancel-export'))
            control.disabled = true;
        try {
          await work();
        } catch {
          if (!lifetime.signal.aborted) fail();
        } finally {
          busy = false;
          guard.setBusy(false);
          for (const { control, before } of disabled) control.disabled = before;
        }
      };
      const button = (
        parent: HTMLElement,
        label: string,
        action: () => void
      ) => {
        const b = panelButton(
          label,
          () => {
            if (!disposed && !busy) action();
          },
          tr
        );
        parent.append(b);
        return b;
      };
      const select = (
        parent: HTMLElement,
        label: string,
        options: [string, string][],
        multiple = false
      ) => {
        const wrapper = document.createElement('label'),
          caption = document.createElement('span'),
          input = document.createElement('select');
        caption.textContent = tr(label);
        input.setAttribute('aria-label', tr(label));
        input.multiple = multiple;
        for (const [value, text] of options) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          input.append(option);
        }
        wrapper.append(caption, input);
        parent.append(wrapper);
        return input;
      };
      const checkbox = (
        parent: HTMLElement,
        label: string,
        checked = false
      ) => {
        const input = panelInput(parent, label, '', tr, 'checkbox');
        input.checked = checked;
        return input;
      };
      const table = () => draft.dataTables?.find((item) => item.id === tableId);
      const page = () => draft.pages.find((item) => item.id === pageId)!;
      const assets = (): EmbeddedImage[] => {
        const out: EmbeddedImage[] = [];
        for (const p of draft.pages)
          for (const object of p.objects) {
            if (
              object.kind !== 'image' ||
              !object.src?.startsWith('data:image/') ||
              !object.imageProvenance
            )
              continue;
            try {
              const mime = object.src.slice(5, object.src.indexOf(';'));
              const dimensions = encodedImageDimensions(
                mime,
                base64Bytes(object.src.slice(object.src.indexOf(',') + 1))
              );
              const asset = {
                id: object.id,
                src: object.src,
                ...dimensions,
                exifOrientation: 1,
                provenance: object.imageProvenance,
              };
              if (validateEmbeddedImage(asset)) out.push(asset);
            } catch {
              /* Invalid embedded images cannot be used as data bindings. */
            }
          }
        return out;
      };
      const bounds = (objects: StudioObject[]) => ({
        x: Math.min(...objects.map((o) => o.x)),
        y: Math.min(...objects.map((o) => o.y)),
        right: Math.max(...objects.map((o) => o.x + o.width)),
        bottom: Math.max(...objects.map((o) => o.y + o.height)),
      });
      // Explicit regeneration replaces customized primitives; retain the group's position and scale.
      const replaceGroup = (
        project: StudioProject,
        id: string,
        objects: StudioObject[],
        target = pageId
      ) => {
        const owner =
          project.pages.find((p) => p.objects.some((o) => o.groupId === id)) ??
          project.pages.find((p) => p.id === target)!;
        const previous = owner.objects.filter((o) => o.groupId === id);
        if (previous.length) {
          const old = bounds(previous),
            next = bounds(objects),
            sx = (old.right - old.x) / Math.max(0.01, next.right - next.x),
            sy = (old.bottom - old.y) / Math.max(0.01, next.bottom - next.y);
          for (const o of objects) {
            o.x = old.x + (o.x - next.x) * sx;
            o.y = old.y + (o.y - next.y) * sy;
            o.width *= sx;
            o.height *= sy;
          }
        }
        for (const p of project.pages)
          p.objects = p.objects.filter((o) => o.groupId !== id);
        owner.objects.push(...objects);
      };
      const render = () => {
        cleanupGrid?.();
        cleanupGrid = undefined;
        const controls = document.createElement('div');
        body.replaceChildren(status, controls);
        const datasets = select(
          controls,
          'Datová sada',
          (draft.dataTables ?? []).map((d) => [
            d.id,
            d.columns.map((c) => c.label).join(', '),
          ])
        );
        datasets.value = tableId;
        datasets.onchange = () => {
          tableId = datasets.value;
          render();
        };
        const file = panelInput(controls, 'Importovat CSV', '', tr, 'file');
        file.accept = '.csv,text/csv';
        const delimiter = select(controls, 'Oddělovač CSV', [
          [',', ','],
          [';', ';'],
          ['\t', 'TAB'],
          ['|', '|'],
        ]);
        const encoding = select(controls, 'Kódování CSV', [
          ['utf-8', 'UTF-8'],
          ['windows-1250', 'Windows-1250'],
        ]);
        button(controls, 'Načíst CSV', () => {
          void run(async () => {
            const selected = file.files?.[0];
            if (!selected || selected.size > TABLE_LIMITS.bytes)
              throw new Error('Invalid CSV');
            const imported = parseCsv(
              new Uint8Array(await selected.arrayBuffer()),
              {
                delimiter: delimiter.value as ',' | ';' | '\t' | '|',
                encoding: encoding.value as 'utf-8' | 'windows-1250',
              }
            );
            if (disposed) return;
            const candidate = {
              ...draft,
              dataTables: [...(draft.dataTables ?? []), imported],
            };
            validateProject(candidate);
            draft = candidate;
            tableId = imported.id;
            changedTables.add(imported.id);
            changed();
            render();
          });
        });
        const active = table();
        if (!active) {
          button(controls, 'Zrušit', close);
          return;
        }
        const grid = document.createElement('div');
        controls.append(grid);
        cleanupGrid = mountDataPanel(grid, {
          getTable: () => table()!,
          onTableChange(next) {
            changedTables.add(next.id);
            draft.dataTables = draft.dataTables!.map((d) =>
              d.id === next.id ? next : d
            );
            changed();
          },
          onError: fail,
          labels: {
            cell: tr('Buňka'),
            previous: tr('Předchozí'),
            next: tr('Další'),
            page: tr('Stránka'),
          },
        });
        const columns: [string, string][] = active.columns.map((c) => [
          c.id,
          c.label,
        ]);
        const numeric = select(controls, 'Číselné sloupce', columns, true);
        button(controls, 'Převést vybrané sloupce na čísla', () => {
          try {
            const ids = new Set(
                [...numeric.selectedOptions].map((o) => o.value)
              ),
              next = structuredClone(table()!);
            next.columns.forEach((c, col) => {
              if (!ids.has(c.id)) return;
              c.type = 'number';
              next.rows.forEach((row) => {
                const value = row[col];
                if (value === null || String(value).trim() === '')
                  row[col] = null;
                else {
                  const raw = String(value).trim();
                  if (!decimal.test(raw) || !Number.isFinite(Number(raw)))
                    throw new Error('Invalid number');
                  row[col] = Number(raw);
                }
              });
            });
            validateDataTable(next);
            changedTables.add(next.id);
            draft.dataTables = draft.dataTables!.map((d) =>
              d.id === next.id ? next : d
            );
            changed();
            render();
          } catch {
            report(
              'Číselné hodnoty vyžadují konečné číslo s desetinnou tečkou.'
            );
          }
        });
        const inserted = new Set(
          draft.pages.flatMap((p) => p.objects.map((o) => o.groupId))
        );
        button(controls, 'Vložit tabulku', () => {
          try {
            if (!inserted.has(active.id)) {
              replaceGroup(
                draft,
                active.id,
                tableToObjects(table()!, {
                  x: 20,
                  y: 20,
                  width: Math.max(20, page().width - 40),
                  locale: locale.value,
                })
              );
              changed();
            } else
              report('Obnovení nahradí také ruční úpravy datových objektů.');
          } catch {
            fail();
          }
        });
        const charts = select(controls, 'Existující graf', [
          ['', tr('Nový graf')],
          ...(draft.dataCharts ?? [])
            .filter((c) => c.tableId === active.id)
            .map(
              (c) =>
                [c.id, `${c.type} (${c.id.slice(0, 8)})`] as [string, string]
            ),
        ]);
        const type = select(controls, 'Typ grafu', [
          ['bar', tr('Sloupcový')],
          ['line', tr('Spojnicový')],
          ['pie', tr('Výsečový')],
          ['scatter', tr('Bodový')],
        ]);
        const label = select(controls, 'Sloupec popisků', columns),
          values = select(controls, 'Číselné řady', columns, true),
          x = select(controls, 'Sloupec osy X', [
            ['', tr('Bez vazby')],
            ...columns,
          ]);
        const xLabel = panelInput(controls, 'Popisek osy X', '', tr),
          yLabel = panelInput(controls, 'Popisek osy Y', '', tr),
          locale = select(controls, 'Jazyk čísel', [
            ['cs-CZ', 'Čeština'],
            ['en-US', 'English'],
            ['de-DE', 'Deutsch'],
          ]);
        const legend = checkbox(controls, 'Legenda', true);
        charts.onchange = () => {
          const spec = draft.dataCharts?.find((c) => c.id === charts.value);
          if (!spec) return;
          type.value = spec.type;
          label.value = spec.labelColumnId;
          for (const option of values.options)
            option.selected = spec.valueColumnIds.includes(option.value);
          x.value = spec.xColumnId ?? '';
          xLabel.value = spec.xAxisLabel ?? '';
          yLabel.value = spec.yAxisLabel ?? '';
          locale.value = spec.locale ?? 'cs-CZ';
          legend.checked = spec.legend !== false;
        };
        button(controls, 'Připravit graf', () => {
          try {
            const spec: ChartSpec = {
              id: charts.value || crypto.randomUUID(),
              type: type.value as ChartSpec['type'],
              tableId: active.id,
              labelColumnId: label.value,
              valueColumnIds: [...values.selectedOptions].map((o) => o.value),
              ...(x.value ? { xColumnId: x.value } : {}),
              xAxisLabel: xLabel.value,
              yAxisLabel: yLabel.value,
              locale: locale.value,
              legend: legend.checked,
            };
            const generated = chartToObjects(table()!, spec); // Preflight before changing the staged project.
            const nextCharts = [
              ...(draft.dataCharts ?? []).filter((c) => c.id !== spec.id),
              spec,
            ];
            validateProject({ ...draft, dataCharts: nextCharts });
            draft.dataCharts = nextCharts;
            changedCharts.add(spec.id);
            if (!inserted.has(spec.id)) replaceGroup(draft, spec.id, generated);
            changed();
          } catch {
            fail();
          }
        });
        const note = document.createElement('p');
        note.textContent = `${tr('Obnovení nahradí také ruční úpravy datových objektů.')} ${tr('Dlouhé popisky grafu jsou zkráceny; úplná data zůstávají zachována.')}`;
        controls.append(note);
        const replace = checkbox(controls, 'Potvrdit nahrazení ručních úprav'),
          overflow = checkbox(controls, 'Povolit přesah stránky');
        button(controls, 'Obnovit datové objekty', () => {
          changedTables.add(active.id);
          changed();
        });
        const bindingHeading = document.createElement('h3');
        bindingHeading.textContent = tr('Vazby CSV');
        controls.append(bindingHeading);
        const imageNote = document.createElement('p');
        imageNote.textContent = tr(
          'Hodnoty obrázků musí být ID vložených schválených obrázků.'
        );
        controls.append(imageNote);
        const embedded = assets();
        if (embedded.length) {
          const ids = document.createElement('p');
          ids.textContent = embedded.map((a) => a.id).join(', ');
          controls.append(ids);
        }
        const bindingInputs: {
          object: StudioObject;
          input: HTMLSelectElement;
        }[] = [];
        const generatedGroups = new Set(
          [...(draft.dataTables ?? []), ...(draft.dataCharts ?? [])].map(
            (d) => d.id
          )
        );
        for (const object of page().objects)
          if (
            (object.kind === 'text' || object.kind === 'image') &&
            !generatedGroups.has(object.groupId ?? '')
          ) {
            const input = select(controls, 'Vazby CSV', [
              ['', tr('Bez vazby')],
              ...columns,
            ]);
            input.setAttribute(
              'aria-label',
              `${tr('Vazby CSV')}: ${object.name || object.id}`
            );
            const caption = document.createElement('span');
            caption.textContent = object.name || object.id;
            input.before(caption);
            bindingInputs.push({ object, input });
          }
        const bindings = (): DataBinding[] =>
          bindingInputs
            .filter((b) => b.input.value)
            .map(({ object, input }) => ({
              pageId,
              objectId: object.id,
              kind: object.kind as 'text' | 'image',
              columnId: input.value,
            }));
        const preview = document.createElement('div');
        preview.setAttribute('aria-live', 'polite');
        controls.append(preview);
        const showPreview = () => {
          const result = previewVariants(draft, table()!, bindings(), {
            assets: embedded,
            count: 3,
          });
          preview.replaceChildren();
          const summary = document.createElement('p');
          summary.textContent = `${tr('Varianty')}: ${result.variants.length}; ${tr('Přetečení')}: ${result.overflow.length}`;
          preview.append(summary);
          for (const issue of result.overflow) {
            const detail = document.createElement('p');
            detail.textContent = `${tr('Přetečení')}: ${issue.row + 1}, ${issue.pageId}, ${issue.objectId}, ${issue.reason}`;
            preview.append(detail);
          }
          result.variants.forEach((variant, index) => {
            const text = document.createElement('pre');
            text.textContent = `${index + 1}: ${variant.pages.flatMap((p) => p.objects.filter((o) => o.kind === 'text').map((o) => o.text ?? '')).join('\n')}`;
            preview.append(text);
            for (const p of variant.pages)
              for (const o of p.objects)
                if (
                  o.kind === 'image' &&
                  embedded.some((a) => a.src === o.src)
                ) {
                  const image = document.createElement('img');
                  image.src = o.src!;
                  image.alt = o.name;
                  image.width = Math.min(160, o.width);
                  preview.append(image);
                }
          });
          return result;
        };
        button(controls, 'Náhled prvních variant', () => {
          try {
            showPreview();
          } catch {
            fail();
          }
        });
        const cancelExport = panelButton(
          'Zrušit export',
          () => exportJob?.abort(),
          tr
        );
        cancelExport.setAttribute('data-cancel-export', '');
        cancelExport.disabled = true;
        controls.append(cancelExport);
        button(controls, 'Exportovat dávky ZIP', () => {
          void run(async () => {
            if (dirty) {
              report('Změny jsou připraveny. Potvrďte je tlačítkem Použít.');
              return;
            }
            const selectedBindings = bindings();
            exportJob = new AbortController();
            cancelExport.disabled = false;
            const zip = new JSZip();
            let total = 0,
              count = 0,
              issues = 0;
            try {
              // Check every row before export; the generator deliberately returns projects only.
              for (let row = 0; row < table()!.rows.length; row++) {
                if (exportJob.signal.aborted || disposed) return;
                issues += previewVariants(
                  draft,
                  { ...table()!, rows: [table()!.rows[row]] },
                  selectedBindings,
                  { assets: embedded, count: 1 }
                ).overflow.length;
                if (row % 20 === 19)
                  await new Promise<void>((resolve) => setTimeout(resolve, 0));
              }
              if (issues && !overflow.checked) {
                report('Datové objekty přesahují stránku.');
                return;
              }
              for await (const variant of generateVariants(
                draft,
                table()!,
                selectedBindings,
                exportJob.signal,
                { assets: embedded, maxPages: 200 }
              )) {
                const portable = await serializePortableProject(variant);
                if (exportJob.signal.aborted || disposed) return;
                total += new TextEncoder().encode(portable).length;
                if (total > MAX_ZIP) throw new Error('ZIP exceeds total limit');
                zip.file(`project-${++count}.json`, portable);
              }
              const bytes = await zip.generateAsync(
                { type: 'uint8array', compression: 'STORE' },
                () => {
                  if (exportJob!.signal.aborted || disposed)
                    throw new DOMException('Cancelled', 'AbortError');
                }
              );
              if (bytes.length > MAX_ZIP)
                throw new Error('ZIP exceeds total limit');
              if (exportJob.signal.aborted || disposed) return;
              const url = URL.createObjectURL(
                  new Blob([bytes as BlobPart], { type: 'application/zip' })
                ),
                anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'data-projects.zip';
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              status.textContent = `${tr('Dávky')}: ${count}; ${tr('Přetečení')}: ${issues}`;
            } catch (error) {
              if (!exportJob?.signal.aborted) throw error;
            } finally {
              cancelExport.disabled = true;
              if (exportJob?.signal.aborted && !disposed)
                report('Export byl zrušen.');
              exportJob = undefined;
            }
          });
        });
        button(controls, 'Použít', () => {
          void run(async () => {
            if (!dirty) return;
            const candidate = structuredClone(draft);
            const groupIds = new Set(
              candidate.pages.flatMap((p) => p.objects.map((o) => o.groupId))
            );
            const affectedTables = (candidate.dataTables ?? []).filter(
              (d) => changedTables.has(d.id) && groupIds.has(d.id)
            );
            const affectedCharts = (candidate.dataCharts ?? []).filter(
              (c) =>
                groupIds.has(c.id) &&
                (changedTables.has(c.tableId) || changedCharts.has(c.id))
            );
            if (affectedTables.length || affectedCharts.length) {
              if (!replace.checked) {
                report('Obnovení nahradí také ruční úpravy datových objektů.');
                return;
              }
              for (const dataset of affectedTables)
                replaceGroup(
                  candidate,
                  dataset.id,
                  tableToObjects(dataset, { locale: locale.value })
                );
              for (const spec of affectedCharts)
                replaceGroup(
                  candidate,
                  spec.id,
                  chartToObjects(
                    candidate.dataTables!.find((d) => d.id === spec.tableId)!,
                    spec
                  )
                );
            }
            const candidateGroups = new Set(
              [
                ...(candidate.dataTables ?? []),
                ...(candidate.dataCharts ?? []),
              ].map((d) => d.id)
            );
            const chartGroups = new Set(
              (candidate.dataCharts ?? []).map((c) => c.id)
            );
            const hasOverflow = candidate.pages.some((p) =>
              p.objects.some(
                (o) =>
                  candidateGroups.has(o.groupId ?? '') &&
                  (o.x < 0 ||
                    o.y < 0 ||
                    o.x + o.width > p.width ||
                    o.y + o.height > p.height ||
                    (o.kind === 'text' &&
                      (layoutText(o).overflow ||
                        (chartGroups.has(o.groupId ?? '') &&
                          o.name !== o.text))))
              )
            );
            if (hasOverflow && !overflow.checked) {
              report('Datové objekty přesahují stránku.');
              return;
            }
            validateProject(candidate);
            await api.runProjectOperation(
              'Tabulky, grafy a CSV',
              async () => candidate,
              snapshot.revision,
              lifetime.signal
            );
            if (disposed) return;
            snapshot = await api.readProjectSnapshot();
            if (disposed) return;
            draft = structuredClone(snapshot.project);
            dirty = false;
            changedTables.clear();
            changedCharts.clear();
            report('Data byla použita.');
            render();
          });
        });
        button(controls, 'Zrušit', close);
      };
      void api
        .readProjectSnapshot()
        .then((value) => {
          if (disposed) return;
          snapshot = value;
          draft = structuredClone(value.project);
          pageId = value.view.pageId ?? draft.pages[0].id;
          tableId = draft.dataTables?.[0]?.id ?? '';
          render();
        })
        .catch(fail);
      return () => {
        disposed = true;
        lifetime.abort();
        exportJob?.abort();
        cleanupGrid?.();
        guard.dispose();
        body.replaceChildren();
      };
    })
  );
}
