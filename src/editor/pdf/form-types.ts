export type FormKind = 'text' | 'checkbox' | 'radio' | 'choice';
export type FormValue = string | boolean | string[];
export interface FormField { id: string; name: string; kind: FormKind | 'unsupported'; value: FormValue; options: string[]; multiline?: boolean; multiSelect?: boolean; readOnly: boolean; required: boolean; widgets: Array<{ pageIndex: number; rect: [number, number, number, number] }> }
export type FormChange =
  | { kind: 'tab-order'; pageIndex: number; order: 'row' | 'column' }
  | { kind: 'set-value'; id: string; value: FormValue }
  | { kind: 'remove'; id: string }
  | { kind: 'properties'; id: string; readOnly?: boolean; required?: boolean }
  | { kind: 'move'; id: string; widgetIndex: number; rect: [number, number, number, number] }
  | { kind: 'create'; name: string; fieldKind: FormKind; pageIndex: number; rect: [number, number, number, number]; options?: string[]; required?: boolean };
