// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { PDFDocument, PDFName } from 'pdf-lib';
import { prepareNativeDocument } from './document-bridge';
import { base64Bytes } from './project-validation';
import { clearDesignProvenance, designSourceHash, verifyDesignProvenance } from './design-provenance';
import type { StudioProject } from './types';

afterEach(() => vi.restoreAllMocks());
it('hashes source text in chunks with the exact existing SHA-256 digest', () => {
  const hash = forge.md.sha256.create();
  const update = vi.spyOn(hash, 'update');
  vi.spyOn(forge.md.sha256, 'create').mockReturnValue(hash);
  const source = 'YWJjZA=='.repeat(20000);
  expect(designSourceHash(source)).toBe(createHash('sha256').update(source, 'latin1').digest('hex'));
  expect(update).toHaveBeenCalledTimes(3);
  expect(update.mock.calls.every(([chunk]) => chunk.length <= 65536)).toBe(true);
});

it('rejects an over-limit encoded source before allocating a hash or decoding bytes', async () => {
  const create = vi.spyOn(forge.md.sha256, 'create');
  // Only string length is checked; no oversized PDF/decoded buffer is constructed.
  const source = 'A'.repeat(4 * Math.ceil(50 * 1024 * 1024 / 3) + 1);
  const project: StudioProject = { version: 1, name: '', sourcePdf: source, pages: [{ id: 'p', name: '', width: 200, height: 200, background: '#ffffff', sourcePageIndex: 0, syntheticBackground: '0'.repeat(64), objects: [] }] };
  expect(() => designSourceHash(source)).toThrow('limit-exceeded');
  await expect(verifyDesignProvenance(project)).rejects.toThrow('limit-exceeded');
  expect(create).not.toHaveBeenCalled();
});

it('bounds ordinary uncompressed synthetic content before accepting provenance', async () => {
  const prepared = await prepareNativeDocument({ version: 1, name: '', pages: [{ id: 'p', name: '', width: 200, height: 200, background: '#ffffff', objects: [] }] });
  const pdf = await PDFDocument.load(base64Bytes(prepared.project.sourcePdf!));
  pdf.getPage(0).node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(' '.repeat(16385))));
  const project = prepared.project; project.sourcePdf = await pdf.saveAsBase64();
  project.pages[0].syntheticBackground = designSourceHash(project.sourcePdf);
  clearDesignProvenance();
  await expect(verifyDesignProvenance(project)).rejects.toThrow('limit-exceeded');
});
