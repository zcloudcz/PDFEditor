import { designPagePredicate } from './design-provenance';
import type { StudioPage, StudioProject } from './types';
import { validateProject } from './project-validation';

export interface UserProvenance { kind: 'user-declared'; license: string; source: string }
export interface PersonalTemplate {
  version: 1;
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  provenance: UserProvenance;
  mediaProvenance: Record<string, UserProvenance>;
  pages: StudioPage[];
}
export const PERSONAL_TEMPLATES_KEY = 'pdf-editor-personal-templates-v1';
const MAX_TEMPLATE_STORAGE = 3 * 1024 * 1024;

const uid = () => crypto.randomUUID();
const copy = <T>(value: T): T => structuredClone(value);
const words = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const provenance = (value: unknown): value is UserProvenance => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UserProvenance>;
  return item.kind === 'user-declared' && words(item.license, 100) && words(item.source, 500);
};

export function validatePersonalTemplate(value: unknown): value is PersonalTemplate {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PersonalTemplate>;
  if (item.version !== 1 || !words(item.id, 200) || !words(item.name, 100) ||
      !Array.isArray(item.tags) || item.tags.length > 12 || !item.tags.every(tag => words(tag, 30)) ||
      typeof item.favorite !== 'boolean' || typeof item.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(item.createdAt)) || !provenance(item.provenance) ||
      !item.mediaProvenance || typeof item.mediaProvenance !== 'object' ||
      !Array.isArray(item.pages) || item.pages.length === 0 || item.pages.length > 20) return false;
  try { validateProject({ version: 1, name: item.name, pages: item.pages }); }
  catch { return false; }
  if (item.pages.some(page => page.sourcePageIndex !== undefined)) return false;
  const imageIds = item.pages.flatMap(page => page.objects.filter(object => object.kind === 'image').map(object => object.id));
  const declared = Object.keys(item.mediaProvenance);
  return declared.length === imageIds.length && imageIds.every(id => provenance(item.mediaProvenance![id]));
}

export function capturePersonalTemplate(
  project: StudioProject,
  selectedIds: readonly string[],
  details: { name: string; tags: string[]; license: string; source: string; mediaProvenance?: Record<string, UserProvenance> },
): PersonalTemplate {
  validateProject(project);
  const ids = new Set(selectedIds);
  const fullPages = project.pages.filter(page => ids.has(page.id));
  const objectPages = project.pages.filter(page => page.objects.some(object => ids.has(object.id)));
  if (fullPages.length && objectPages.length) throw new Error('Choose pages or objects, not both.');
  if (objectPages.length > 1) throw new Error('Selected objects must be on one page.');
  const pages = fullPages.length ? copy(fullPages) : objectPages.map(page => ({ ...copy(page), objects: copy(page.objects.filter(object => ids.has(object.id))) }));
  const isDesign = designPagePredicate(project);
  if (!pages.length || pages.some(page => !isDesign(page))) throw new Error('Only design-only pages and objects can become templates.');
  for (const page of pages) { delete page.sourcePageIndex; delete page.syntheticBackground; }
  const mediaProvenance = copy(details.mediaProvenance ?? Object.fromEntries(pages.flatMap(page => page.objects
    .filter(object => object.kind === 'image' && object.imageProvenance)
    .map(object => [object.id, object.imageProvenance?.kind === 'user-declared' ? object.imageProvenance :
      { kind: 'user-declared' as const, license: details.license.trim(), source: details.source.trim() }]))));
  const template: PersonalTemplate = {
    version: 1, id: uid(), name: details.name.trim(), tags: copy(details.tags), favorite: false,
    createdAt: new Date().toISOString(),
    provenance: { kind: 'user-declared', license: details.license.trim(), source: details.source.trim() },
    mediaProvenance, pages,
  };
  if (!validatePersonalTemplate(template)) throw new Error('Invalid template or missing image provenance.');
  return template;
}

export function insertPersonalTemplate(project: StudioProject, template: PersonalTemplate, at: number): StudioProject {
  validateProject(project);
  if (!validatePersonalTemplate(template) || !Number.isInteger(at) || at < 0 || at > project.pages.length ||
      project.pages.length + template.pages.length > 200) throw new Error('Invalid template insertion.');
  const next = copy(project);
  const groupIds = new Map<string, string>();
  const pages = copy(template.pages).map(page => ({
    ...page, id: uid(),
    objects: page.objects.map(object => ({ ...object, id: uid(),
      ...(object.groupId ? { groupId: groupIds.get(object.groupId) ?? (() => { const id = uid(); groupIds.set(object.groupId!, id); return id; })() } : {}),
    })),
  }));
  next.pages.splice(at, 0, ...pages);
  validateProject(next);
  return next;
}

export function findPersonalTemplates(templates: readonly PersonalTemplate[], query: string, tag?: string, favoritesOnly = false): PersonalTemplate[] {
  const needle = query.trim().toLocaleLowerCase();
  return templates.filter(template => validatePersonalTemplate(template) && (!favoritesOnly || template.favorite) &&
    (!tag || template.tags.includes(tag)) &&
    (!needle || [template.name, ...template.tags].some(value => value.toLocaleLowerCase().includes(needle)))).map(copy);
}

export function loadPersonalTemplates(storage: Storage = localStorage): PersonalTemplate[] {
  const text = storage.getItem(PERSONAL_TEMPLATES_KEY);
  if (!text) return [];
  if (text.length > MAX_TEMPLATE_STORAGE) throw new Error('Template library is too large.');
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 20 || !value.every(validatePersonalTemplate)) throw new Error('Invalid template library.');
  return copy(value);
}

export function savePersonalTemplate(template: PersonalTemplate, storage: Storage = localStorage): void {
  if (!validatePersonalTemplate(template)) throw new Error('Invalid template.');
  const existing = loadPersonalTemplates(storage).filter(item => item.id !== template.id);
  const next = [...existing, copy(template)];
  if (next.length > 20) throw new Error('Template library is full.');
  const text = JSON.stringify(next);
  if (text.length > MAX_TEMPLATE_STORAGE) throw new Error('Template library is too large.');
  storage.setItem(PERSONAL_TEMPLATES_KEY, text);
}

export function deletePersonalTemplate(id: string, storage: Storage = localStorage): void {
  storage.setItem(PERSONAL_TEMPLATES_KEY, JSON.stringify(loadPersonalTemplates(storage).filter(item => item.id !== id)));
}
