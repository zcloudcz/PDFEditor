import { describe, expect, it, vi } from 'vitest';
import { commitSanitized, SanitizedCommitError } from './sanitized-transaction';

function fixture() {
  const events: string[] = [];
  const step = (name: string) => vi.fn(async () => { events.push(name); });
  const adapter = {
    assertCurrent: vi.fn(() => {}),
    revokeRecovery: step('revoke'), purgeRecovery: step('purge'),
    discardCurrent: step('discard'), install: step('install'), verify: step('verify'),
    quarantine: step('quarantine'),
  };
  return { adapter, events };
}
describe('irreversible sanitized commit', () => {
  it('verifies every purge before reporting success', async () => {
    const { adapter, events } = fixture();
    await commitSanitized(adapter, new AbortController().signal);
    expect(events).toEqual(['revoke', 'purge', 'discard', 'install', 'verify']);
  });
  it('cancellation before the boundary performs no deletion', async () => {
    const { adapter, events } = fixture(); const abort = new AbortController(); abort.abort();
    await expect(commitSanitized(adapter, abort.signal)).rejects.toThrow();
    expect(events).toEqual([]);
  });
  it('stale candidates perform no deletion', async () => {
    const { adapter, events } = fixture(); adapter.assertCurrent.mockImplementation(() => { throw new Error('stale'); });
    await expect(commitSanitized(adapter, new AbortController().signal)).rejects.toThrow('stale');
    expect(events).toEqual([]);
  });
  it.each(['revokeRecovery', 'purgeRecovery', 'discardCurrent', 'install', 'verify'] as const)('quarantines %s failure without rollback or success', async method => {
    const { adapter } = fixture(); adapter[method].mockRejectedValue(new Error('synthetic failure'));
    await expect(commitSanitized(adapter, new AbortController().signal)).rejects.toBeInstanceOf(SanitizedCommitError);
    expect(adapter.quarantine).toHaveBeenCalledOnce();
    if (method !== 'verify') expect(adapter.verify).not.toHaveBeenCalled();
  });
  it('finishes after a late cancellation instead of restoring originals', async () => {
    const { adapter, events } = fixture(); const abort = new AbortController();
    adapter.revokeRecovery.mockImplementation(async () => { events.push('revoke'); abort.abort(); });
    await commitSanitized(adapter, abort.signal);
    expect(events.at(-1)).toBe('verify');
  });
});
