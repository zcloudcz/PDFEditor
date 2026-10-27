import { describe, expect, it } from 'vitest';
import { CheckpointStore, type AtomicCheckpointBackend } from './checkpoint-store';
import type { DocumentCheckpoint } from './coordinator';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { base64Bytes, bytesBase64 } from '../studio/project-io';
import { validateProjectSource } from '../studio/document-bridge';
const checkpoint = (revision: number): DocumentCheckpoint => ({ revision, nativeRevision: revision, project: { version: 1, name: `Revision ${revision}`, pages: [{ id: 'page', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [] }] } });
class MemoryBackend implements AtomicCheckpointBackend {
  value: unknown;
  fail = false;
  gate?: Promise<void>;
  async read() { return structuredClone(this.value); }
  async update(transform: (previous: unknown) => unknown, signal?: AbortSignal) {
    await this.gate;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const next = transform(structuredClone(this.value));
    if (this.fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.value = structuredClone(next);
  }
}
describe('two-checkpoint recovery store', () => {
  it('purges only matching document records and verifies the raw empty envelope', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); await store.write(checkpoint(2));
    const purge = await store.preparePurge(['page']);
    await purge();
    expect(backend.value).toEqual({ version: 1 });
  });
  it('refuses unrelated and corrupt checkpoints before deletion', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1));
    const saved = structuredClone(backend.value);
    await expect(store.preparePurge(['other'])).rejects.toThrow();
    expect(backend.value).toEqual(saved);
    backend.value = { version: 1, latest: { payload: 'broken', checksum: 'broken' } };
    await expect(store.preparePurge(['page'])).rejects.toThrow();
    expect(backend.value).toHaveProperty('latest');
  });
  it('refuses an unrelated previous slot even when latest matches', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    const other = checkpoint(1); other.project.pages[0].id = 'other';
    await store.write(other); await store.write(checkpoint(2));
    await expect(store.preparePurge(['page'])).rejects.toThrow();
  });
  it('refuses changed storage between purge preparation and commit', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); const purge = await store.preparePurge(['page']);
    await store.write(checkpoint(2)); const saved = structuredClone(backend.value);
    await expect(purge()).rejects.toThrow(); expect(backend.value).toEqual(saved);
  });
  it('restores native PDF bytes and independent graphic objects together', async () => {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([600, 800]).drawText('Native text checkpoint', { x: 20, y: 700, font }); pdf.setTitle('Native revision');
    const value = checkpoint(1); value.project.sourcePdf = bytesBase64(await pdf.save());
    value.project.pages[0].sourcePageIndex = 0;
    value.project.pages[0].objects.push({ id: 'graphic', kind: 'rect', name: 'Graphic', x: 40, y: 50, width: 60, height: 70, rotation: 0, opacity: 1, fill: '#ff0000', stroke: 'none', strokeWidth: 0, locked: false });
    const backend = new MemoryBackend(); await new CheckpointStore(backend).write(value);
    const restored = await new CheckpointStore(backend).read();
    expect(restored?.checkpoint.project).toEqual(value.project);
    if (!restored?.checkpoint.project.sourcePdf) throw new Error('Missing restored PDF');
    await validateProjectSource(restored.checkpoint.project);
    expect((await PDFDocument.load(base64Bytes(restored.checkpoint.project.sourcePdf))).getTitle()).toBe('Native revision');
  });
  it('retains exactly the latest and previous checkpoints', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); await store.write(checkpoint(2)); await store.write(checkpoint(3));
    expect(await store.read()).toEqual({ checkpoint: checkpoint(3), recoveredPrevious: false });
    const record = backend.value as { latest: { payload: string }; previous: { payload: string } };
    expect(JSON.parse(record.previous.payload).revision).toBe(2);
    expect(Object.keys(record).sort()).toEqual(['latest', 'previous', 'version']);
  });
  it('persists active page and graphic selection with the native and project revisions', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    const selected = { ...checkpoint(4), view: { pageId: 'page', pageIndex: 0, selectedIds: ['shape'] } };
    await store.write(selected);
    expect((await store.read())?.checkpoint).toEqual(selected);
    await expect(store.write({ ...selected, view: { pageIndex: 2, selectedIds: ['shape'] } })).rejects.toThrow('Invalid checkpoint view');
    expect((await store.read())?.checkpoint).toEqual(selected);
  });
  it('recovers the previous checkpoint when the latest payload is corrupted', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); await store.write(checkpoint(2));
    const record = backend.value as { latest: { payload: string } }; record.latest.payload += 'broken';
    expect(await store.read()).toEqual({ checkpoint: checkpoint(1), recoveredPrevious: true });
    await store.write(checkpoint(3));
    const next = backend.value as { latest: { payload: string } }; next.latest.payload = '{}';
    expect((await store.read())?.checkpoint.revision).toBe(1);
  });
  it('quota failure keeps both previously committed snapshots untouched', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); await store.write(checkpoint(2));
    const before = structuredClone(backend.value); backend.fail = true;
    await expect(store.write(checkpoint(3))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(backend.value).toEqual(before); expect((await store.read())?.checkpoint.revision).toBe(2);
  });
  it('cancels pending writes before clearing and prevents their resurrection', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); let release = () => {};
    backend.gate = new Promise<void>(resolve => { release = resolve; });
    const pending = store.write(checkpoint(2));
    const pendingAssertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const cleared = store.clear(); release(); await cleared; await pendingAssertion;
    expect(await store.read()).toBeUndefined();
  });
  it('rejects invalid checkpoints and does not alias caller data', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend), value = checkpoint(1);
    const pending = store.write(value); value.project.name = 'Mutated'; await pending;
    expect((await store.read())?.checkpoint.project.name).toBe('Revision 1');
    await expect(store.write({ ...checkpoint(2), revision: -1 })).rejects.toThrow();
    await expect(store.write({ ...checkpoint(2), project: { ...value.project, pages: [] } })).rejects.toThrow();
    expect((await store.read())?.checkpoint.revision).toBe(1);
  });
  it('revoking consent cancels all queued writes and allows a later explicit write', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); let release = () => {};
    backend.gate = new Promise<void>(resolve => { release = resolve; });
    const first = expect(store.write(checkpoint(2))).rejects.toMatchObject({ name: 'AbortError' });
    const second = expect(store.write(checkpoint(3))).rejects.toMatchObject({ name: 'AbortError' });
    store.cancelPending(); release(); await Promise.all([first, second]);
    expect((await store.read())?.checkpoint.revision).toBe(1);
    await store.write(checkpoint(4));
    expect((await store.read())?.checkpoint.revision).toBe(4);
  });
  it('does not begin a write when consent is revoked during asynchronous source validation', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    const pending = store.write(checkpoint(1));
    store.cancelPending();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.value).toBeUndefined();
  });
  it('continues saving after a quota error without replacing the fallback', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); backend.fail = true;
    await expect(store.write(checkpoint(2))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    backend.fail = false; await store.write(checkpoint(3));
    (backend.value as { latest: { payload: string } }).latest.payload += 'broken';
    expect((await store.read())?.checkpoint.revision).toBe(1);
  });
  it('rejects a malformed PDF before writing and falls back when a checksummed latest PDF is invalid', async () => {
    const backend = new MemoryBackend(), store = new CheckpointStore(backend);
    await store.write(checkpoint(1)); await store.write(checkpoint(2));
    const broken = checkpoint(3); broken.project.sourcePdf = 'JVBERi0x'; broken.project.pages[0].sourcePageIndex = 0;
    const before = structuredClone(backend.value);
    await expect(store.write(broken)).rejects.toThrow();
    expect(backend.value).toEqual(before);
    const payload = JSON.stringify(broken);
    let hash = 0x811c9dc5;
    for (let i = 0; i < payload.length; i++) hash = Math.imul(hash ^ payload.charCodeAt(i), 0x01000193);
    (backend.value as { latest: { payload: string; checksum: string } }).latest = { payload, checksum: `${payload.length}:${(hash >>> 0).toString(16)}` };
    expect((await store.read())?.checkpoint.revision).toBe(1);
  });
});

it('persists v2 projects at the atomic backend boundary while retaining runtime v1', async () => {
  const backend = new MemoryBackend(), store = new CheckpointStore(backend);
  await store.write(checkpoint(1));
  const record = backend.value as { latest: { payload: string } };
  expect(JSON.parse(record.latest.payload).project.version).toBe(2);
  expect((await store.read())?.checkpoint).toEqual(checkpoint(1));
});
it('reads legacy v1 checkpoint payloads and falls back from invalid v2 assets', async () => {
  const backend = new MemoryBackend();
  const snapshot = (value: unknown) => {
    const payload = JSON.stringify(value); let hash = 0x811c9dc5;
    for (let i = 0; i < payload.length; i++) hash = Math.imul(hash ^ payload.charCodeAt(i), 0x01000193);
    return { payload, checksum: `${payload.length}:${(hash >>> 0).toString(16)}` };
  };
  backend.value = { version: 1, latest: snapshot(checkpoint(1)) };
  const store = new CheckpointStore(backend);
  expect((await store.read())?.checkpoint).toEqual(checkpoint(1));
  const invalid = { ...checkpoint(2), project: { version: 2, name: 'invalid', assets: {}, sections: [{ id: 'section', kind: 'future', pages: [] as unknown[] }] } };
  backend.value = { version: 1, latest: snapshot(invalid), previous: snapshot(checkpoint(1)) };
  expect(await store.read()).toEqual({ checkpoint: checkpoint(1), recoveredPrevious: true });
  await store.write(checkpoint(3));
  (backend.value as { latest: { payload: string } }).latest.payload += 'broken';
  expect((await store.read())?.checkpoint).toEqual(checkpoint(1));
});

