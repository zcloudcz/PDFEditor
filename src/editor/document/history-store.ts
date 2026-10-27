import type { StudioProject } from '../studio/types';
import type { DocumentCheckpoint } from './coordinator';

type Reference = { hash: string; mime: string };
type StoredProject = Omit<StudioProject, 'sourcePdf' | 'pages'> & {
  sourcePdf?: Reference;
  pages: Array<Omit<StudioProject['pages'][number], 'objects'> & {
    objects: Array<Omit<StudioProject['pages'][number]['objects'][number], 'src'> & { src?: Reference }>;
  }>;
};
type StoredCheckpoint = Omit<DocumentCheckpoint, 'project'> & { project: StoredProject };

// SHA-256 over the canonical base64 payload. This synchronous implementation keeps
// recordExternal synchronous for the editor's existing history button contract.
function sha256(value: string): string {
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311];
  const fractional = (n: number) => (n % 1 * 0x100000000) | 0;
  const h = primes.slice(0, 8).map(p => fractional(Math.sqrt(p)));
  const k = primes.map(p => fractional(Math.cbrt(p)));
  const bytes = new TextEncoder().encode(value);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(length - 4, bits >>> 0);
  const w = new Int32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, j] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      j = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, j].forEach((part, i) => { h[i] = (h[i] + part) | 0; });
  }
  return h.map(part => (part >>> 0).toString(16).padStart(8, '0')).join('');
}

/** In-memory history stores media once and keeps only references in each state. */
export class HistoryStore {
  private constructor(
    private readonly states: StoredCheckpoint[],
    private readonly media: Map<string, string>,
    readonly cursor: number,
    private readonly limit: number,
  ) {}
  static create(limit: number): HistoryStore { return new HistoryStore([], new Map(), -1, limit); }
  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor >= 0 && this.cursor < this.states.length - 1; }
  get stateCount(): number { return this.states.length; }
  get mediaCount(): number { return this.media.size; }
  get mediaCharacters(): number { return [...this.media.values()].reduce((n, v) => n + v.length, 0); }
  private ref(payload: string, mime: string, media: Map<string, string>, lookup: Map<string, string>): Reference {
    const hash = lookup.get(payload) ?? sha256(payload);
    const previous = media.get(hash);
    if (previous !== undefined && previous !== payload) throw new Error('History media hash collision');
    media.set(hash, payload);
    lookup.set(payload, hash);
    return { hash, mime };
  }
  private store(checkpoint: DocumentCheckpoint, media: Map<string, string>): StoredCheckpoint {
    const lookup = new Map([...media].map(([hash, payload]) => [payload, hash]));
    const { sourcePdf, pages, ...rest } = checkpoint.project;
    const project: StoredProject = { ...structuredClone(rest), pages: pages.map(page => {
      const { objects, ...pageProperties } = page;
      return { ...structuredClone(pageProperties), objects: objects.map(object => {
      const { src, ...properties } = object;
      if (!src) return structuredClone(properties);
      const comma = src.indexOf(',');
      return { ...structuredClone(properties), src: this.ref(src.slice(comma + 1), src.slice(5, comma - 7), media, lookup) };
    }) }; }) };
    if (sourcePdf) project.sourcePdf = this.ref(sourcePdf, 'application/pdf', media, lookup);
    return { ...checkpoint, project, ...(checkpoint.view ? { view: structuredClone(checkpoint.view) } : {}) };
  }
  private restore(ref: Reference): string {
    const payload = this.media.get(ref.hash);
    // Payloads are immutable strings in a private, insertion-verified map. Do not
    // rehash a large image for every instance on each synchronous UI history read.
    if (payload === undefined) throw new Error('Missing history asset');
    return payload;
  }
  at(index: number): DocumentCheckpoint | undefined {
    const checkpoint = this.states[index];
    if (!checkpoint) return undefined;
    const { sourcePdf, pages, ...rest } = checkpoint.project;
    const project: StudioProject = { ...structuredClone(rest), pages: pages.map(page => ({ ...structuredClone(page), objects: page.objects.map(object => {
      const { src, ...properties } = object;
      return { ...structuredClone(properties), ...(src ? { src: `data:${src.mime};base64,${this.restore(src)}` } : {}) };
    }) })) };
    if (sourcePdf) project.sourcePdf = this.restore(sourcePdf);
    return { ...checkpoint, project, ...(checkpoint.view ? { view: structuredClone(checkpoint.view) } : {}) };
  }
  private prune(states: StoredCheckpoint[], media: Map<string, string>): void {
    const live = new Set<string>();
    for (const state of states) {
      if (state.project.sourcePdf) live.add(state.project.sourcePdf.hash);
      for (const page of state.project.pages) for (const object of page.objects) if (object.src) live.add(object.src.hash);
    }
    for (const hash of media.keys()) if (!live.has(hash)) media.delete(hash);
  }
  recorded(checkpoint: DocumentCheckpoint): HistoryStore {
    const current = this.states[this.cursor];
    const media = new Map(this.media);
    const stored = this.store(checkpoint, media);
    const same = !!current && JSON.stringify(current.project) === JSON.stringify(stored.project);
    const states = same ? [...this.states] : this.states.slice(0, this.cursor + 1);
    let cursor = this.cursor;
    if (same) states[cursor] = stored;
    else { states.push(stored); if (states.length > this.limit) states.shift(); cursor = states.length - 1; }
    this.prune(states, media);
    return new HistoryStore(states, media, cursor, this.limit);
  }
  moved(index: number, checkpoint: DocumentCheckpoint): HistoryStore {
    const media = new Map(this.media);
    const states = [...this.states];
    states[index] = this.store(checkpoint, media);
    this.prune(states, media);
    return new HistoryStore(states, media, index, this.limit);
  }
}
