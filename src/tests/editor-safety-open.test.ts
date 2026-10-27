import { describe, it, expect, vi } from 'vitest';
import {
  prepareDocument,
  replaceDocumentSafely,
  confirmPlaintextExport,
} from '../editor-safety/open-document';

function probe(open = vi.fn()) {
  return {
    open,
    close: vi.fn(),
    documentInfo: vi.fn(() => ({ pages: 1, encrypted: false })),
  };
}

describe('document replacement safety', () => {
  it('validates separately and returns original bytes even if probe mutates its copy', async () => {
    const engine = probe(
      vi.fn((bytes) => {
        bytes[0] = 0;
      })
    );
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const result = await prepareDocument(bytes, {
      createEngine: async () => engine,
      requestPassword: vi.fn(),
    });
    expect(result?.bytes).toBe(bytes);
    expect(bytes[0]).toBe(37);
    expect(engine.close).toHaveBeenCalledOnce();
  });
  it('retries a password error without logging or retaining password in callbacks', async () => {
    const engine = probe(
      vi
        .fn()
        .mockImplementationOnce(() => {
          throw { passwordRequired: true };
        })
        .mockImplementationOnce(() => {
          throw { passwordRequired: true };
        })
    );
    engine.documentInfo.mockReturnValue({ pages: 1, encrypted: true });
    const requestPassword = vi
      .fn()
      .mockResolvedValueOnce('wrong')
      .mockResolvedValueOnce('secret');
    const result = await prepareDocument(new Uint8Array([1]), {
      createEngine: async () => engine,
      requestPassword,
    });
    expect(requestPassword.mock.calls).toEqual([
      [{ attempt: 1, incorrect: false }],
      [{ attempt: 2, incorrect: true }],
    ]);
    expect(result).toMatchObject({ password: 'secret', encrypted: true });
    expect(engine.close).toHaveBeenCalledOnce();
  });
  it('password cancellation closes probe and never commits', async () => {
    const engine = probe(
      vi.fn(() => {
        throw { passwordRequired: true };
      })
    );
    const commit = vi.fn();
    expect(
      await replaceDocumentSafely({
        prepare: () =>
          prepareDocument(new Uint8Array([1]), {
            createEngine: async () => engine,
            requestPassword: async () => null,
          }),
        isDirty: () => true,
        confirmDiscard: vi.fn(),
        commit,
      })
    ).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledOnce();
  });
  it('invalid candidate does not prompt discard or replace existing document', async () => {
    const engine = probe(
      vi.fn(() => {
        throw new Error('invalid');
      })
    );
    const commit = vi.fn();
    const confirmDiscard = vi.fn();
    await expect(
      replaceDocumentSafely({
        prepare: () =>
          prepareDocument(new Uint8Array([1]), {
            createEngine: async () => engine,
            requestPassword: vi.fn(),
          }),
        isDirty: () => true,
        confirmDiscard,
        commit,
      })
    ).rejects.toThrow('invalid');
    expect(commit).not.toHaveBeenCalled();
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledOnce();
  });
  it('checks dirty state after validation and cancellation retains current state', async () => {
    let dirty = false;
    const commit = vi.fn();
    const confirmDiscard = vi.fn().mockResolvedValue(false);
    expect(
      await replaceDocumentSafely({
        prepare: async () => {
          dirty = true;
          return 7;
        },
        isDirty: () => dirty,
        confirmDiscard,
        commit,
      })
    ).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
  it('commits validated candidate only with affirmative discard consent', async () => {
    const commit = vi.fn().mockResolvedValue(true);
    expect(
      await replaceDocumentSafely({
        prepare: async () => 7,
        isDirty: () => true,
        confirmDiscard: async () => true,
        commit,
      })
    ).toBe(true);
    expect(commit).toHaveBeenCalledWith(7);
  });
  it('requires explicit consent before plaintext export of encrypted input', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    expect(await confirmPlaintextExport(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(await confirmPlaintextExport(true, async () => true)).toBe(true);
    confirm.mockClear();
    expect(await confirmPlaintextExport(false, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
