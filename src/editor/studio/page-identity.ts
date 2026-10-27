import type { PageReferenceMapping } from '../pdf/page-reference-map';
import { validateProject } from './project-validation';
import type { StudioProject } from './types';

export interface PageIdentity {
  readonly projectIndex: number;
  readonly sourcePageIndex?: number;
}

/** Project IDs survive reordering; multiple IDs may reference a source page until materialization. */
export function buildPageIdentityMap(project: StudioProject, sourcePageCount: number): {
  byId: Map<string, PageIdentity>;
  bySourceIndex: Map<number, readonly string[]>;
} {
  validateProject(project);
  if (!Number.isInteger(sourcePageCount) || sourcePageCount < 0 || sourcePageCount > 200) throw new RangeError('Invalid source page count');
  const byId = new Map<string, PageIdentity>();
  const bySourceIndex = new Map<number, string[]>();
  project.pages.forEach((page, projectIndex) => {
    const sourcePageIndex = page.sourcePageIndex;
    if (sourcePageIndex !== undefined && (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0 || sourcePageIndex >= sourcePageCount)) throw new RangeError('Invalid source page reference');
    byId.set(page.id, { projectIndex, ...(sourcePageIndex === undefined ? {} : { sourcePageIndex }) });
    if (sourcePageIndex !== undefined) {
      const ids = bySourceIndex.get(sourcePageIndex) ?? [];
      ids.push(page.id);
      bySourceIndex.set(sourcePageIndex, ids);
    }
  });
  return { byId, bySourceIndex };
}

/** Map the PDF-backed subsequence only: design-only pages do not consume PDF positions. */
export function sourceReferenceMapping(project: StudioProject, sourcePageCount: number): PageReferenceMapping[] {
  buildPageIdentityMap(project, sourcePageCount);
  const mapping = Array.from({ length: sourcePageCount }, (_, oldIndex) => ({ oldIndex, newIndices: [] as number[] }));
  let newIndex = 0;
  for (const page of project.pages) if (page.sourcePageIndex !== undefined) mapping[page.sourcePageIndex].newIndices.push(newIndex++);
  return mapping;
}
