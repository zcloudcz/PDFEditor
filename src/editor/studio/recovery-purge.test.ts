import { describe, expect, it, vi } from 'vitest';
import { prepareScopedRecoveryPurge } from './recovery';
const legacy = (id = 'page') => JSON.stringify({ version: 1, name: 'Synthetic', pages: [{ id, name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [] }] });
function backend(value: unknown = legacy()) {
  const current = vi.fn(async () => {});
  return { current, readLegacy: vi.fn(async () => value), prepareCurrent: vi.fn(async () => current), deleteLegacyIfUnchanged: vi.fn(async () => { value = undefined; }) };
}
describe('document scoped recovery purge with synthetic backends', () => {
  it('preflights both stores and verifies deletion', async () => {
    const store = backend(); const purge = await prepareScopedRecoveryPurge(['page'], store);
    expect(store.current).not.toHaveBeenCalled(); expect(store.deleteLegacyIfUnchanged).not.toHaveBeenCalled();
    await purge(); expect(store.current).toHaveBeenCalledOnce(); expect(await store.readLegacy()).toBeUndefined();
  });
  it.each([legacy('other'), 'broken', 4])('does not delete unrelated or unknown legacy data', async value => {
    const store = backend(value); await expect(prepareScopedRecoveryPurge(['page'], store)).rejects.toThrow();
    expect(store.current).not.toHaveBeenCalled(); expect(store.deleteLegacyIfUnchanged).not.toHaveBeenCalled();
  });
  it('does not delete legacy when checkpoint preflight fails', async () => {
    const store = backend(); store.prepareCurrent.mockRejectedValue(new Error('unrelated'));
    await expect(prepareScopedRecoveryPurge(['page'], store)).rejects.toThrow();
    expect(store.deleteLegacyIfUnchanged).not.toHaveBeenCalled();
  });
  it('rejects a concurrent legacy replacement before deletion', async () => {
    const store = backend(); const purge = await prepareScopedRecoveryPurge(['page'], store);
    store.readLegacy.mockResolvedValue(legacy('other'));
    await expect(purge()).rejects.toThrow(); expect(store.current).not.toHaveBeenCalled();
  });
  it('fails verification when legacy delete lies', async () => {
    const store = backend(); store.deleteLegacyIfUnchanged.mockImplementation(async () => {});
    await expect((await prepareScopedRecoveryPurge(['page'], store))()).rejects.toThrow();
  });
});
