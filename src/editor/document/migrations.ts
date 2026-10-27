import { validateProject, base64Bytes } from '../studio/project-validation';
import type { StudioProject } from '../studio/types';
import { AssetStore } from './asset-store';
import { materializeDesign, validateProjectV2, type ProjectV2, type V2Page } from './project-v2';

/** Pure migration: no writes to checkpoints or modification of the input. */
export async function migrateProject(value: unknown): Promise<ProjectV2> {
  value = structuredClone(value);
  if ((value as { version?: unknown })?.version === 2) {
    await validateProjectV2(value);
    return value as ProjectV2;
  }
  validateProject(value);
  const source = value;
  const store = new AssetStore();
  const pages: V2Page[] = [];
  for (const page of source.pages) {
    const objects = [];
    for (const object of page.objects) {
      const { src, ...rest } = object;
      if (src !== undefined && object.kind !== 'image') throw new Error('Unexpected embedded asset');
      objects.push({ ...rest, ...(src !== undefined ? { assetId: await store.addDataUrl(src) } : {}) });
    }
    pages.push({ ...page, objects });
  }
  const sourcePdfAssetId = source.sourcePdf ? await store.add(base64Bytes(source.sourcePdf), 'application/pdf') : undefined;
  const usedIds = new Set(source.pages.flatMap(p => [p.id, ...p.objects.map(o => o.id)]));
  let id = 'design';
  while (usedIds.has(id)) id += '-section';
  const result: ProjectV2 = { version: 2, name: source.name, assets: store.snapshot(), sections: [{ id, kind: 'design', pages, ...(sourcePdfAssetId ? { sourcePdfAssetId } : {}), ...(source.dataTables ? { dataTables: source.dataTables } : {}), ...(source.dataCharts ? { dataCharts: source.dataCharts } : {}) }] };
  await validateProjectV2(result);
  return result;
}
export async function toStudioProject(project: ProjectV2): Promise<StudioProject> {
  project = structuredClone(project);
  await validateProjectV2(project);
  return structuredClone(materializeDesign(project, project.sections[0]));
}

