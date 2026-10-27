import type { StudioProject } from './types';
import { validateLogo } from './brand-kit';
import { validateProject } from './project-validation';

export type BrandColorRole = 'primary' | 'accent' | 'paper';
export type BrandTextRole = 'heading' | 'body';
export type BrandAssignment = { fill?: BrandColorRole; stroke?: BrandColorRole; textStyle?: BrandTextRole };
export interface BrandProfile {
  version: 1;
  id: string;
  name: string;
  colors: Record<BrandColorRole, string>;
  textStyles: Record<BrandTextRole, { fontFamily: 'Liberation Sans' | 'Liberation Sans Bold' | 'Liberation Sans Italic'; fontSize: number }>;
  logo?: string;
}
export const BRAND_PROFILES_KEY = 'pdf-editor-brand-profiles-v1';
const clone = <T>(value: T): T => structuredClone(value);
const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const roles: BrandColorRole[] = ['primary', 'accent', 'paper'];

export function validateBrandProfile(value: unknown): value is BrandProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<BrandProfile>;
  return profile.version === 1 && typeof profile.id === 'string' && profile.id.length > 0 && profile.id.length <= 200 &&
    typeof profile.name === 'string' && profile.name.trim().length > 0 && profile.name.length <= 80 &&
    !!profile.colors && roles.every(role => color(profile.colors?.[role])) &&
    !!profile.textStyles && (['heading', 'body'] as const).every(role => {
      const style = profile.textStyles?.[role];
      return !!style && ['Liberation Sans', 'Liberation Sans Bold', 'Liberation Sans Italic'].includes(style.fontFamily) &&
        Number.isFinite(style.fontSize) && style.fontSize >= 4 && style.fontSize <= 500;
    }) && (profile.logo === undefined || validateLogo(profile.logo));
}

export function applyBrandToSelection(
  project: StudioProject, brand: BrandProfile, selection: readonly string[],
  assignments: Readonly<Record<string, BrandAssignment>> = {},
): StudioProject {
  validateProject(project);
  if (!validateBrandProfile(brand)) throw new Error('Invalid brand.');
  const next = clone(project);
  const selected = new Set(selection);
  for (const page of next.pages) for (const object of page.objects) {
    if (!selected.has(object.id) || object.locked) continue;
    const assigned = assignments[object.id] ?? object.brandRoles;
    if (!assigned) continue;
    if (assigned.fill) {
      object.fill = brand.colors[assigned.fill];
      if (object.kind === 'text' && object.textRuns) object.textRuns = object.textRuns.map(run => ({ ...run, color: object.fill }));
    }
    if (assigned.stroke) object.stroke = brand.colors[assigned.stroke];
    if (assigned.textStyle && object.kind === 'text') {
      const style = brand.textStyles[assigned.textStyle];
      object.fontFamily = style.fontFamily;
      object.fontSize = style.fontSize;
      if (object.textRuns) object.textRuns = object.textRuns.map(run => ({ ...run, fontSize: style.fontSize,
        bold: style.fontFamily.includes('Bold'), italic: style.fontFamily.includes('Italic') }));
    }
  }
  validateProject(next);
  return next;
}

export function loadBrandProfiles(storage: Storage = localStorage): BrandProfile[] {
  const text = storage.getItem(BRAND_PROFILES_KEY);
  if (!text) return [];
  if (text.length > 1024 * 1024) throw new Error('Brand library is too large.');
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 20 || !value.every(validateBrandProfile)) throw new Error('Invalid brand library.');
  return clone(value);
}
export function saveBrandProfile(profile: BrandProfile, storage: Storage = localStorage): void {
  if (!validateBrandProfile(profile)) throw new Error('Invalid brand.');
  const next = [...loadBrandProfiles(storage).filter(item => item.id !== profile.id), clone(profile)];
  if (next.length > 20) throw new Error('Brand library is full.');
  const text = JSON.stringify(next);
  if (text.length > 1024 * 1024) throw new Error('Brand library is too large.');
  storage.setItem(BRAND_PROFILES_KEY, text);
}
export function deleteBrandProfile(id: string, storage: Storage = localStorage): void {
  storage.setItem(BRAND_PROFILES_KEY, JSON.stringify(loadBrandProfiles(storage).filter(item => item.id !== id)));
}
export function exportBrandProfiles(profiles: readonly BrandProfile[]): string {
  if (profiles.length > 20 || !profiles.every(validateBrandProfile)) throw new Error('Invalid brand export.');
  return JSON.stringify({ version: 1, profiles });
}
export function importBrandProfiles(text: string): BrandProfile[] {
  if (text.length > 1024 * 1024) throw new Error('Brand import is too large.');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('Invalid brand import.');
  const payload = value as { version?: unknown; profiles?: unknown };
  if (payload.version !== 1 || !Array.isArray(payload.profiles) || payload.profiles.length > 20 ||
      !payload.profiles.every(validateBrandProfile)) throw new Error('Invalid brand import.');
  return clone(payload.profiles);
}
