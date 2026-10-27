export type AnnotationKind = 'Highlight' | 'Underline' | 'StrikeOut' | 'Text' | 'Ink' | 'Stamp';
export interface AnnotationDraft { pageIndex: number; subtype: AnnotationKind; rect: [number, number, number, number]; contents: string; author?: string; color?: [number, number, number]; quadPoints?: number[]; inkPaths?: number[][]; replyTo?: string; importId?: string; resolved?: boolean }
export interface PdfAnnotation extends AnnotationDraft { id: string; resolved: boolean }
export type AnnotationChange = { kind: 'add'; annotation: AnnotationDraft } | { kind: 'remove'; id: string } | { kind: 'comment'; id: string; contents: string } | { kind: 'resolve'; id: string; resolved: boolean };
