import { isDesignPage } from './design-provenance';
import { t } from '../i18n';
import type { StudioObject, StudioPage, StudioProject } from './types';
import { validateProject } from './project-validation';
import { validatePersonalTemplate, type PersonalTemplate } from './personal-templates';
import { duplicateElements } from './model';

export type LayoutAnchor = 'start' | 'center' | 'end' | 'stretch';
export interface LayoutRule { objectId: string; horizontal: LayoutAnchor; vertical: LayoutAnchor }
/** Guides are transient UI coordinates and are intentionally absent from the project schema. */
export interface LocalGuide { axis: 'x' | 'y'; position: number }
export interface LayoutPreview { project: StudioProject; changedObjectIds: string[] }

const clone = <T>(value: T): T => structuredClone(value);
const finiteSize = (n: number) => Number.isFinite(n) && n >= 1 && n <= 14400;
const EPS = 1e-7;

function targetPage(project: StudioProject, pageId: string): StudioPage {
  const page = project.pages.find(candidate => candidate.id === pageId);
  if (!page) throw new Error(t('Page not found.'));
  return page;
}

function withinPage(object: StudioObject, page: StudioPage): boolean {
  const angle = object.rotation * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const halfWidth = (object.width * c + object.height * s) / 2;
  const halfHeight = (object.width * s + object.height * c) / 2;
  const x = object.x + object.width / 2, y = object.y + object.height / 2;
  return x - halfWidth >= -EPS && y - halfHeight >= -EPS &&
    x + halfWidth <= page.width + EPS && y + halfHeight <= page.height + EPS;
}

/** Reuse a saved one-page template as editable objects on the active page. */
export function insertReusableBlock(project: StudioProject, pageId: string, template: PersonalTemplate): StudioProject {
  validateProject(project);
  if (!validatePersonalTemplate(template) || template.pages.length !== 1 || !template.pages[0].objects.length) throw new Error(t('Choose a one-page template with objects.'));
  const next = clone(project), page = targetPage(next, pageId);
  const objects = duplicateElements(template.pages[0].objects, 0);
  const left = Math.min(...objects.map(object => object.x)), top = Math.min(...objects.map(object => object.y));
  for (const object of objects) {
    object.x += 16 - left; object.y += 16 - top;
    if (!withinPage(object, page)) throw new Error(t('Block extends beyond the design.'));
  }
  page.objects.push(...objects); validateProject(next); return next;
}

function anchor(position: number, extent: number, oldSize: number, newSize: number, rule: LayoutAnchor): [number, number] {
  if (rule === 'start') return [position, extent];
  if (rule === 'end') return [newSize - (oldSize - position), extent];
  if (rule === 'center') return [position + (newSize - oldSize) / 2, extent];
  return [position, extent + newSize - oldSize];
}

export function previewDesignResize(
  project: StudioProject, pageId: string, size: { width: number; height: number }, rules: readonly LayoutRule[],
): LayoutPreview {
  validateProject(project);
  if (!finiteSize(size.width) || !finiteSize(size.height)) throw new Error(t('Invalid design size.'));
  const original = targetPage(project, pageId);
  if (!isDesignPage(project, original)) throw new Error(t('PDF-backed page resize requires an explicit PDF geometry transform.'));
  const ruleMap = new Map<string, LayoutRule>();
  for (const rule of rules) {
    if (ruleMap.has(rule.objectId) || !original.objects.some(object => object.id === rule.objectId) ||
        !(['start', 'center', 'end', 'stretch'] as const).includes(rule.horizontal) ||
        !(['start', 'center', 'end', 'stretch'] as const).includes(rule.vertical)) throw new Error(t('Invalid layout anchor.'));
    ruleMap.set(rule.objectId, rule);
  }
  for (const object of original.objects) if (!ruleMap.has(object.id) && object.layoutAnchors) ruleMap.set(object.id, { objectId: object.id, ...object.layoutAnchors });
  const next = clone(project);
  const page = targetPage(next, pageId);
  delete page.sourcePageIndex; delete page.syntheticBackground;
  page.width = size.width; page.height = size.height;
  const changedObjectIds: string[] = [];
  for (const object of page.objects) {
    const rule = ruleMap.get(object.id);
    if (rule && !object.locked) {
      object.layoutAnchors = { horizontal: rule.horizontal, vertical: rule.vertical };
      const [x, width] = anchor(object.x, object.width, original.width, size.width, rule.horizontal);
      const [y, height] = anchor(object.y, object.height, original.height, size.height, rule.vertical);
      if (width < 0.01 || height < 0.01 || !Number.isFinite(x + y + width + height)) throw new Error(t('Resize collapses an object.'));
      if (x !== object.x || y !== object.y || width !== object.width || height !== object.height) changedObjectIds.push(object.id);
      Object.assign(object, { x, y, width, height });
    }
    if (!withinPage(object, page)) throw new Error(t('Object extends beyond the resized design.'));
  }
  validateProject(next);
  return { project: next, changedObjectIds };
}

export function resizeDesign(
  project: StudioProject, pageId: string, size: { width: number; height: number }, rules: readonly LayoutRule[],
): StudioProject { return previewDesignResize(project, pageId, size, rules).project; }

interface Unit { objects: StudioObject[]; start: number; end: number; key: string }
export function distributeSelection(
  project: StudioProject, pageId: string, selectedIds: readonly string[], axis: 'horizontal' | 'vertical',
): StudioProject {
  validateProject(project);
  const page = targetPage(project, pageId);
  if (axis !== 'horizontal' && axis !== 'vertical') throw new Error(t('Invalid distribution axis.'));
  const selected = new Set(selectedIds);
  const groups = new Map<string, StudioObject[]>();
  for (const object of page.objects) if (object.groupId) {
    const members = groups.get(object.groupId) ?? []; members.push(object); groups.set(object.groupId, members);
  }
  for (const members of groups.values()) if (members.some(object => selected.has(object.id)) &&
      members.some(object => !selected.has(object.id) || object.locked)) throw new Error(t('Select the complete unlocked group.'));
  const eligible = page.objects.filter(object => selected.has(object.id) && !object.locked);
  const units = new Map<string, Unit>();
  for (const object of eligible) {
    const key = object.groupId ? `group:${object.groupId}` : `object:${object.id}`;
    const angle = object.rotation * Math.PI / 180;
    const extent = axis === 'horizontal'
      ? Math.abs(Math.cos(angle)) * object.width + Math.abs(Math.sin(angle)) * object.height
      : Math.abs(Math.sin(angle)) * object.width + Math.abs(Math.cos(angle)) * object.height;
    const center = axis === 'horizontal' ? object.x + object.width / 2 : object.y + object.height / 2;
    const start = center - extent / 2, end = center + extent / 2;
    const unit = units.get(key);
    if (unit) { unit.objects.push(object); unit.start = Math.min(unit.start, start); unit.end = Math.max(unit.end, end); }
    else units.set(key, { key, objects: [object], start, end });
  }
  const ordered = [...units.values()].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
  if (ordered.length < 3) return clone(project);
  const span = ordered.at(-1)!.end - ordered[0].start;
  const total = ordered.reduce((sum, unit) => sum + unit.end - unit.start, 0);
  const gap = (span - total) / (ordered.length - 1);
  if (gap < -EPS) throw new Error(t('Selected objects overlap; distribution cannot preserve their sizes.'));
  const next = clone(project);
  const target = targetPage(next, pageId);
  const byId = new Map(target.objects.map(object => [object.id, object]));
  let cursor = ordered[0].end + gap;
  for (const unit of ordered.slice(1, -1)) {
    const delta = cursor - unit.start;
    for (const object of unit.objects) {
      const targetObject = byId.get(object.id)!;
      if (axis === 'horizontal') targetObject.x += delta; else targetObject.y += delta;
      if (!withinPage(targetObject, target)) throw new Error(t('Distribution extends beyond the design.'));
    }
    cursor += unit.end - unit.start + gap;
  }
  validateProject(next);
  return next;
}

export function snapToGuides(point: { x: number; y: number }, guides: readonly LocalGuide[], tolerance = 5): { x: number; y: number } {
  if (!Number.isFinite(point.x + point.y) || !Number.isFinite(tolerance) || tolerance < 0) throw new Error(t('Invalid guide input.'));
  const result = { ...point };
  for (const axis of ['x', 'y'] as const) {
    const closest = guides.filter(guide => guide.axis === axis && Number.isFinite(guide.position))
      .map(guide => guide.position).sort((a, b) => Math.abs(a - point[axis]) - Math.abs(b - point[axis]))[0];
    if (closest !== undefined && Math.abs(closest - point[axis]) <= tolerance) result[axis] = closest;
  }
  return result;
}

