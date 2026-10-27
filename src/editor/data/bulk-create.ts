import type { StudioProject, StudioPage } from '../studio/types';
import { validateProject } from '../studio/project-validation';
import { layoutText } from '../studio/text-layout';
import {
  validateEmbeddedImage,
  type EmbeddedImage,
} from '../studio/asset-library';
import { validateDataTable, type DataTable } from './table';
import type { ChartSpec } from './charts';
type DataProject = StudioProject;
export interface DataBinding {
  pageId: string;
  objectId: string;
  columnId: string;
  kind: 'text' | 'image';
}
export interface OverflowIssue {
  row: number;
  pageId: string;
  objectId: string;
  reason: 'text-overflow' | 'outside-page';
}
export interface VariantOptions {
  assets?: readonly EmbeddedImage[];
  maxPages?: number;
  maxObjects?: number;
  maxBytes?: number;
}
const MAX_BYTES = 100 * 1024 * 1024;
const bytes = (p: StudioProject) =>
  new TextEncoder().encode(JSON.stringify(p)).length;
function prepare(
  project: DataProject,
  table: DataTable,
  bindings: readonly DataBinding[],
  options: VariantOptions
) {
  validateProject(project);
  validateDataTable(table);
  const maxPages = options.maxPages ?? 200,
    maxObjects = options.maxObjects ?? 10000,
    maxBytes = options.maxBytes ?? MAX_BYTES;
  if (
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 200 ||
    !Number.isInteger(maxObjects) ||
    maxObjects < 1 ||
    maxObjects > 10000 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES
  )
    throw new Error('Invalid variant limits');
  let units = (project.sourcePdf?.length ?? 0) + project.name.length;
  for (const page of project.pages)
    for (const o of page.objects) {
      units +=
        (o.text?.length ?? 0) +
        (o.src?.length ?? 0) +
        (o.path?.length ?? 0) +
        (o.textRuns?.reduce((n, r) => n + r.text.length, 0) ?? 0);
      if (units > maxBytes) throw new Error('Template exceeds byte limit');
    }
  if (
    project.pages.length > maxPages ||
    project.pages.reduce((n, p) => n + p.objects.length, 0) > maxObjects ||
    bytes(project) > maxBytes
  )
    throw new Error('Template exceeds variant limits');
  if (!bindings.length || bindings.length > 10000)
    throw new Error('Invalid variant bindings');
  const used = new Set<string>();
  const resolved = bindings.map((b) => {
    const p = project.pages.find((p) => p.id === b.pageId),
      o = p?.objects.find((o) => o.id === b.objectId),
      col = table.columns.findIndex((c) => c.id === b.columnId),
      key = `${b.pageId}\0${b.objectId}`;
    if (
      !o ||
      col < 0 ||
      !['text', 'image'].includes(b.kind) ||
      o.kind !== b.kind ||
      used.has(key)
    )
      throw new Error('Invalid or duplicate variant binding');
    if (
      o.groupId &&
      [...(project.dataTables ?? []), ...(project.dataCharts ?? [])].some(
        (data) => data.id === o.groupId
      )
    )
      throw new Error('Bind source data instead of a generated data primitive');
    used.add(key);
    return { ...b, col };
  });
  const assets = new Map<string, EmbeddedImage>();
  for (const asset of options.assets ?? []) {
    if (!validateEmbeddedImage(asset) || assets.has(asset.id))
      throw new Error('Invalid embedded variant asset');
    assets.set(asset.id, structuredClone(asset));
  }
  return { maxPages, maxObjects, maxBytes, resolved, assets };
}
function variant(
  project: DataProject,
  table: DataTable,
  row: number,
  setup: ReturnType<typeof prepare>
): {
  pages: StudioPage[];
  overflow: OverflowIssue[];
  dataTables?: DataTable[];
  dataCharts?: ChartSpec[];
} {
  const pages = structuredClone(project.pages),
    overflow: OverflowIssue[] = [];
  for (const b of setup.resolved) {
    const page = pages.find((p) => p.id === b.pageId)!,
      object = page.objects.find((o) => o.id === b.objectId)!,
      value = table.rows[row][b.col];
    if (b.kind === 'text') {
      object.text = value === null ? '' : String(value);
      delete object.textRuns;
      if (layoutText(object).overflow)
        overflow.push({
          row,
          pageId: page.id,
          objectId: object.id,
          reason: 'text-overflow',
        });
    } else {
      const asset =
        typeof value === 'string' ? setup.assets.get(value) : undefined;
      if (!asset)
        throw new Error('Image cell must reference an approved embedded asset');
      object.src = asset.src;
      object.imageProvenance = { ...asset.provenance };
      delete object.imageCutout;
    }
    const angle = (object.rotation * Math.PI) / 180;
    const c = Math.abs(Math.cos(angle)),
      s = Math.abs(Math.sin(angle));
    const halfWidth = (object.width * c + object.height * s) / 2;
    const halfHeight = (object.width * s + object.height * c) / 2;
    const centerX = object.x + object.width / 2,
      centerY = object.y + object.height / 2;
    const epsilon = 1e-7;
    if (
      centerX - halfWidth < -epsilon ||
      centerY - halfHeight < -epsilon ||
      centerX + halfWidth > page.width + epsilon ||
      centerY + halfHeight > page.height + epsilon
    )
      overflow.push({
        row,
        pageId: page.id,
        objectId: object.id,
        reason: 'outside-page',
      });
  }
  const groupIds = new Map<string, string>();
  for (const data of [
    ...(project.dataTables ?? []),
    ...(project.dataCharts ?? []),
  ])
    groupIds.set(data.id, crypto.randomUUID());
  const dataTables = project.dataTables?.map((t) => ({
    ...structuredClone(t),
    id: groupIds.get(t.id)!,
  }));
  const dataCharts = project.dataCharts?.map((c) => ({
    ...structuredClone(c),
    id: groupIds.get(c.id)!,
    tableId: groupIds.get(c.tableId)!,
  }));
  for (const page of pages) {
    page.id = crypto.randomUUID();
    for (const o of page.objects) {
      o.id = crypto.randomUUID();
      if (o.groupId) {
        if (!groupIds.has(o.groupId))
          groupIds.set(o.groupId, crypto.randomUUID());
        o.groupId = groupIds.get(o.groupId)!;
      }
    }
  }
  return {
    pages,
    overflow,
    ...(dataTables ? { dataTables } : {}),
    ...(dataCharts ? { dataCharts } : {}),
  };
}
export function previewVariants(
  project: StudioProject,
  table: DataTable,
  bindings: readonly DataBinding[],
  options: VariantOptions & { count?: number } = {}
) {
  const setup = prepare(project, table, bindings, options),
    count = options.count ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 10)
    throw new Error('Preview supports 1–10 variants');
  const variants: StudioProject[] = [],
    overflow: OverflowIssue[] = [];
  for (let row = 0; row < Math.min(count, table.rows.length); row++) {
    const { overflow: issues, ...next } = variant(project, table, row, setup);
    const p = { ...project, ...next };
    if (bytes(p) > setup.maxBytes)
      throw new Error('Variant exceeds byte limit');
    validateProject(p);
    variants.push(p);
    overflow.push(...issues);
  }
  return { variants, overflow };
}
/** Yields independent projects, preserving original source-page indices and PDF base. */
export async function* generateVariants(
  project: StudioProject,
  table: DataTable,
  bindings: readonly DataBinding[],
  signal: AbortSignal,
  options: VariantOptions = {}
): AsyncGenerator<StudioProject> {
  const abort = () => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  abort();
  const setup = prepare(project, table, bindings, options);
  project = structuredClone(project);
  table = structuredClone(table);
  const baseObjects = project.pages.reduce((n, p) => n + p.objects.length, 0);
  const template = project as DataProject;
  const empty = (): DataProject => ({
    ...project,
    pages: [],
    ...(template.dataTables ? { dataTables: [] } : {}),
    ...(template.dataCharts ? { dataCharts: [] } : {}),
  });
  const baseBytes = bytes(empty()) + 100;
  let batch = empty(),
    part = 1,
    batchBytes = baseBytes,
    objectCount = 0,
    tableBytes = 0;
  const finish = () => {
    const p = { ...batch, name: `${project.name.slice(0, 270)} (${part++})` };
    validateProject(p);
    if (bytes(p) > setup.maxBytes)
      throw new Error('Variant exceeds byte limit');
    return p;
  };
  for (let row = 0; row < table.rows.length; row++) {
    abort();
    const { overflow: _, ...next } = variant(template, table, row, setup);
    // Serialize only new row content, never the potentially large PDF base per row.
    const nextBytes = new TextEncoder().encode(JSON.stringify(next)).length;
    const nextTableBytes = (next.dataTables ?? []).reduce(
      (sum, t) => sum + new TextEncoder().encode(JSON.stringify(t)).length,
      0
    );
    if (
      batch.pages.length + next.pages.length > setup.maxPages ||
      objectCount + baseObjects > setup.maxObjects ||
      batchBytes + nextBytes > setup.maxBytes ||
      (batch.dataTables?.length ?? 0) + (next.dataTables?.length ?? 0) > 20 ||
      (batch.dataCharts?.length ?? 0) + (next.dataCharts?.length ?? 0) > 100 ||
      tableBytes + nextTableBytes > 10 * 1024 * 1024
    ) {
      if (!batch.pages.length)
        throw new Error('Variant exceeds project limits');
      yield finish();
      abort();
      batch = empty();
      batchBytes = baseBytes;
      objectCount = 0;
      tableBytes = 0;
    }
    if (
      baseBytes + nextBytes > setup.maxBytes ||
      baseObjects > setup.maxObjects
    )
      throw new Error('Variant exceeds project limits');
    batch.pages.push(...next.pages);
    batch.dataTables?.push(...(next.dataTables ?? []));
    batch.dataCharts?.push(...(next.dataCharts ?? []));
    batchBytes += nextBytes;
    objectCount += baseObjects;
    tableBytes += nextTableBytes;
    // Yield to the browser so a user can cancel even a batch of short rows.
    if (row % 20 === 19)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  abort();
  if (batch.pages.length) yield finish();
}
