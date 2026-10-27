import { auditAccessibility, type AccessibilityFinding } from './accessibility';
import { applyTagEdits, readTagTree, validateFormTree, type TagTree, type TagEdit } from './tag-tree';
import { loadBoundedObjectDocument } from './bounded-objects';
import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { panelButton, panelInput, panelCloseGuard, type StandardPdfToolsApi } from './standard-tools';

export function setupAccessibilityTools(api: StandardPdfToolsApi): void {
  api.registerDocumentAction('Přístupnost PDF', () => api.mountDocumentPanel('Přístupnost PDF', body => mountAccessibilityPanel(body, api)));
}

/** The host owns atomic commits; the panel also refuses stale reads and late downloads. */
export function pdfPanelSession(body: HTMLElement, api: StandardPdfToolsApi) {
  const t = api.t ?? ((s: string) => s), controls = document.createElement('fieldset'), status = document.createElement('p'), guard = panelCloseGuard(body);
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  let alive = true, controller: AbortController | undefined;
  const cancel = panelButton('Zrušit operaci', () => controller?.abort(), t); cancel.disabled = true;
  body.append(controls, cancel, status);
  async function run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (!alive || controller) return;
    const current = new AbortController(); controller = current; controls.disabled = true; cancel.disabled = false; guard.setBusy(true); body.setAttribute('aria-busy', 'true');
    try { await action(current.signal); }
    catch { if (alive) status.textContent = current.signal.aborted ? t('Operace zrušena.') : t('Operace se nezdařila. Zkontrolujte vstup, rozsah a podporované struktury.'); }
    finally { controller = undefined; if (alive) { controls.disabled = false; cancel.disabled = true; guard.setBusy(false); body.removeAttribute('aria-busy'); } }
  }
  async function current(revision: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); if (!alive) throw new Error('closed');
    const latest = await api.readPdfSnapshot(); signal.throwIfAborted();
    if (!alive || latest.revision !== revision) throw new Error('stale');
  }
  return { t, controls, status, run, current, dispose() { alive = false; controller?.abort(); guard.dispose(); } };
}
export function downloadPanelBytes(bytes: Uint8Array, mimeType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const findingLabels: Record<string, string> = {
  'missing-language': 'Chybí jazyk dokumentu', 'missing-title': 'Chybí název dokumentu', 'missing-tags': 'Chybí značky struktury', 'empty-tag-tree': 'Prázdný strom značek',
  'missing-alt': 'Chybí alternativní text', 'missing-table-scope': 'Chybí rozsah záhlaví tabulky', 'heading-level-gap': 'Přeskočená úroveň nadpisu',
  'review-table-header-association': 'Ručně ověřte vazby buněk na záhlaví', 'unsupported-tag-tree': 'Nepodporovaný strom značek', 'missing-form-label': 'Chybí popisek formulářového pole',
  'unsupported-xfa': 'Nepodporovaný formulář XFA', 'unsupported-form-tree': 'Nepodporovaný strom formuláře', 'content-tagging-coverage-unverified': 'Pokrytí obsahu značkami není ověřeno',
  'external-validator-unavailable': 'Nezávislý validátor není k dispozici', 'manual-review-required': 'Vyžaduje ruční kontrolu',
};
export function mountAccessibilityPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const session = pdfPanelSession(body, api), { t, controls, status, run, current } = session;
  const notice = document.createElement('p'); notice.textContent = t('Strukturální kontrola nepotvrzuje PDF/UA. Nezávislý validátor není k dispozici. Ručně ověřte pořadí čtení, nadpisy, tabulky, význam popisů a čtečku obrazovky.'); controls.append(notice);
  const report = document.createElement('pre'), treeView = document.createElement('ol');
  let findings: AccessibilityFinding[] = [], tree: TagTree | undefined, revision = -1, offset = 0, formFields: Array<{ id: string; name: string; label: string }> = [];
  const index = panelInput(controls, 'Číslo značky ve stromu', '1', t, 'number'); index.min = '1';
  const role = panelInput(controls, 'Role značky (např. H1, P, Figure, TH)', 'P', t), language = panelInput(controls, 'Jazyk (např. cs-CZ)', 'cs-CZ', t), alt = panelInput(controls, 'Alternativní text', '', t);
  const scope = panelInput(controls, 'Rozsah záhlaví (Row, Column, Both)', 'Column', t), field = panelInput(controls, 'Identifikátor formulářového pole ze zprávy', '', t), label = panelInput(controls, 'Popisek formulářového pole', '', t);
  const fieldList = document.createElement('ul');
  function fillSelection() { const node = tree?.nodes[Number(index.value) - 1]; if (node) { role.value = node.role; language.value = node.language ?? tree?.language ?? ''; alt.value = node.alt ?? ''; scope.value = node.scope ?? 'Column'; } }
  index.addEventListener('input', fillSelection);
  function lines() { return findings.map(f => `${t(f.severity === 'error' ? 'Chyba' : f.severity === 'warning' ? 'Upozornění' : 'Ruční kontrola')}: ${t(findingLabels[f.code] ?? 'Nepodporovaná struktura')} ${f.tagId ?? f.fieldId ?? ''}`); }
  function render() {
    report.textContent = lines().slice(offset, offset + 25).join('\n'); treeView.replaceChildren(); fieldList.replaceChildren();
    for (const [i, node] of (tree?.nodes ?? []).slice(offset, offset + 25).entries()) { const li = document.createElement('li'); li.textContent = `${offset + i + 1}: ${node.role} (${node.id}) — ${t('Nadřazená značka')}: ${node.parentId}; ${t('Stránka')}: ${node.pageIndex === null ? '—' : node.pageIndex + 1}; ${node.alt ?? ''}`; treeView.append(li); }
    for (const item of formFields.slice(offset, offset + 25)) { const li = document.createElement('li'), choose = document.createElement('button'); choose.type = 'button'; choose.textContent = `${item.name} (${item.id}): ${item.label}`; choose.addEventListener('click', () => { field.value = item.id; label.value = item.label; }); li.append(choose); fieldList.append(li); }
    status.textContent = `${t('Nalezené položky')}: ${findings.length}; ${t('Značky')}: ${tree?.nodes.length ?? 0}; ${offset + 1}–${offset + 25}`;
  }
  controls.append(panelButton('Zkontrolovat přístupnost a načíst strom', () => { void run(async signal => {
    const snapshot = await api.readPdfSnapshot(); signal.throwIfAborted(); const result = await auditAccessibility(snapshot.bytes); let tags: TagTree | undefined;
    try { tags = await readTagTree(snapshot.bytes); } catch { /* The audit includes unsupported/absent trees. */ }
    const fields: Array<{ id: string; name: string; label: string }> = [];
    try { const doc = await loadBoundedObjectDocument(snapshot.bytes); validateFormTree(doc); for (const item of doc.getForm().getFields()) { const tooltip = doc.context.lookup(item.acroField.dict.get(PDFName.of('TU'))); fields.push({ id: item.ref.toString(), name: item.getName(), label: tooltip instanceof PDFString || tooltip instanceof PDFHexString ? tooltip.decodeText() : '' }); } } catch { /* Malformed form details remain in the audit. */ }
    await current(snapshot.revision, signal); findings = result; tree = tags; formFields = fields; revision = snapshot.revision; offset = 0; index.value = '1'; render(); fillSelection();
  }); }, t));
  function mutate(make: () => TagEdit) { void run(async signal => { if (revision < 0) throw new Error('read-first'); const edit = make(); if (edit.kind === 'form-label' && !formFields.some(item => item.id === edit.fieldId)) throw new Error('selection'); await current(revision, signal); await api.runPdfOperation('Upravit značky přístupnosti', (bytes, operationSignal) => applyTagEdits(bytes, [edit], operationSignal), revision, signal); signal.throwIfAborted(); tree = undefined; findings = []; formFields = []; revision = -1; report.textContent = ''; treeView.replaceChildren(); fieldList.replaceChildren(); status.textContent = t('Změna použita. Znovu načtěte kontrolu.'); }); }
  function selected() { const n = Number(index.value); if (!Number.isInteger(n) || n < 1 || !tree?.nodes[n - 1]) throw new Error('selection'); return tree.nodes[n - 1]; }
  controls.append(panelButton('Použít roli značky', () => mutate(() => ({ kind: 'role', id: selected().id, role: role.value })), t), panelButton('Použít alternativní text', () => mutate(() => ({ kind: 'alt', id: selected().id, text: alt.value })), t), panelButton('Použít jazyk značky', () => mutate(() => ({ kind: 'language', id: selected().id, language: language.value })), t), panelButton('Použít jazyk dokumentu', () => mutate(() => ({ kind: 'language', language: language.value })), t), panelButton('Použít rozsah záhlaví', () => mutate(() => ({ kind: 'scope', id: selected().id, scope: scope.value as 'Row' | 'Column' | 'Both' })), t), panelButton('Použít popisek pole', () => mutate(() => ({ kind: 'form-label', fieldId: field.value, text: label.value })), t));
  for (const [direction, title] of [[-1, 'Posunout značku nahoru'], [1, 'Posunout značku dolů']] as const) controls.append(panelButton(title, () => mutate(() => {
    const node = selected(), children = [...(node.parentId === 'root' ? tree!.children : tree!.nodes.find(n => n.id === node.parentId)!.children)], at = children.indexOf(node.id), to = at + direction;
    if (to < 0 || to >= children.length) throw new Error('order'); [children[at], children[to]] = [children[to], children[at]]; return { kind: 'order', parentId: node.parentId, children };
  }), t));
  controls.append(panelButton('Předchozích 25 položek', () => { offset = Math.max(0, offset - 25); render(); }, t), panelButton('Dalších 25 položek', () => { if (offset + 25 < Math.max(findings.length, tree?.nodes.length ?? 0, formFields.length)) offset += 25; render(); }, t), panelButton('Stáhnout zprávu o přístupnosti', () => { void run(async signal => { if (revision < 0) throw new Error('read-first'); await current(revision, signal); downloadPanelBytes(new TextEncoder().encode(`${notice.textContent}\n${lines().join('\n')}`), 'text/plain;charset=utf-8', 'accessibility-report.txt'); }); }, t), report, treeView, fieldList);
  return session.dispose;
}
