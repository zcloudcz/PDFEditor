import { PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { loadBoundedObjectDocument as loadNavigationDocument } from './bounded-objects';
import { parseTagTree, validateFormTree } from './tag-tree';

export interface AccessibilityFinding { code: string; severity: 'error' | 'warning' | 'manual'; tagId?: string; fieldId?: string }
export const ACCESSIBILITY_PROFILE = Object.freeze({
  id: 'existing-standard-tags-v1', certification: false, validator: 'unavailable',
  limits: '200 pages, 50 MiB, 20000 tree entries, depth 64; existing standard-role tags and page MCIDs only',
  humanChecks: ['reading-order', 'heading-hierarchy', 'table-associations', 'alternative-text-meaning', 'form-label-meaning', 'screen-reader'],
});

/** Bounded structural findings only: does not prove content tagging coverage or PDF/UA. */
export async function auditAccessibility(bytes: Uint8Array): Promise<AccessibilityFinding[]> {
  const doc = await loadNavigationDocument(bytes); const findings: AccessibilityFinding[] = [];
  const add = (code: string, severity: AccessibilityFinding['severity'], tagId?: string, fieldId?: string) => findings.push({ code, severity, ...(tagId ? { tagId } : {}), ...(fieldId ? { fieldId } : {}) });
  const lang = doc.catalog.get(PDFName.of('Lang')); const resolved = lang && doc.context.lookup(lang);
  if (!(resolved instanceof PDFHexString || resolved instanceof PDFString) || !resolved.decodeText().trim()) add('missing-language', 'error');
  if (!doc.getTitle()?.trim()) add('missing-title', 'warning');
  if (!doc.catalog.has(PDFName.of('StructTreeRoot'))) add('missing-tags', 'error');
  else {
    try {
      const tree = parseTagTree(doc).tree; let heading = 0;
      if (!tree.nodes.length) add('empty-tag-tree', 'error');
      for (const node of tree.nodes) {
        if (['Figure', 'Formula'].includes(node.role) && !node.alt?.trim()) add('missing-alt', 'error', node.id);
        if (node.role === 'TH' && !['Row', 'Column', 'Both'].includes(node.scope ?? '')) add('missing-table-scope', 'warning', node.id);
        if (/^H[1-6]$/.test(node.role)) { const level = Number(node.role.slice(1)); if (level > heading + 1) add('heading-level-gap', 'warning', node.id); heading = level; }
        if (node.role === 'TD') add('review-table-header-association', 'manual', node.id);
      }
    } catch { add('unsupported-tag-tree', 'error'); }
  }
  try {
    validateFormTree(doc);
    for (const field of doc.getForm().getFields()) {
      const label = field.acroField.dict.get(PDFName.of('TU')); const object = label && doc.context.lookup(label);
      if (!(object instanceof PDFHexString || object instanceof PDFString) || !object.decodeText().trim()) add('missing-form-label', 'error', undefined, field.ref.toString());
    }
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (form?.has(PDFName.of('XFA'))) add('unsupported-xfa', 'error');
  } catch { add('unsupported-form-tree', 'error'); }
  add('content-tagging-coverage-unverified', 'manual'); add('external-validator-unavailable', 'warning'); add('manual-review-required', 'manual'); return findings;
}
