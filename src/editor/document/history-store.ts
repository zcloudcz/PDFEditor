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

// Media are deduplicated by their payload string: Map compares strings natively, so no content
// hash is computed. A JS SHA-256 over the whole source PDF cost ~1 s on every document change.
let mediaKeys = 0;

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
    const hash = lookup.get(payload) ?? `media-${++mediaKeys}`;
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
