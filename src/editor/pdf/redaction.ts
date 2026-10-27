import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';
import { nativeRedactCopy, type NativeRedactionRect } from './native-redaction';
import { STRICT_SANITIZATION, type SanitizationPolicy } from './sanitization-policy';
import { profileDocument } from './structure-profile';
import { createRedactionDecoder, loadRedactionDocument, RedactionDecodeLimitError } from './redaction-bounded-decode';
import { validateRetainedRedactionGraph } from './redaction-retained-schema';

export type RedactionMark = NativeRedactionRect;
export class RedactionError extends Error {
  constructor(public readonly code: 'invalid-input' | 'unsupported-structure' | 'native-failure' | 'verification-failed' | 'limit-exceeded') {
    super(code); this.name = 'RedactionError';
  }
}
export interface PreparedRedaction {
  readonly bytes: Uint8Array;
  /** Native removal plus structural cleanup is not an independent security certificate. */
  readonly proof: 'native-removal-and-rewritten-structure';
  readonly appliedMarks: number;
  readonly discardedObjects: number;
  readonly requiresRecoveryPurge: true;
  readonly requiresIndependentReview: true;
}
const key = PDFName.of;
function fail(code: RedactionError['code']): never { throw new RedactionError(code); }

function assertProfile(doc: PDFDocument, nativeOutput = false, decode = createRedactionDecoder()): void {
  const profile = profileDocument(doc);
  if (profile.pageCount === null || profile.pageCount < 1 || profile.pageCount > 200) fail('unsupported-structure');
  if (profile.issues.length || profile.unknownCatalogKeys.length) fail('unsupported-structure');
  for (const type of ['forms', 'outlines', 'destinations', 'tags', 'encryption', 'signatures', 'optionalContent'] as const) {
    if (profile[type] !== 'absent') fail('unsupported-structure');
  }
  // Unknown active content or relationships can retain a copy of the target data.
  for (const page of doc.getPages()) {
    if (['Metadata', 'PieceInfo', 'AA', 'AF', 'PresSteps', 'VP', 'B', 'Dur', 'Trans'].some(name => page.node.has(key(name)))) fail('unsupported-structure');
  }
  const visited = new Set<PDFObject>();
  const inspect = (object: PDFObject, depth: number): void => {
    if (object instanceof PDFRef || visited.has(object)) return;
    if (depth > 64 || visited.size > 100000) fail('limit-exceeded');
    visited.add(object);
    const value = object instanceof PDFStream ? object.dict : object;
    if (value instanceof PDFDict) {
      // Native PDFium resolves indirect names, so a direct comparison here must
      // never treat an indirect type/subtype as an unrelated safe object.
      const type = value.get(key('Type')), subtype = value.get(key('Subtype'));
      if ((type !== undefined && !(type instanceof PDFName)) ||
        (subtype !== undefined && !(subtype instanceof PDFName))) fail('unsupported-structure');
      if (['JS', 'JavaScript', 'AA', 'XFA', 'RichMedia', 'Collection', 'SMask', 'OC', 'OCG', 'OCMD'].some(name => value.has(key(name)))) fail('unsupported-structure');
      // Glyph programs and multicharacter CMaps can retain the selected text
      // independently of page content. They need object-level proof first.
      if (value.get(key('Subtype')) === key('Type3') || value.has(key('ToUnicode'))) fail('unsupported-structure');
      // A Form with no Resources can inherit its caller's XObject names. Our
      // local-resource traversal cannot prove whether it invokes another Form.
      if (object instanceof PDFStream && subtype === key('Form') && !value.has(key('Resources'))) fail('unsupported-structure');
      // Marked-content replacement strings and named property dictionaries may
      // preserve a secret even after the visible glyph operators are removed.
      if (value.keys().some(name => ['ActualText', 'Alt', 'E', 'Properties'].includes(name.decodeText()))) fail('unsupported-structure');
      for (const [, child] of value.entries()) inspect(child, depth + 1);
    } else if (value instanceof PDFArray) for (const child of value.asArray()) inspect(child, depth + 1);
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) inspect(object, 0);
  assertNoSharedXObjects(doc, nativeOutput, decode);
}

/** The pinned native redactor overwrites image streams in place. A reused XObject
 * would change another placement, so this conservative profile rejects it. */
function assertNoSharedXObjects(doc: PDFDocument, nativeOutput: boolean, decode: ReturnType<typeof createRedactionDecoder>): void {
  const refs = new Set<string>();
  const inspectResources = (resources: PDFObject | undefined, insideForm = false): void => {
    if (!resources) return;
    const dict = doc.context.lookup(resources);
    if (!(dict instanceof PDFDict)) fail('unsupported-structure');
    // Resource families that can evaluate independent content (masks, patterns,
    // shadings, optional graphics state) require their own redactor traversal.
    for (const [name, resource] of dict.entries()) {
      if (['Font', 'XObject', 'ProcSet'].includes(name.decodeText())) continue;
      const resolved = doc.context.lookup(resource);
      if (nativeOutput && name.decodeText() === 'ExtGState') {
        if (!(resolved instanceof PDFDict)) fail('unsupported-structure');
        for (const [stateName, stateValue] of resolved.entries()) {
          const state = doc.context.lookup(stateValue);
          if (!/^FXE\d+$/.test(stateName.decodeText()) || !(state instanceof PDFDict) || state.keys().length !== 3 ||
            state.get(key('BM'))?.toString() !== '/Normal' || state.get(key('CA'))?.toString() !== '1' || state.get(key('ca'))?.toString() !== '1') fail('unsupported-structure');
        }
        continue;
      }
      if (!(resolved instanceof PDFDict) || resolved.keys().length) fail('unsupported-structure');
    }
    const xobject = dict.get(key('XObject'));
    if (!xobject) return;
    const entries = doc.context.lookup(xobject);
    if (!(entries instanceof PDFDict)) fail('unsupported-structure');
    for (const [, value] of entries.entries()) {
      if (!(value instanceof PDFRef) || refs.has(value.toString())) fail('unsupported-structure');
      refs.add(value.toString());
      const target = doc.context.lookup(value);
      // The pinned redactor composes nested Form placement matrices incorrectly
      // for some scale/rotation/translation combinations.
      if (insideForm && target instanceof PDFStream && target.dict.get(key('Subtype')) === key('Form')) fail('unsupported-structure');
    }
  };
  const inspectContents = (contents: PDFObject | undefined): void => {
    if (!contents) return;
    const resolved = doc.context.lookup(contents);
    const streams = resolved instanceof PDFArray ? resolved.asArray().map(value => doc.context.lookup(value)) : [resolved];
    let uses = 0;
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) fail('unsupported-structure');
      let data: string;
      try { data = new TextDecoder('latin1').decode(decode(stream)); }
      catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'unsupported-structure'); }
      if (/\b(?:BDC|BMC|EMC)\b/.test(data)) fail('unsupported-structure');
      const matches = data.match(/\/[!#$&'*+,.0-9:;=?@A-Z\\^_`a-z|~#-]+\s+Do(?=\s|$)/g) ?? [];
      // Reject malformed/unsupported invocation syntax instead of silently missing it.
      if ((data.match(/\bDo\b/g) ?? []).length !== matches.length) fail('unsupported-structure');
      uses += matches.length;
    }
    if (uses > 1) fail('unsupported-structure');
  };
  for (const page of doc.getPages()) {
    inspectResources(page.node.Resources());
    inspectContents(page.node.get(key('Contents')));
  }
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(key('Subtype')) !== key('Form')) continue;
    inspectResources(object.dict.get(key('Resources')), true);
    inspectContents(object);
  }
}

function assertMarks(doc: PDFDocument, marks: readonly RedactionMark[]): void {
  if (!Array.isArray(marks) || !marks.length || marks.length > 1000) fail('invalid-input');
  const pages = doc.getPages();
  for (const mark of marks) {
    if (!mark || !Number.isInteger(mark.pageIndex) || mark.pageIndex < 0 || mark.pageIndex >= pages.length ||
      !Array.isArray(mark.rect) || mark.rect.length !== 4 || mark.rect.some((value: number) => !Number.isFinite(value))) fail('invalid-input');
    const [x, y, width, height] = mark.rect;
    const crop = pages[mark.pageIndex].getCropBox();
    if (width < 0.5 || height < 0.5 || x < crop.x || y < crop.y || x + width > crop.x + crop.width || y + height > crop.y + crop.height) fail('invalid-input');
    if (Math.max(Math.abs(x), Math.abs(y), width, height) > 100000) fail('limit-exceeded');
  }
}

function removeHiddenData(doc: PDFDocument): void {
  // Drop document-wide data, not merely visible page annotations.
  for (const name of ['Metadata', 'Names', 'AF', 'OpenAction', 'AA', 'Collection', 'PieceInfo', 'Lang', 'PageLabels', 'ViewerPreferences', 'Version', 'PageLayout', 'PageMode']) doc.catalog.delete(key(name));
  delete doc.context.trailerInfo.Info;
  delete doc.context.trailerInfo.ID;
  for (const page of doc.getPages()) { page.node.delete(key('Annots')); page.node.delete(key('Thumb')); }
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object;
    if (dict instanceof PDFDict) {
      dict.delete(key('Metadata'));
      dict.delete(key('PieceInfo'));
      dict.delete(key('AF'));
    }
  }
}

/** Remove unreferenced old content, attachment and annotation streams before serializing. */
function collectGarbage(doc: PDFDocument): number {
  const reached = new Set<string>(), visited = new Set<PDFObject>();
  const visit = (object: PDFObject | undefined, depth: number): void => {
    if (!object) return;
    if (depth > 256 || reached.size > 100000) fail('limit-exceeded');
    if (object instanceof PDFRef) {
      const id = object.toString(); if (reached.has(id)) return; reached.add(id);
      const target = doc.context.lookup(object); if (!target) fail('verification-failed');
      visit(target, depth + 1); return;
    }
    if (visited.has(object)) return; visited.add(object);
    const value = object instanceof PDFStream ? object.dict : object;
    if (value instanceof PDFDict) for (const [, child] of value.entries()) visit(child, depth + 1);
    else if (value instanceof PDFArray) for (const child of value.asArray()) visit(child, depth + 1);
  };
  visit(doc.context.trailerInfo.Root, 0);
  let removed = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) { doc.context.delete(ref); removed++; }
  }
  return removed;
}

/** Prepare a detached candidate. The host must purge history/recovery before treating it as applied. */
export async function prepareRedaction(bytes: Uint8Array, marks: readonly RedactionMark[], policy: SanitizationPolicy = STRICT_SANITIZATION, signal: AbortSignal = new AbortController().signal): Promise<PreparedRedaction> {
  signal.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > 50 * 1024 * 1024) fail('invalid-input');
  if (!policy || !policy.removeMetadata || !policy.removeAnnotations || !policy.removeAttachments || !policy.removeNamedData) fail('invalid-input');
  const input = bytes.slice();
  const decode = createRedactionDecoder();
  let original: PDFDocument;
  try { original = await loadRedactionDocument(input, decode); }
  catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'invalid-input'); }
  assertProfile(original, false, decode); assertMarks(original, marks);
  removeHiddenData(original); collectGarbage(original);
  try { validateRetainedRedactionGraph(original, false, decode, true); collectGarbage(original); } catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'unsupported-structure'); }
  // Canonical recompression discards bytes after the compressed stream terminator.
  for (const [ref, object] of original.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const entries = Object.fromEntries(object.dict.entries().filter(([name]) => !['Filter', 'Length'].includes(name.decodeText())).map(([name, value]) => [name.decodeText(), value]));
    original.context.assign(ref, original.context.flateStream(decode(object), entries));
  }
  const sanitizedInput = await original.save({ useObjectStreams: false, updateFieldAppearances: false });
  signal.throwIfAborted();
  let nativeBytes: Uint8Array;
  try { nativeBytes = await nativeRedactCopy(sanitizedInput, marks.map(mark => ({ pageIndex: mark.pageIndex, rect: [...mark.rect] as [number, number, number, number] })), signal); }
  catch (error) { signal.throwIfAborted(); throw new RedactionError('native-failure'); }
  signal.throwIfAborted();
  const decodeNative = createRedactionDecoder();
  let doc: PDFDocument;
  try { doc = await loadRedactionDocument(nativeBytes, decodeNative); }
  catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'verification-failed'); }
  if (doc.getPageCount() !== original.getPageCount()) fail('verification-failed');
  removeHiddenData(doc);
  try { validateRetainedRedactionGraph(doc, true, decodeNative, true); } catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'unsupported-structure'); }
  const discardedObjects = collectGarbage(doc);
  const output = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  signal.throwIfAborted();
  const decodeOutput = createRedactionDecoder();
  let check: PDFDocument;
  try { check = await loadRedactionDocument(output, decodeOutput); }
  catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'verification-failed'); }
  assertProfile(check, true, decodeOutput);
  try { validateRetainedRedactionGraph(check, true, decodeOutput); } catch (error) { return fail(error instanceof RedactionDecodeLimitError ? 'limit-exceeded' : 'unsupported-structure'); }
  const checkedProfile = profileDocument(check);
  if (checkedProfile.annotations !== 'absent' || checkedProfile.attachments !== 'absent' || check.context.trailerInfo.Info || check.catalog.has(key('Metadata')) || check.catalog.has(key('Names'))) fail('verification-failed');
  return { bytes: output, proof: 'native-removal-and-rewritten-structure', appliedMarks: marks.length, discardedObjects, requiresRecoveryPurge: true, requiresIndependentReview: true };
}




