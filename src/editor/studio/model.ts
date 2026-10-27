import type { StudioObject, StudioPage, StudioProject } from './types';

export const clone = <T>(value: T): T => structuredClone(value);
export const uid = () => crypto.randomUUID();
export class ProjectHistory {
  private states: StudioProject[];
  private cursor = 0;
  constructor(project: StudioProject) {
    this.states = [clone(project)];
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.states.length - 1;
  }
  push(project: StudioProject) {
    if (JSON.stringify(this.states[this.cursor]) === JSON.stringify(project))
      return;
    this.states = this.states.slice(0, this.cursor + 1);
    this.states.push(clone(project));
    if (this.states.length > 80) this.states.shift();
    this.cursor = this.states.length - 1;
  }
  undo() {
    return this.canUndo ? clone(this.states[--this.cursor]) : null;
  }
  redo() {
    return this.canRedo ? clone(this.states[++this.cursor]) : null;
  }
}
export function duplicateElements(
  objects: StudioObject[],
  offset = 16
): StudioObject[] {
  const groups = new Map<string, string>();
  return objects.map((object) => {
    if (object.groupId && !groups.has(object.groupId))
      groups.set(object.groupId, uid());
    return {
      ...clone(object),
      id: uid(),
      x: object.x + offset,
      y: object.y + offset,
      groupId: object.groupId ? groups.get(object.groupId) : undefined,
    };
  });
}
export function duplicatePage(
  project: StudioProject,
  id: string
): StudioProject {
  const result = clone(project);
  const index = result.pages.findIndex((page) => page.id === id);
  if (index < 0) return result;
  const page = result.pages[index];
  result.pages.splice(index + 1, 0, {
    ...clone(page),
    id: uid(),
    name: `${page.name.slice(0, 292)} — kopie`,
    objects: duplicateElements(page.objects, 0),
  });
  return result;
}
export function movePage(
  project: StudioProject,
  id: string,
  target: number
): StudioProject {
  const result = clone(project);
  const index = result.pages.findIndex((page) => page.id === id);
  if (index < 0) return result;
  const [page] = result.pages.splice(index, 1);
  result.pages.splice(
    Math.max(0, Math.min(result.pages.length, target)),
    0,
    page
  );
  return result;
}
export function alignElements(
  page: StudioPage,
  ids: string[],
  axis: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
): StudioPage {
  const result = clone(page);
  const objects = result.objects.filter(
    (object) => ids.includes(object.id) && !object.locked
  );
  if (!objects.length) return result;
  const left = objects.length > 1 ? Math.min(...objects.map((o) => o.x)) : 0;
  const top = objects.length > 1 ? Math.min(...objects.map((o) => o.y)) : 0;
  const right =
    objects.length > 1
      ? Math.max(...objects.map((o) => o.x + o.width))
      : page.width;
  const bottom =
    objects.length > 1
      ? Math.max(...objects.map((o) => o.y + o.height))
      : page.height;
  for (const o of objects) {
    if (axis === 'left') o.x = left;
    if (axis === 'center') o.x = (left + right - o.width) / 2;
    if (axis === 'right') o.x = right - o.width;
    if (axis === 'top') o.y = top;
    if (axis === 'middle') o.y = (top + bottom - o.height) / 2;
    if (axis === 'bottom') o.y = bottom - o.height;
  }
  return result;
}
export const STAR_PATH =
  'M50 2 L61 36 L98 36 L68 58 L79 94 L50 72 L21 94 L32 58 L2 36 L39 36 Z';
export const HEART_PATH =
  'M50 92 C35 77 4 57 4 30 C4 3 37 -5 50 20 C63 -5 96 3 96 30 C96 57 65 77 50 92 Z';
