import { loadStandardDocument } from './forms';
import { utilityFail } from './page-furniture';
import { verifyPdfRender } from './optimize';

export interface RepairResult { bytes: Uint8Array; profile: 'missing-final-eof'; beforeBytes: number; afterBytes: number }

/** Restore only a missing final marker after a complete classic xref table. No blind parse-and-resave. */
export async function repairPdf(input: Uint8Array, signal: AbortSignal): Promise<RepairResult> {
  signal.throwIfAborted();
  if (!(input instanceof Uint8Array) || input.length < 64 || input.length > 50 * 1024 * 1024) utilityFail('unsupported-structure');
  const bytes = input.slice(), head = new TextDecoder('latin1').decode(bytes.slice(0, 8)), tail = new TextDecoder('latin1').decode(bytes.slice(-4096));
  if (!head.startsWith('%PDF-')) utilityFail('unsupported-structure');
  if (/%%EOF\s*$/.test(tail)) utilityFail('invalid-request');
  const match = /startxref\s+(\d+)\s*$/.exec(tail);
  if (!match) utilityFail('unsupported-structure');
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length || new TextDecoder('latin1').decode(bytes.slice(offset, offset + 4)) !== 'xref') utilityFail('unsupported-structure');
  validateClassicXref(bytes, offset);
  const suffix = new TextEncoder().encode('%%EOF\n'), result = new Uint8Array(bytes.length + suffix.length); result.set(bytes); result.set(suffix, bytes.length);
  signal.throwIfAborted();
  try { await loadStandardDocument(result); await verifyPdfRender(result, signal); }
  catch { signal.throwIfAborted(); utilityFail('verification-failed'); }
  signal.throwIfAborted();
  return { bytes: result, profile: 'missing-final-eof', beforeBytes: bytes.length, afterBytes: result.length };
}

/** Check each declared in-use slot against its physical object header; reject fallback-indexing cases. */
function validateClassicXref(bytes: Uint8Array, offset: number): void {
  const table = new TextDecoder('latin1').decode(bytes.slice(offset));
  if (table.length > 4_000_000) utilityFail('limit-exceeded');
  let cursor = /^xref\s+/.exec(table)?.[0].length;
  if (cursor === undefined) utilityFail('unsupported-structure');
  const entries = new Map<number, { offset: number; generation: number; inUse: boolean }>();
  while (!table.slice(cursor).startsWith('trailer')) {
    const subsection = /^(\d+)\s+(\d+)\s+/.exec(table.slice(cursor));
    if (!subsection) utilityFail('unsupported-structure');
    const first = Number(subsection[1]), count = Number(subsection[2]); cursor += subsection[0].length;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 1 || first + count > 100_000) utilityFail('unsupported-structure');
    for (let index = 0; index < count; index++) {
      const entry = /^(\d{10})\s+(\d{5})\s+([nf])\s*/.exec(table.slice(cursor));
      if (!entry || entries.has(first + index)) utilityFail('unsupported-structure');
      cursor += entry[0].length;
      const position = Number(entry[1]), generation = Number(entry[2]), inUse = entry[3] === 'n';
      if (inUse) {
        if (position < 0 || position >= offset) utilityFail('unsupported-structure');
        const header = new TextDecoder('latin1').decode(bytes.slice(position, position + 40));
        const actual = /^(\d+)\s+(\d+)\s+obj\b/.exec(header);
        if (!actual || Number(actual[1]) !== first + index || Number(actual[2]) !== generation) utilityFail('unsupported-structure');
      }
      entries.set(first + index, { offset: position, generation, inUse });
    }
  }
  const trailer = /^trailer\s*<<([\s\S]*?)>>\s*startxref\s+\d+\s*$/.exec(table.slice(cursor));
  if (!trailer || /\/(?:Prev|XRefStm|Encrypt)\b/.test(trailer[1])) utilityFail('unsupported-structure');
  const size = /\/Size\s+(\d+)\b/.exec(trailer[1]), root = /\/Root\s+(\d+)\s+(\d+)\s+R\b/.exec(trailer[1]);
  if (!size || !root || !Number.isSafeInteger(Number(size[1])) || Number(size[1]) < 2 || Number(size[1]) > 100_000 || entries.size !== Number(size[1])) utilityFail('unsupported-structure');
  for (let index = 0; index < Number(size[1]); index++) if (!entries.has(index)) utilityFail('unsupported-structure');
  const rootEntry = entries.get(Number(root[1]));
  if (!rootEntry?.inUse || rootEntry.generation !== Number(root[2])) utilityFail('unsupported-structure');
}
