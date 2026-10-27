import JSZip from 'jszip';
import { applyPageFurniture, type FurnitureSpec, utilityFail } from './page-furniture';
import { optimizePdf } from './optimize';
import { rotatePdfPages } from './page-operations';
import { loadStandardDocument } from './forms';

export interface BatchItem { name: string; bytes: Uint8Array }
export type PdfOperationSpec = { kind: 'furniture'; spec: FurnitureSpec } | { kind: 'optimize' } | { kind: 'rotate'; indices: readonly number[]; angle: number };
export type BatchOutcome = { index: number; status: 'success'; name: string; bytes: Uint8Array } | { index: number; status: 'failed' | 'cancelled'; name: string; code: string };
/** Produce one flat ZIP component, including for Windows paths, bidi/control text and device names. */
export function safeBatchFilename(input: string, index: number): string {
  let name = String(input).normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, '_').replace(/\.{2,}/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100);
  name = name.replace(/\.pdf$/i, ''); if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'document';
  return `${String(index + 1).padStart(3, '0')}-${name}.pdf`;
}
/** Sequential, bounded inputs. Only the current item is copied; callers consume each result before continuing. */
export async function* runPdfBatch(items: readonly BatchItem[], pipeline: readonly PdfOperationSpec[], signal: AbortSignal): AsyncGenerator<BatchOutcome> {
  if (!Array.isArray(items) || !items.length || items.length > 20 || !Array.isArray(pipeline) || !pipeline.length || pipeline.length > 10 || items.some(item => !(item.bytes instanceof Uint8Array) || !item.bytes.length || item.bytes.length > 50 * 1024 * 1024) || items.reduce((sum, item) => sum + item.bytes.length, 0) > 100 * 1024 * 1024) utilityFail('limit-exceeded');
  const operations = structuredClone(pipeline);
  let outputBytes = 0;
  for (const [index, item] of items.entries()) {
    const name = safeBatchFilename(item.name, index);
    if (signal.aborted) { yield { index, name, status: 'cancelled', code: 'cancelled' }; return; }
    try {
      let bytes = item.bytes.slice(); await loadStandardDocument(bytes);
      for (const operation of operations) {
        signal.throwIfAborted();
        if (operation.kind === 'furniture') bytes = await applyPageFurniture(bytes, operation.spec, { signal });
        else if (operation.kind === 'optimize') bytes = (await optimizePdf(bytes, { mode: 'lossless' }, signal)).bytes;
        else if (operation.kind === 'rotate') bytes = await rotatePdfPages(bytes, operation.indices, operation.angle);
        else utilityFail('invalid-request');
        signal.throwIfAborted(); if (bytes.length > 50 * 1024 * 1024) utilityFail('limit-exceeded');
      }
      if (outputBytes + bytes.length > 100 * 1024 * 1024) utilityFail('limit-exceeded'); outputBytes += bytes.length;
      yield { index, name, status: 'success', bytes };
    } catch { yield { index, name, status: signal.aborted ? 'cancelled' : 'failed', code: signal.aborted ? 'cancelled' : 'operation-failed' }; if (signal.aborted) return; }
  }
}
export async function createBatchZip(outcomes: readonly BatchOutcome[], signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted(); if (outcomes.length > 20) utilityFail('limit-exceeded');
  const zip = new JSZip(); let total = 0;
  for (const [index, outcome] of outcomes.entries()) if (outcome.status === 'success') {
    signal.throwIfAborted(); total += outcome.bytes.length; if (total > 100 * 1024 * 1024) utilityFail('limit-exceeded');
    zip.file(safeBatchFilename(outcome.name, index), outcome.bytes, { date: new Date('2000-01-01T00:00:00Z') });
  }
  const result = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }, () => signal.throwIfAborted()); signal.throwIfAborted(); return result;
}
