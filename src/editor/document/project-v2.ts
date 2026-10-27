import type { StudioObject, StudioPage, StudioProject } from '../studio/types';
import { validateProject } from '../studio/project-validation';
import { MAX_PROJECT_BYTES, validateAssets, type EmbeddedAsset } from './asset-store';

export type SectionKind = 'design' | 'pdf' | 'slides' | 'flow' | 'sheet' | 'board' | 'web' | 'timeline';
export type V2Object = Omit<StudioObject, 'src'> & { assetId?: string };
export type V2Page = Omit<StudioPage, 'objects'> & { objects: V2Object[] };
export interface DesignSection { id: string; kind: 'design'; pages: V2Page[]; sourcePdfAssetId?: string; dataTables?: StudioProject['dataTables']; dataCharts?: StudioProject['dataCharts'] }
/** Extend only when a section has its own implemented model and validator. */
export type DocumentSection = DesignSection;
export interface ProjectV2 { version: 2; name: string; assets: Record<string, EmbeddedAsset>; sections: DocumentSection[] }
const keys = (value: object, allowed: string[]) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported project field');
};
const objectKeys = ['id','kind','name','x','y','width','height','rotation','opacity','fill','stroke','strokeWidth','locked','groupId','layoutAnchors','text','fontSize','fontFamily','textDirection','textLanguage','textAlign','textRuns','underline','verticalAlign','lineHeight','paragraphSpacing','tracking','textShadow','textGradient','textPath','wrapText','path','assetId','crop','imageFit','imageMask','imageAdjustments','imageCutout','imageProvenance','brandRoles'];

/** Materialize only after validateProjectV2 has checked integrity and references. */
export function materializeDesign(project: ProjectV2, section: DesignSection): StudioProject {
  return {
    version: 1, name: project.name,
    ...(section.dataTables ? { dataTables: structuredClone(section.dataTables) } : {}),
    ...(section.dataCharts ? { dataCharts: structuredClone(section.dataCharts) } : {}),
    ...(section.sourcePdfAssetId ? { sourcePdf: project.assets[section.sourcePdfAssetId].base64 } : {}),
    pages: section.pages.map(page => ({ ...page, objects: page.objects.map(object => {
      const { assetId, ...rest } = object;
      return { ...rest, ...(assetId ? { src: `data:${project.assets[assetId].mime};base64,${project.assets[assetId].base64}` } : {}) };
    }) })),
  };
}
export async function validateProjectV2(value: unknown): Promise<void> {
  const p = value as ProjectV2;
  if (!p || p.version !== 2 || typeof p.name !== 'string' || p.name.length > 300 || !Array.isArray(p.sections) || p.sections.length !== 1) throw new Error('Unsupported project sections');
  keys(p, ['version', 'name', 'assets', 'sections']);
  await validateAssets(p.assets);
  const ids = new Set<string>();
  for (const section of p.sections) {
    if (!section || section.kind !== 'design') throw new Error('Unsupported section kind');
    keys(section, ['id', 'kind', 'pages', 'sourcePdfAssetId', 'dataTables', 'dataCharts']);
    if (typeof section.id !== 'string' || !section.id.length || section.id.length > 200 || ids.has(section.id) || !Array.isArray(section.pages)) throw new Error('Invalid section');
    ids.add(section.id);
    if (section.sourcePdfAssetId !== undefined && (!Object.hasOwn(p.assets, section.sourcePdfAssetId) || p.assets[section.sourcePdfAssetId].mime !== 'application/pdf')) throw new Error('Missing PDF asset');
    for (const page of section.pages) {
      if (!page || !Array.isArray(page.objects)) throw new Error('Invalid page');
      keys(page, ['id','name','width','height','background','sourcePageIndex','syntheticBackground','objects']);
      if (ids.has(page.id)) throw new Error('Duplicate ID');
      ids.add(page.id);
      for (const object of page.objects) {
        if (!object) throw new Error('Invalid object');
        keys(object, objectKeys);
        if (ids.has(object.id)) throw new Error('Duplicate ID');
        ids.add(object.id);
        if (object.kind === 'image') {
          if (typeof object.assetId !== 'string' || !Object.hasOwn(p.assets, object.assetId) || !p.assets[object.assetId].mime.startsWith('image/')) throw new Error('Missing image asset');
        } else if (object.assetId !== undefined) throw new Error('Unexpected asset reference');
      }
    }
    validateProject(materializeDesign(p, section));
  }
}
export async function exportProjectBundle(project: ProjectV2): Promise<string> {
  project = structuredClone(project);
  await validateProjectV2(project);
  const text = JSON.stringify(project);
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('Project exceeds size limit');
  return text;
}
export async function importProjectBundle(text: string): Promise<ProjectV2> {
  if (text.length > MAX_PROJECT_BYTES || new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('Project exceeds size limit');
  const value: unknown = JSON.parse(text);
  await validateProjectV2(value);
  return value as ProjectV2;
}





