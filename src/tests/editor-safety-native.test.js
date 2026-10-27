// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  createEngine,
  modelOf,
  paragraphText,
} from './helpers/editcore-harness';
import {
  edgePdf,
  encryptedPdf,
  encryptionModes,
} from './helpers/editor-edge-fixtures';
import {
  prepareDocument,
  replaceDocumentSafely,
  confirmPlaintextExport,
} from '../editor-safety/open-document';

describe('native document preflight', () => {
  it('invalid replacement leaves a separate live document usable', async () => {
    const live = await createEngine();
    try {
      modelOf(live, await edgePdf());
      const commit = vi.fn();
      await expect(
        replaceDocumentSafely({
          prepare: () =>
            prepareDocument(new TextEncoder().encode('%PDF-1.7\n'), {
              createEngine,
              requestPassword: async () => null,
            }),
          isDirty: () => false,
          confirmDiscard: () => true,
          commit,
        })
      ).rejects.toThrow();
      expect(commit).not.toHaveBeenCalled();
      expect(live.buildModel().map(paragraphText).join(' ')).toContain(
        'Original text'
      );
    } finally {
      live.close();
    }
  });
  it.each(encryptionModes)(
    'preflights %s using original bytes, including retry and cancellation',
    async (_label, mode) => {
      const bytes = await encryptedPdf(await edgePdf(), mode);
      const original = bytes.slice();
      const requestPassword = vi
        .fn()
        .mockResolvedValueOnce('wrong')
        .mockResolvedValueOnce('reader-secret');
      const prepared = await prepareDocument(bytes, {
        createEngine,
        requestPassword,
      });
      expect(prepared.encrypted).toBe(true);
      expect(prepared.bytes).toEqual(original);
      expect(requestPassword).toHaveBeenCalledTimes(2);
      const live = await createEngine();
      try {
        live.open(prepared.bytes, prepared.password);
        expect(live.documentInfo().pages).toBe(1);
        expect(
          await confirmPlaintextExport(prepared.encrypted, async () => false)
        ).toBe(false);
      } finally {
        prepared.password = undefined;
        live.close();
      }
      expect(
        await prepareDocument(bytes, {
          createEngine,
          requestPassword: async () => null,
        })
      ).toBeNull();
    }
  );
});
