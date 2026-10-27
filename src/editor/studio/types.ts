/** Portable design coordinates use PDF points, measured from the page's top-left. */
import type { DataTable } from '../data/table';
import type { ChartSpec } from '../data/charts';
export type StudioObjectKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'path' | 'text' | 'image';
export interface StudioTextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; fontSize?: number; color?: string }
export interface StudioObject {
  id: string;
  kind: StudioObjectKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  locked: boolean;
  groupId?: string;
  layoutAnchors?: { horizontal: 'start' | 'center' | 'end' | 'stretch'; vertical: 'start' | 'center' | 'end' | 'stretch' };
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textDirection?: 'auto' | 'ltr' | 'rtl';
  textLanguage?: 'und' | 'cs' | 'en' | 'ar' | 'hi' | 'ja';
  textAlign?: 'left' | 'center' | 'right';
  textRuns?: StudioTextRun[];
  underline?: boolean;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  paragraphSpacing?: number;
  tracking?: number;
  /** Vector effects. Shadow is deliberately hard-edged; no raster blur. */
  textShadow?: { x: number; y: number; color: string; opacity: number };
  textGradient?: { from: string; to: string };
  textPath?: { radius: number };
  /** Absent on legacy documents, whose explicit line breaks remain unchanged. */
  wrapText?: boolean;
  /** Built-in path data is normalized to a 100 by 100 viewBox. */
  path?: string;
  /** Embedded PNG/JPEG/WebP only; no network resource references. */
  src?: string;
  /** Normalized source-image crop rectangle. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Original image remains in src; these fields affect only rendering/export. */
  imageFit?: 'stretch' | 'contain' | 'cover';
  imageMask?: { kind: 'circle' } | { kind: 'rounded'; radius: number };
  imageAdjustments?: { brightness: number; contrast: number; saturation: number; blur: number };
  imageCutout?: { version: 1; seed?: { x: number; y: number; tolerance: number }; strokes: { mode: 'keep' | 'remove'; points: { x: number; y: number }[]; radius: number }[] };
  imageProvenance?: { kind: 'local-upload'; license: 'unspecified'; source: 'local upload' } | { kind: 'user-declared'; license: string; source: string };
  /** Explicit role assignment prevents accidental changes to custom colors and text. */
  brandRoles?: { fill?: 'primary' | 'accent' | 'paper'; stroke?: 'primary' | 'accent' | 'paper'; textStyle?: 'heading' | 'body' };
}
export interface StudioPage {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  /** Zero-based index into sourcePdf; absent for a design-only page. */
  sourcePageIndex?: number;
  /** SHA-256 of a verified blank native viewport source; never a user editor mode. */
  syntheticBackground?: string;
  objects: StudioObject[];
}
export interface StudioProject {
  version: 1;
  name: string;
  /** Base64 original/current native PDF snapshot. Never logged. */
  sourcePdf?: string;
  pages: StudioPage[];
  dataTables?: DataTable[];
  dataCharts?: ChartSpec[];
}
export interface StudioNativeSurface {
  container: HTMLElement;
  pageIndex: number;
  width: number;
  height: number;
  zoom: number;
}
export interface StudioController {
  getProject(): StudioProject;
  setProject(project: StudioProject, options?: { recordHistory?: boolean }): void;
  getActivePageId(): string;
  getViewState?(): { pageId: string; selectedIds: string[] };
  restoreViewState?(view: { pageId?: string; pageIndex?: number; selectedIds: string[] }): void;
  refreshHistory?(): void;
  attachNativeSurface?(surface: StudioNativeSurface): void;
  detachNativeSurface?(): void;
  clearSelection?(): void;
  updateNativeSource?(sourcePdf: string): void;
  setPageBackground(pageId: string, dataURL: string): void;
  setGuides?(pageId: string, guides: readonly { axis: 'x' | 'y'; position: number }[]): void;
  getGuides?(pageId: string): { axis: 'x' | 'y'; position: number }[];
  destroy(): void;
  /** Explicit retirement of this document's references; does not touch libraries. */
  purgeForSanitization?(): Promise<void>;
}
export interface StudioHistoryDelegate {
  structuralChange?(prepare: (project: StudioProject) => { project: StudioProject; pageId?: string }): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
