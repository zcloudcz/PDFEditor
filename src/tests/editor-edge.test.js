// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inspect, unchangedPixelsEqual } from './helpers/editor-pdf-inspect';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createEngine, modelOf, paragraphText, runsFrom } from './helpers/editcore-harness';
import { edgePdf, encryptedPdf, encryptionModes, signedPdf } from './helpers/editor-edge-fixtures';
import { validatePdfSignatures } from '../js/logic/validate-signature-pdf';

async function textOf(bytes, password) {
  const doc = await getDocument({ data: bytes.slice(), password, standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/` }).promise;
  try { return (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str || '').join(' '); }
  finally { await doc.destroy(); }
}
function edit(engine) {
  const target = engine.buildModel().find(p => paragraphText(p).includes('Original text'));
  expect(target?.editable).toBe(true);
  expect(engine.commitParagraph(target.id, runsFrom(target, 'Updated text'), target.format)).toBeTruthy();
}

const evidence = resolve('.superpowers/sdd/2026-10-25-online-pdf-editor/edge-corpus');

describe('P01 native engine edge cases', () => {
  let engine, plain;
  beforeAll(async () => { mkdirSync(evidence, { recursive: true }); engine = await createEngine(); plain = await edgePdf(); });
  afterAll(() => engine?.close());
  it.each([['empty', new Uint8Array()], ['not PDF', new TextEncoder().encode('not a PDF')], ['header only', new TextEncoder().encode('%PDF-1.7\n')]])('rejects %s and can reopen a healthy PDF', (_, bytes) => {
    expect(() => engine.open(bytes)).toThrow('could not be opened');
    expect(modelOf(engine, plain).map(paragraphText).join(' ')).toContain('Original text');
  });
  it('rejects a document truncated inside its catalog', () => {
    expect(() => engine.open(plain.slice(0, 50))).toThrow('could not be opened');
    expect(modelOf(engine, plain)).not.toHaveLength(0);
  });
  it('rejects a document truncated before its cross-reference and trailer', () => {
    const xref = new TextDecoder().decode(plain).lastIndexOf('\nxref\n');
    expect(xref).toBeGreaterThan(0);
    const damaged = plain.slice(0, xref);
    expect(() => engine.open(damaged)).toThrow('could not be opened');
    expect(modelOf(engine, plain).map(paragraphText).join(' ')).toContain('Original text');
  });
  for (const [label, mode] of encryptionModes) {
    it(`${label}: password errors, correct password and native export`, async () => {
      const encrypted = await encryptedPdf(plain, mode);
      for (const password of [undefined, 'wrong-secret']) {
        try { engine.open(encrypted, password); throw new Error('Unexpected open'); }
        catch (error) { expect(error.passwordRequired).toBe(true); }
      }
      engine.open(encrypted, 'reader-secret');
      expect(engine.security.encrypted).toBeTruthy();
      expect(await textOf(encrypted, 'reader-secret')).toContain('Original text');
      edit(engine);
      const saved = await engine.saveSpliced();
      // Native export deliberately removes encryption; no password is needed to read it.
      engine.open(saved);
      expect(engine.security.encrypted).toBeFalsy();
      expect(await textOf(saved)).toContain('Updated text');
    });
  }
  it.each([false, true])('real signature: incremental=%s export impact', async (incremental) => {
    const signed = await signedPdf(plain);
    const initial = await validatePdfSignatures(signed);
    expect(initial).toHaveLength(1);
    expect(initial[0].cryptoVerified).toBe(true);
    expect(initial[0].coverageStatus).toBe('full');
    expect(initial[0].isTrusted).toBe(false);
    modelOf(engine, signed);
    expect(engine.security.signatures).toBe(1);
    edit(engine);
    const saved = await engine.saveSpliced({ incremental });
    expect(await textOf(saved)).toContain('Updated text');
    const signatures = await validatePdfSignatures(saved);
    writeFileSync(resolve(evidence, `signature-${incremental}.json`), JSON.stringify(signatures, null, 2));
    expect(signatures.length).toBeGreaterThan(0);
    if (incremental) {
      expect(signatures.filter(s => s.cryptoVerified)).toHaveLength(1);
      expect(signatures.find(s => s.cryptoVerified).coverageStatus).toBe('partial');
      expect(signatures.every(s => s.coverageStatus !== 'full')).toBe(true);
      expect(saved.slice(0, signed.length)).toEqual(signed);
    } else {
      expect(signatures.every(s => !s.cryptoVerified)).toBe(true);
    }
  });
  it('opens a synthetic Type3 document and preserves its glyphs through unrelated text editing', async () => {
    const bytes = await edgePdf({ type3: true });
    const before = await inspect(bytes, true, 1, [20, 220, 180, 270]);
    expect(before.text).toContain('AAA');
    modelOf(engine, bytes);
    edit(engine);
    const saved = await engine.saveSpliced();
    expect(await textOf(saved)).toContain('Updated text');
    expect(await textOf(saved)).toContain('AAA');
    const after = await inspect(saved, true);
    expect(unchangedPixelsEqual(before.pixels, after.pixels)).toBe(true);
  });
});
