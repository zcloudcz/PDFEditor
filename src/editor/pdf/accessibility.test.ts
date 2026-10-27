// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFForm, PDFName, PDFHexString, PDFDict, PDFArray } from 'pdf-lib';
import { applyTagEdits, readTagTree } from './tag-tree';
import { auditAccessibility } from './accessibility';

const k = PDFName.of;
it('rejects repeated form claims before pdf-lib traverses an exponentially shared DAG', async () => {
  const { doc } = await fixture();
  let child = doc.context.register(doc.context.obj({ FT: 'Tx', T: PDFHexString.fromText('leaf') }));
  for (let depth = 0; depth < 15; depth++) child = doc.context.register(doc.context.obj({ T: PDFHexString.fromText(`level${depth}`), Kids: [child, child] }));
  doc.catalog.set(k('AcroForm'), doc.context.obj({ Fields: [child] }));
  const bytes = await doc.save({ useObjectStreams: false });
  const traverse = vi.spyOn(PDFForm.prototype, 'getFields');
  try {
    expect((await auditAccessibility(bytes)).filter(f => f.code === 'unsupported-form-tree')).toHaveLength(1);
    await expect(applyTagEdits(bytes, [{ kind: 'form-label', fieldId: child.toString(), text: 'Label' }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    expect(traverse).not.toHaveBeenCalled();
  } finally { traverse.mockRestore(); }
});

it('edits a shared TH attribute dictionary only for the selected owner', async () => {
  const { doc, heading, figure, h, f } = await fixture();
  const attrs = doc.context.register(doc.context.obj({ O: 'Table', Scope: 'Row', Retain: PDFHexString.fromText('kept') }));
  for (const node of [heading, figure]) { node.set(k('S'), k('TH')); node.set(k('A'), attrs); }
  const output = await applyTagEdits(await doc.save(), [{ kind: 'scope', id: h.toString(), scope: 'Column' }]);
  const parsed = await PDFDocument.load(output);
  expect(parsed.context.lookup(h, PDFDict).lookup(k('A'), PDFDict).get(k('Scope'))).toBe(k('Column'));
  expect(parsed.context.lookup(f, PDFDict).lookup(k('A'), PDFDict).get(k('Scope'))).toBe(k('Row'));
  expect(parsed.context.lookup(h, PDFDict).lookup(k('A'), PDFDict).lookup(k('Retain'), PDFHexString).decodeText()).toBe('kept');
  const independent = await getDocument({ data: output.slice() }).promise;
  try { expect((await (await independent.getPage(1)).getStructTree())?.children.map(node => 'role' in node ? node.role : '')).toEqual(['TH', 'TH']); }
  finally { await independent.destroy(); }
});

it.each(['cycle', 'depth', 'count'])('bounds malformed form %s before getFields', async kind => {
  const { doc } = await fixture();
  let child = doc.context.register(doc.context.obj({ FT: 'Tx', T: PDFHexString.fromText('leaf') }));
  if (kind === 'cycle') doc.context.lookup(child, PDFDict).set(k('Kids'), doc.context.obj([child]));
  if (kind === 'depth') for (let depth = 0; depth < 66; depth++) child = doc.context.register(doc.context.obj({ T: PDFHexString.fromText(`level${depth}`), Kids: [child] }));
  const fields = kind === 'count' ? Array.from({ length: 20001 }, () => child) : [child];
  doc.catalog.set(k('AcroForm'), doc.context.obj({ Fields: fields }));
  const bytes = await doc.save({ useObjectStreams: false }); const traverse = vi.spyOn(PDFForm.prototype, 'getFields');
  try {
    expect((await auditAccessibility(bytes)).some(f => f.code === 'unsupported-form-tree')).toBe(true);
    await expect(applyTagEdits(bytes, [{ kind: 'form-label', fieldId: child.toString(), text: 'Label' }])).rejects.toMatchObject({ code: kind === 'cycle' ? 'unsupported-structure' : 'limit-exceeded' });
    expect(traverse).not.toHaveBeenCalled();
  } finally { traverse.mockRestore(); }
});
async function fixture() {
  const doc = await PDFDocument.create(); const page = doc.addPage(); doc.addPage();
  doc.setTitle('Keep title'); doc.catalog.set(k('Lang'), PDFHexString.fromText('en'));
  const root = doc.context.obj({ Type: 'StructTreeRoot' }); const rootRef = doc.context.register(root);
  const heading = doc.context.obj({ Type: 'StructElem', S: 'H1', P: rootRef, Pg: page.ref, K: 0 }); const h = doc.context.register(heading);
  const figure = doc.context.obj({ Type: 'StructElem', S: 'Figure', P: rootRef, Pg: page.ref, K: 1 }); const f = doc.context.register(figure);
  root.set(k('K'), doc.context.obj([h, f])); root.set(k('ParentTree'), doc.context.obj({ Nums: [0, [h, f]] }));
  page.node.set(k('StructParents'), doc.context.obj(0));
  page.node.set(k('Contents'), doc.context.register(doc.context.flateStream('/H1 <</MCID 0>> BDC EMC /Figure <</MCID 1>> BDC EMC')));
  doc.catalog.set(k('StructTreeRoot'), rootRef); doc.catalog.set(k('MarkInfo'), doc.context.obj({ Marked: true }));
  return { doc, page, root, heading, figure, h, f, bytes: await doc.save() };
}

describe('bounded accessibility remediation', () => {
  it('audits real tags and always requires human checks without certifying PDF/UA', async () => {
    const { bytes } = await fixture(); const findings = await auditAccessibility(bytes);
    expect(findings.some(f => f.code === 'missing-alt')).toBe(true);
    expect(findings.some(f => f.code === 'manual-review-required')).toBe(true);
    expect((await readTagTree(bytes)).nodes.map(n => n.role)).toEqual(['H1', 'Figure']);
  });
  it('changes roles, language, alternative text and reading order while retaining MCID and ParentTree', async () => {
    const { bytes, h, f } = await fixture(); const before = bytes.slice();
    const result = await applyTagEdits(bytes, [
      { kind: 'role', id: h.toString(), role: 'H2' }, { kind: 'alt', id: f.toString(), text: 'Český popis' },
      { kind: 'language', language: 'cs-CZ' }, { kind: 'order', parentId: 'root', children: [f.toString(), h.toString()] },
    ]);
    const tree = await readTagTree(result); expect(tree.nodes.map(n => n.role)).toEqual(['Figure', 'H2']);
    expect(tree.nodes[0].alt).toBe('Český popis'); expect(tree.language).toBe('cs-CZ'); expect(bytes).toEqual(before);
    const doc = await PDFDocument.load(result); expect(doc.getTitle()).toBe('Keep title');
    const root = doc.catalog.lookup(k('StructTreeRoot'), PDFDict); const nums = root.lookup(k('ParentTree'), PDFDict).lookup(k('Nums'), PDFArray);
    expect(nums.lookup(1, PDFArray).get(0).toString()).toBe(h.toString());
    expect(doc.context.lookup(h, PDFDict).get(k('K'))?.toString()).toBe('0');
    expect(doc.catalog.has(k('Metadata'))).toBe(false);
  });
  it('preserves page-reference MCID ownership when page positions change', async () => {
    const { doc, page, bytes, f } = await fixture(); doc.removePage(0); doc.addPage(page);
    const result = await applyTagEdits(await doc.save(), [{ kind: 'alt', id: f.toString(), text: 'Moved figure' }]);
    expect((await readTagTree(result)).nodes[1].pageIndex).toBe(1);
    expect((await auditAccessibility(result)).some(f => f.code === 'unsupported-tag-tree')).toBe(false);
    expect(bytes.length).toBeGreaterThan(0);
  });
  it('rejects malformed ownership, unsupported stream MCIDs, cycles and incomplete order without changing input', async () => {
    const { doc, heading, root, h, bytes } = await fixture(); const before = bytes.slice();
    await expect(applyTagEdits(bytes, [{ kind: 'order', parentId: 'root', children: [h.toString()] }])).rejects.toMatchObject({ code: 'invalid-change' });
    heading.set(k('K'), doc.context.obj({ Type: 'MCR', Pg: doc.getPage(0).ref, MCID: 0, Stm: h }));
    await expect(applyTagEdits(await doc.save(), [])).rejects.toMatchObject({ code: 'unsupported-structure' });
    heading.set(k('K'), h); root.set(k('K'), doc.context.obj([h]));
    await expect(readTagTree(await doc.save())).rejects.toMatchObject({ code: 'invalid-tag-tree' }); expect(bytes).toEqual(before);
  });
  it('edits TH scope and form tooltips, without regenerating appearances or removing form values', async () => {
    const { doc, heading, h } = await fixture(); heading.set(k('S'), k('TH'));
    const field = doc.getForm().createTextField('name'); field.setText('Original value');
    const bytes = await doc.save(); const result = await applyTagEdits(bytes, [
      { kind: 'scope', id: h.toString(), scope: 'Column' }, { kind: 'form-label', fieldId: field.ref.toString(), text: 'Full name' },
    ]);
    const out = await PDFDocument.load(result); expect(out.getForm().getTextField('name').getText()).toBe('Original value');
    expect(out.context.lookup(h, PDFDict).lookup(k('A'), PDFDict).get(k('Scope'))?.toString()).toBe('/Column');
    expect(out.getForm().getTextField('name').acroField.dict.lookup(k('TU'), PDFHexString).decodeText()).toBe('Full name');
  });
  it('handles untagged documents honestly and cancels atomically', async () => {
    const doc = await PDFDocument.create(); doc.addPage(); const bytes = await doc.save();
    expect((await auditAccessibility(bytes)).some(f => f.code === 'missing-tags')).toBe(true);
    const output = await applyTagEdits(bytes, [{ kind: 'language', language: 'cs' }]);
    expect((await PDFDocument.load(output)).catalog.lookup(k('Lang'), PDFHexString).decodeText()).toBe('cs');
    await expect(applyTagEdits(bytes, [{ kind: 'alt', id: '1 0 R', text: 'Figure' }])).rejects.toMatchObject({ code: 'unsupported-structure' });
    const tagged = await fixture(); const abort = new AbortController(); abort.abort();
    await expect(applyTagEdits(tagged.bytes, [], abort.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('labels an untagged AcroForm and sets document language while preserving field value and visible text', async () => {
    const doc = await PDFDocument.create(), page = doc.addPage(); page.drawText('Keep visible text');
    const field = doc.getForm().createTextField('name'); field.setText('Original value'); field.addToPage(page, { x: 20, y: 30, width: 120, height: 30 });
    const input = await doc.save(), original = input.slice();
    const output = await applyTagEdits(input, [{ kind: 'form-label', fieldId: field.ref.toString(), text: 'Full name' }, { kind: 'language', language: 'cs-CZ' }]);
    const parsed = await PDFDocument.load(output);
    expect(parsed.catalog.has(k('StructTreeRoot'))).toBe(false);
    expect(parsed.catalog.lookup(k('Lang'), PDFHexString).decodeText()).toBe('cs-CZ');
    expect(parsed.getForm().getTextField('name').getText()).toBe('Original value');
    expect(parsed.getForm().getTextField('name').acroField.dict.lookup(k('TU'), PDFHexString).decodeText()).toBe('Full name');
    expect(input).toEqual(original);
    const reader = await getDocument({ data: output.slice() }).promise;
    try {
      const independent = await reader.getPage(1);
      expect((await independent.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')).toContain('Keep visible text');
      expect((await independent.getAnnotations()).find(item => item.fieldName === 'name')).toMatchObject({ fieldValue: 'Original value' });
    } finally { await reader.destroy(); }
  });
  it('refuses independent edits when an existing tag tree is invalid instead of deleting it', async () => {
    const { doc, root, h } = await fixture(); root.set(k('K'), doc.context.obj([h, h]));
    const input = await doc.save(), original = input.slice();
    await expect(applyTagEdits(input, [{ kind: 'language', language: 'cs' }])).rejects.toMatchObject({ code: 'invalid-tag-tree' });
    expect(input).toEqual(original); expect((await PDFDocument.load(input)).catalog.has(k('StructTreeRoot'))).toBe(true);
  });
  it('PDF.js independently reads edited headings, figure alt and page MCID references', async () => {
    const { bytes, h, f } = await fixture();
    const output = await applyTagEdits(bytes, [{ kind: 'role', id: h.toString(), role: 'H2' }, { kind: 'alt', id: f.toString(), text: 'Accessible diagram' }]);
    const reader = await getDocument({ data: output.slice() }).promise;
    try {
      const tree = await (await reader.getPage(1)).getStructTree();
      expect(tree?.children.map(node => 'role' in node ? node.role : '')).toEqual(['H2', 'Figure']);
      expect(tree?.children[1]).toMatchObject({ role: 'Figure', alt: 'Accessible diagram', children: [{ type: 'content' }] });
    } finally { await reader.destroy(); }
  });
  it('rejects stale reverse ownership and duplicate page ParentTree indexes', async () => {
    const { doc, root, h, f } = await fixture();
    root.set(k('ParentTree'), doc.context.obj({ Nums: [0, [f, h]] }));
    await expect(readTagTree(await doc.save())).rejects.toMatchObject({ code: 'invalid-tag-tree' });
    root.set(k('ParentTree'), doc.context.obj({ Nums: [0, [h, f]] }));
    doc.getPage(1).node.set(k('StructParents'), doc.context.obj(0));
    await expect(readTagTree(await doc.save())).rejects.toMatchObject({ code: 'invalid-tag-tree' });
  });
  it('refuses custom roles, signatures and out of range edit values', async () => {
    const { bytes, h, doc, root } = await fixture();
    await expect(applyTagEdits(bytes, [{ kind: 'role', id: h.toString(), role: 'Custom' }])).rejects.toMatchObject({ code: 'invalid-change' });
    await expect(applyTagEdits(bytes, [{ kind: 'language', language: 'bad language' }])).rejects.toMatchObject({ code: 'invalid-change' });
    root.set(k('RoleMap'), doc.context.obj({ Custom: 'P' }));
    await expect(readTagTree(await doc.save())).rejects.toMatchObject({ code: 'unsupported-structure' });
    root.delete(k('RoleMap')); doc.catalog.set(k('Perms'), doc.context.obj({}));
    await expect(applyTagEdits(await doc.save(), [])).rejects.toMatchObject({ code: 'unsupported-structure' });
  });
  it('rejects orphan ParentTree entries and duplicate object indexes', async () => {
    const { doc, root, h, f } = await fixture();
    root.set(k('ParentTree'), doc.context.obj({ Nums: [0, [h, f], 99, [h]] }));
    await expect(readTagTree(await doc.save())).rejects.toMatchObject({ code: 'invalid-tag-tree' });
  });
  it('preserves unrelated structures and visible text on an edited tagged document', async () => {
    const { doc, h } = await fixture(); doc.getPage(1).drawText('Keep visible text');
    doc.catalog.set(k('OCProperties'), doc.context.obj({ OCGs: [], D: { Order: [] } }));
    doc.catalog.set(k('Metadata'), doc.context.register(doc.context.flateStream('<meta>Original metadata</meta>', { Type: 'Metadata', Subtype: 'XML' })));
    const bytes = await doc.save(); const result = await applyTagEdits(bytes, [{ kind: 'role', id: h.toString(), role: 'H3' }]);
    const parsed = await PDFDocument.load(result); expect(parsed.catalog.has(k('Metadata'))).toBe(true); expect(parsed.catalog.has(k('OCProperties'))).toBe(true);
    const reader = await getDocument({ data: result.slice() }).promise;
    try { expect((await (await reader.getPage(2)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')).toBe('Keep visible text'); }
    finally { await reader.destroy(); }
  });
});
