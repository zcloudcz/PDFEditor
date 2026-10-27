import forge from 'node-forge';
import { PDFArray, PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { loadBoundedObjectDocument } from '../pdf/bounded-objects';
import { createRedactionDecoder } from '../pdf/redaction-bounded-decode';
import type { StudioPage, StudioProject } from './types';
import { base64Bytes } from './project-validation';

// Only hashes are retained, never source bytes, document handles or document names.
const verified = new Set<string>();
let epoch = 0;
export const clearDesignProvenance = () => { ++epoch; verified.clear(); };
const maxEncodedSource = 4 * Math.ceil(50 * 1024 * 1024 / 3);
export function designSourceHash(source: string): string {
  if (source.length > maxEncodedSource) throw new Error('limit-exceeded');
  const hash = forge.md.sha256.create();
  for (let start = 0; start < source.length; start += 65536) hash.update(source.slice(start, start + 65536), 'raw');
  return hash.digest().toHex();
}
const key = (hash: string, index: number) => `${hash}:${index}`;
// PDFium stores page boxes as float32 before serializing decimal coordinates.
const sameDimension = (actual: number, expected: number) => Number.isFinite(actual) && Number.isFinite(expected) &&
  Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 2 ** -23);
export function designPagePredicate(project: StudioProject): (page: StudioPage) => boolean {
  let hash: string | undefined;
  return page => {
    if (page.sourcePageIndex === undefined) return true;
    if (!project.sourcePdf || !page.syntheticBackground) return false;
    hash ??= designSourceHash(project.sourcePdf);
    return page.syntheticBackground === hash && verified.has(key(hash, page.sourcePageIndex));
  };
}
export function isDesignPage(project: StudioProject, page: StudioPage): boolean {
  return designPagePredicate(project)(page);
}

/** Untrusted serialized provenance is evidence only after checking the actual PDF. */
export async function verifyDesignProvenance(project: StudioProject): Promise<void> {
  const started = epoch;
  const candidates = project.pages.filter(page => page.syntheticBackground !== undefined);
  if (!candidates.length || !project.sourcePdf) return;
  const hash = designSourceHash(project.sourcePdf);
  const pending = candidates.filter(page => page.syntheticBackground === hash && page.sourcePageIndex !== undefined && !verified.has(key(hash, page.sourcePageIndex)));
  if (!pending.length) return;
  const source = await loadBoundedObjectDocument(base64Bytes(project.sourcePdf));
  const decode = createRedactionDecoder(16384, Math.min(4 * 1024 * 1024, pending.length * 32768));
  const accepted: string[] = [];
  const canonicalSizes: { page: StudioPage; width: number; height: number }[] = [];
  for (const page of pending) {
    const native = source.getPage(page.sourcePageIndex!);
    if (native.node.Annots()?.size()) throw new Error('Synthetic page contains native annotations.');
    const box = native.getMediaBox(), crop = native.getCropBox();
    if (native.getRotation().angle !== 0 || box.x !== 0 || box.y !== 0 || !sameDimension(box.width, page.width) || !sameDimension(box.height, page.height) ||
        crop.x !== 0 || crop.y !== 0 || crop.width !== box.width || crop.height !== box.height ||
        native.node.has(PDFName.of('UserUnit')) || native.node.has(PDFName.of('Group'))) throw new Error('Invalid synthetic page geometry.');
    const resources = native.node.Resources();
    for (const [name, value] of resources?.entries() ?? []) {
      const resource = source.context.lookup(value);
      if (!['/Font', '/XObject', '/ExtGState'].includes(name.toString()) || !(resource instanceof PDFDict) || resource.keys().length !== 0)
        throw new Error('Synthetic page contains native resources.');
    }
    const contents = native.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    let text = '';
    for (const ref of refs) {
      const stream = source.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('Invalid synthetic page content.');
      const data = decode(stream);
      if (data.length > 16384 || text.length + data.length > 16384) throw new Error('Invalid synthetic page content.');
      text += ` ${new TextDecoder().decode(data)}`;
    }
    const { exportPdf } = await import('./exports');
    const expectedBytes = await exportPdf({ version: 1, name: '', pages: [{ ...page, sourcePageIndex: undefined, syntheticBackground: undefined, objects: [] }] });
    const expectedDoc = await PDFDocument.load(expectedBytes, { updateMetadata: false });
    const expectedContents = expectedDoc.getPage(0).node.Contents();
    const expectedRefs = expectedContents instanceof PDFArray ? expectedContents.asArray() : expectedContents ? [expectedContents] : [];
    const expected = expectedRefs.map(ref => {
      const stream = expectedDoc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('Invalid synthetic reference.');
      return new TextDecoder().decode(decode(stream));
    }).join(' ');
    const tokens = (value: string) => value.trim().split(/\s+/).filter(Boolean);
    const actualTokens = tokens(text), expectedTokens = tokens(expected);
    if (actualTokens.length !== expectedTokens.length || actualTokens.some((token, index) => {
      const wanted = expectedTokens[index];
      if (token === wanted) return false;
      if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(token) || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(wanted)) return true;
      const dimension = Number(wanted) === page.width || Number(wanted) === page.height;
      return dimension ? !sameDimension(Number(token), Number(wanted)) : Math.abs(Number(token) - Number(wanted)) > 1e-7;
    })) throw new Error('Synthetic page contains native content.');
    if (native.node.has(PDFName.of('AA'))) throw new Error('Synthetic page contains native actions.');
    accepted.push(key(hash, page.sourcePageIndex!));
    canonicalSizes.push({ page, width: box.width, height: box.height });
  }
  if (started !== epoch) throw new Error('Document changed during provenance verification.');
  for (const { page, width, height } of canonicalSizes) Object.assign(page, { width, height });
  for (const item of accepted) {
    verified.add(item);
    if (verified.size > 4096) verified.delete(verified.values().next().value!);
  }
}

export async function markSyntheticPages(project: StudioProject, indices: readonly number[]): Promise<void> {
  if (!project.sourcePdf || !indices.length) return;
  const hash = designSourceHash(project.sourcePdf);
  for (const index of indices) project.pages[index].syntheticBackground = hash;
  await verifyDesignProvenance(project);
}
