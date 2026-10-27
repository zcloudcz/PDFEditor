import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { loadBoundedObjectDocument as loadNavigationDocument } from './bounded-objects';

export class AccessibilityError extends Error {
  constructor(public readonly code: 'unsupported-structure' | 'invalid-tag-tree' | 'invalid-change' | 'limit-exceeded' | 'cancelled') { super(code); this.name = 'AccessibilityError'; }
}
export interface TagNode { id: string; parentId: string; role: string; pageIndex: number | null; children: string[]; alt: string | null; language: string | null; scope: string | null }
export interface TagTree { language: string | null; children: string[]; nodes: TagNode[] }
export type TagEdit =
  | { kind: 'role'; id: string; role: string }
  | { kind: 'alt'; id: string; text: string }
  | { kind: 'language'; id?: string; language: string }
  | { kind: 'scope'; id: string; scope: 'Row' | 'Column' | 'Both' }
  | { kind: 'order'; parentId: string; children: readonly string[] }
  | { kind: 'form-label'; fieldId: string; text: string };
const k = PDFName.of;
const roles = new Set('Document Part Art Sect Div BlockQuote Caption TOC TOCI Index NonStruct Private P H H1 H2 H3 H4 H5 H6 L LI Lbl LBody Table TR TH TD THead TBody TFoot Span Quote Note Reference BibEntry Code Link Annot Ruby RB RT RP Warichu WT WP Figure Formula Form'.split(' '));
export function accessibilityFail(code: ConstructorParameters<typeof AccessibilityError>[0]): never { throw new AccessibilityError(code); }
/** Validate before pdf-lib's recursive getFields(), which revisits shared Kids. */
export function validateFormTree(doc: PDFDocument): void {
  const raw = doc.catalog.get(k('AcroForm')); if (!raw) return;
  const form = doc.context.lookup(raw);
  if (!(form instanceof PDFDict)) accessibilityFail('unsupported-structure');
  const seen = new Set<PDFDict>(); let count = 0;
  const walk = (rawArray: PDFObject, depth: number): void => {
    if (depth > 64) accessibilityFail('limit-exceeded');
    const array = doc.context.lookup(rawArray);
    if (!(array instanceof PDFArray)) return accessibilityFail('unsupported-structure');
    if (array.size() > 20000 - count) accessibilityFail('limit-exceeded');
    for (const rawField of array.asArray()) {
      const field = doc.context.lookup(rawField);
      if (!(field instanceof PDFDict) || seen.has(field)) return accessibilityFail('unsupported-structure');
      if (++count > 20000) accessibilityFail('limit-exceeded');
      seen.add(field); const kids = field.get(k('Kids')); if (kids) walk(kids, depth + 1);
    }
  };
  const fields = (form as PDFDict).get(k('Fields')); if (fields) walk(fields, 0);
}
function text(doc: PDFDocument, raw: PDFObject | undefined): string | null {
  if (!raw) return null; const value = doc.context.lookup(raw);
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return accessibilityFail('invalid-tag-tree');
  if (value.decodeText().length > 10000) accessibilityFail('limit-exceeded'); return value.decodeText();
}
function integer(doc: PDFDocument, raw: PDFObject | undefined): number {
  const value = raw && doc.context.lookup(raw);
  if (!(value instanceof PDFNumber) || !Number.isSafeInteger(value.asNumber()) || value.asNumber() < 0) return accessibilityFail('invalid-tag-tree');
  return value.asNumber();
}
interface Parsed { tree: TagTree; root: PDFDict; dicts: Map<string, PDFDict> }

/** Existing standard-role tags only. Stream MCIDs, custom roles and PDF 2 namespaces are refused. */
export function parseTagTree(doc: PDFDocument): Parsed {
  const root = doc.context.lookup(doc.catalog.get(k('StructTreeRoot')));
  if (!(root instanceof PDFDict)) return accessibilityFail('unsupported-structure');
  if (root.get(k('Type')) !== k('StructTreeRoot')) accessibilityFail('invalid-tag-tree');
  if (['RoleMap', 'Namespaces', 'AF'].some(name => root.has(k(name)))) accessibilityFail('unsupported-structure');
  const rootRaw = doc.catalog.get(k('StructTreeRoot'));
  if (!(rootRaw instanceof PDFRef)) accessibilityFail('unsupported-structure');
  const pages = doc.getPages(); const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const dicts = new Map<string, PDFDict>(); const nodes: TagNode[] = []; const visited = new Set<PDFObject>();
  const claims: Array<{ parent: PDFRef; page: PDFRef; mcid: number }> = [];
  const objectClaims: Array<{ parent: PDFRef; object: PDFRef; page: PDFRef }> = [];
  let count = 0;
  const walk = (raw: PDFObject, parent: PDFRef, parentId: string, inheritedPage: PDFRef | undefined, depth: number): string[] => {
    if (++count > 20000 || depth > 64) return accessibilityFail('limit-exceeded');
    const value = doc.context.lookup(raw);
    if (value instanceof PDFNumber) {
      if (!inheritedPage) accessibilityFail('invalid-tag-tree');
      claims.push({ parent, page: inheritedPage!, mcid: integer(doc, value) }); return [];
    }
    if (value instanceof PDFArray) {
      if (visited.has(value)) accessibilityFail('invalid-tag-tree'); visited.add(value);
      return value.asArray().flatMap(child => walk(child, parent, parentId, inheritedPage, depth + 1));
    }
    if (!(value instanceof PDFDict) || visited.has(value)) return accessibilityFail('invalid-tag-tree'); visited.add(value);
    const pageRaw = value.get(k('Pg')) ?? inheritedPage;
    if (pageRaw && (!(pageRaw instanceof PDFRef) || !pageIndex.has(pageRaw.toString()))) accessibilityFail('invalid-tag-tree');
    const page = pageRaw as PDFRef | undefined;
    const type = value.get(k('Type'));
    if (type === k('MCR')) {
      if (value.has(k('Stm')) || value.has(k('StmOwn'))) accessibilityFail('unsupported-structure');
      if (!page) accessibilityFail('invalid-tag-tree'); claims.push({ parent, page: page!, mcid: integer(doc, value.get(k('MCID'))) }); return [];
    }
    if (type === k('OBJR')) {
      const object = value.get(k('Obj'));
      if (!(object instanceof PDFRef) || !page) accessibilityFail('invalid-tag-tree');
      objectClaims.push({ parent, object: object as PDFRef, page: page! }); return [];
    }
    if (type !== k('StructElem') || !(raw instanceof PDFRef)) return accessibilityFail('unsupported-structure');
    const ownParent = value.get(k('P'));
    if (!(ownParent instanceof PDFRef) || ownParent.toString() !== parent.toString()) accessibilityFail('invalid-tag-tree');
    const role = value.get(k('S'));
    if (!(role instanceof PDFName) || !roles.has(role.decodeText()) || value.has(k('NS'))) accessibilityFail('unsupported-structure');
    const id = raw.toString(); dicts.set(id, value);
    const attrsRaw = value.get(k('A')), attrs = attrsRaw && doc.context.lookup(attrsRaw);
    if (attrs && !(attrs instanceof PDFDict)) accessibilityFail('unsupported-structure');
    const scope = attrs instanceof PDFDict ? attrs.get(k('Scope')) : undefined;
    const node: TagNode = { id, parentId, role: role.decodeText(), pageIndex: page ? pageIndex.get(page.toString())! : null, children: [], alt: text(doc, value.get(k('Alt'))), language: text(doc, value.get(k('Lang'))), scope: scope instanceof PDFName ? scope.decodeText() : null };
    nodes.push(node); const children = value.get(k('K')); if (children) node.children = walk(children, raw, id, page, depth + 1);
    return [id];
  };
  const childrenRaw = root.get(k('K'));
  const children = childrenRaw ? walk(childrenRaw, rootRaw as PDFRef, 'root', undefined, 0) : [];
  const parentEntries = new Map<number, PDFObject>(); const seenNumbers = new Set<PDFObject>();
  const numberTree = (raw: PDFObject, depth: number) => {
    const value = doc.context.lookup(raw);
    if (!(value instanceof PDFDict) || seenNumbers.has(value)) accessibilityFail('invalid-tag-tree');
    if (depth > 32 || seenNumbers.size > 10000) accessibilityFail('limit-exceeded'); seenNumbers.add(value);
    const numsRaw = value.get(k('Nums')), kidsRaw = value.get(k('Kids'));
    if (!!numsRaw === !!kidsRaw) accessibilityFail('invalid-tag-tree');
    const array = doc.context.lookup((numsRaw ?? kidsRaw)!); if (!(array instanceof PDFArray)) return accessibilityFail('invalid-tag-tree');
    if (array.size() > 20000) accessibilityFail('limit-exceeded');
    if (kidsRaw) { for (const kid of array.asArray()) numberTree(kid, depth + 1); return; }
    if (array.size() % 2) accessibilityFail('invalid-tag-tree');
    let last = -1;
    for (let i = 0; i < array.size(); i += 2) { const index = integer(doc, array.get(i)); if (index <= last || parentEntries.has(index)) accessibilityFail('invalid-tag-tree'); if (parentEntries.size >= 20000) accessibilityFail('limit-exceeded'); last = index; parentEntries.set(index, array.get(i + 1)); }
  };
  const pt = root.get(k('ParentTree')); if (pt) numberTree(pt, 0); else if (claims.length || objectClaims.length) accessibilityFail('invalid-tag-tree');
  const claimed = new Set<string>();
  for (const claim of claims) {
    const p = pages[pageIndex.get(claim.page.toString())!]; const index = integer(doc, p.node.get(k('StructParents')));
    const entriesRaw = parentEntries.get(index), entries = entriesRaw && doc.context.lookup(entriesRaw);
    if (!(entries instanceof PDFArray) || claim.mcid >= entries.size()) accessibilityFail('invalid-tag-tree');
    const owner = (entries as PDFArray).get(claim.mcid); const token = `${index}:${claim.mcid}`;
    if (!(owner instanceof PDFRef) || owner.toString() !== claim.parent.toString() || claimed.has(token)) accessibilityFail('invalid-tag-tree'); claimed.add(token);
  }
  const objectParentIndexes = new Set<number>();
  for (const claim of objectClaims) {
    const object = doc.context.lookup(claim.object); if (!(object instanceof PDFDict)) accessibilityFail('invalid-tag-tree');
    const index = integer(doc, (object as PDFDict).get(k('StructParent'))); const owner = parentEntries.get(index);
    if (objectParentIndexes.has(index)) accessibilityFail('invalid-tag-tree'); objectParentIndexes.add(index);
    const annotsRaw = pages[pageIndex.get(claim.page.toString())!].node.get(k('Annots')); const annots = annotsRaw && doc.context.lookup(annotsRaw);
    if (!(owner instanceof PDFRef) || owner.toString() !== claim.parent.toString() || !(annots instanceof PDFArray) || !annots.asArray().some(ref => ref.toString() === claim.object.toString())) accessibilityFail('invalid-tag-tree');
  }
  // Also reject stale/extra reverse links instead of trusting only forward claims.
  const pageParentIndexes = new Set<number>();
  for (const page of pages) {
    if (!page.node.has(k('StructParents'))) continue;
    const index = integer(doc, page.node.get(k('StructParents'))); const raw = parentEntries.get(index); const entries = raw && doc.context.lookup(raw);
    if (pageParentIndexes.has(index)) accessibilityFail('invalid-tag-tree'); pageParentIndexes.add(index);
    if (objectParentIndexes.has(index)) accessibilityFail('invalid-tag-tree');
    if (!(entries instanceof PDFArray)) accessibilityFail('invalid-tag-tree');
    if ((entries as PDFArray).size() > 20000) accessibilityFail('limit-exceeded');
    for (let i = 0; i < (entries as PDFArray).size(); i++) if ((entries as PDFArray).get(i) !== PDFNull && !claimed.has(`${index}:${i}`)) accessibilityFail('invalid-tag-tree');
  }
  if ([...parentEntries.keys()].some(index => !pageParentIndexes.has(index) && !objectParentIndexes.has(index))) accessibilityFail('invalid-tag-tree');
  return { tree: { language: text(doc, doc.catalog.get(k('Lang'))), children, nodes }, root, dicts };
}
export async function readTagTree(bytes: Uint8Array): Promise<TagTree> { return parseTagTree(await loadNavigationDocument(bytes)).tree; }
function checkString(value: unknown, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) accessibilityFail('invalid-change');
}
export async function applyTagEdits(bytes: Uint8Array, edits: readonly TagEdit[], signal?: AbortSignal): Promise<Uint8Array> {
  const cancelled = () => { if (signal?.aborted) accessibilityFail('cancelled'); }; cancelled();
  if (!Array.isArray(edits) || edits.length > 1000) accessibilityFail('invalid-change');
  const input = bytes.slice(); const changes = structuredClone(edits); const doc = await loadNavigationDocument(input); cancelled();
  // Existing trees must remain valid; absent tags do not block catalog/form-only edits.
  const needsTags = changes.some(edit => edit.kind !== 'form-label' && !(edit.kind === 'language' && !edit.id));
  const parsed = doc.catalog.has(k('StructTreeRoot')) || needsTags ? parseTagTree(doc) : undefined;
  for (const edit of changes) {
    cancelled();
    if (edit.kind === 'form-label') {
      const form = doc.catalog.lookupMaybe(k('AcroForm'), PDFDict);
      if (form?.has(k('XFA'))) accessibilityFail('unsupported-structure');
      checkString(edit.text); validateFormTree(doc); const field = doc.getForm().getFields().find(f => f.ref.toString() === edit.fieldId);
      if (!field) accessibilityFail('invalid-change'); field!.acroField.dict.set(k('TU'), PDFHexString.fromText(edit.text)); continue;
    }
    if (edit.kind === 'order') {
      if (!parsed) return accessibilityFail('unsupported-structure');
      const parent = edit.parentId === 'root' ? parsed.root : parsed.dicts.get(edit.parentId);
      if (!parent || !Array.isArray(edit.children)) accessibilityFail('invalid-change');
      const raw = parent!.get(k('K')); const object = raw && doc.context.lookup(raw); const previous = object instanceof PDFArray ? object.asArray() : raw ? [raw] : [];
      if (previous.some(ref => !(ref instanceof PDFRef) || !parsed.dicts.has(ref.toString())) || edit.children.length !== previous.length || new Set(edit.children).size !== previous.length || edit.children.some((id: string) => !previous.some(ref => ref.toString() === id))) accessibilityFail('invalid-change');
      parent!.set(k('K'), doc.context.obj(edit.children.map((id: string) => previous.find(ref => ref.toString() === id)!))); continue;
    }
    const target = edit.kind === 'language' && !edit.id ? doc.catalog : parsed?.dicts.get(edit.id!);
    if (!target) accessibilityFail('invalid-change');
    if (edit.kind === 'language') {
      if (typeof edit.language !== 'string' || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(edit.language) || edit.language.length > 64) accessibilityFail('invalid-change');
      target!.set(k('Lang'), PDFHexString.fromText(edit.language));
    } else if (edit.kind === 'alt') { checkString(edit.text); target!.set(k('Alt'), PDFHexString.fromText(edit.text)); }
    else if (edit.kind === 'role') { if (!roles.has(edit.role)) accessibilityFail('invalid-change'); target!.set(k('S'), k(edit.role)); }
    else if (edit.kind === 'scope') {
      if (target!.get(k('S')) !== k('TH') || !['Row', 'Column', 'Both'].includes(edit.scope)) accessibilityFail('invalid-change');
      const raw = target!.get(k('A')); const attrs = raw ? doc.context.lookup(raw) : doc.context.obj({ O: 'Table' });
      if (!(attrs instanceof PDFDict) || attrs.get(k('O')) !== k('Table')) accessibilityFail('unsupported-structure');
      const local = (attrs as PDFDict).clone(); local.set(k('Scope'), k(edit.scope)); target!.set(k('A'), local);
    } else accessibilityFail('invalid-change');
  }
  if (parsed) parseTagTree(doc); cancelled(); if (!changes.length) return input;
  const result = await doc.save({ updateFieldAppearances: false }); cancelled(); return result;
}
