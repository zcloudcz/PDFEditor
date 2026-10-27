import { preflightPdf, type PreflightReport } from './preflight';
import { exportPrintPdf } from './print-export';
import { panelButton, panelInput, type StandardPdfToolsApi } from './standard-tools';
import { downloadPanelBytes, pdfPanelSession } from './accessibility-panel';

export function setupPrintTools(api: StandardPdfToolsApi): void {
  api.registerDocumentAction('Tisková příprava PDF', () => api.mountDocumentPanel('Tisková příprava PDF', body => mountPrintPanel(body, api)));
}
const findingLabels: Record<string, string> = { 'font-not-embedded': 'Nevložené písmo', 'image-low-dpi': 'Nízké rozlišení obrázku', transparency: 'Průhlednost', 'invalid-boxes': 'Neplatné hranice stránky', 'text-outside-trim': 'Text mimo ořez', 'image-placement-unchecked': 'Umístění obrázku není ověřeno' };
export function mountPrintPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const session = pdfPanelSession(body, api), { t, controls, status, run, current } = session;
  const notice = document.createElement('p'); notice.textContent = t('Pouze běžné PDF. PDF/A-2b a PDF/X-4 nejsou dostupné: chybí nezávislý validátor a převodník. Bez potvrzení ICC, CMYK, přetisků či separací. Podporovány jsou pouze nezabalené a Flate streamy bez prediktorů. Kontrola přesahu ověřuje hranice extrahovaného textu, nikoli všechnu grafiku.'); controls.append(notice);
  const trim = panelInput(controls, 'Odsazení ořezu od MediaBox (pt)', '18', t, 'number'), bleed = panelInput(controls, 'Spadávka (pt)', '9', t, 'number'), marks = panelInput(controls, 'Přidat vektorové ořezové značky', '', t, 'checkbox'); marks.checked = true;
  const dpi = panelInput(controls, 'Minimální rozlišení obrázků (DPI)', '150', t, 'number'), reportView = document.createElement('pre');
  let report: PreflightReport | undefined, revision = -1, offset = 0;
  const lines = () => (report?.findings ?? []).map(f => `${t('Stránka')} ${f.pageIndex + 1}: ${t(findingLabels[f.code])}${f.value === undefined ? '' : ` (${f.value})`}`);
  function render() { reportView.textContent = lines().slice(offset, offset + 25).join('\n'); status.textContent = `${t('Nalezené položky')}: ${report?.findings.length ?? 0}; ${offset + 1}–${offset + 25}`; }
  controls.append(panelButton('Zkontrolovat tiskové podklady', () => { void run(async signal => { const snapshot = await api.readPdfSnapshot(); signal.throwIfAborted(); const result = await preflightPdf(snapshot.bytes, 'ordinary-pdf', { signal, minimumDpi: Number(dpi.value) }); await current(snapshot.revision, signal); report = result; revision = snapshot.revision; offset = 0; render(); }); }, t), panelButton('Použít tiskové hranice a značky', () => { void run(async signal => {
    const settings = { profile: 'ordinary-pdf' as const, trimInsetPt: Number(trim.value), bleedPt: Number(bleed.value), cropMarks: marks.checked }, snapshot = await api.readPdfSnapshot(); await current(snapshot.revision, signal);
    await api.runPdfOperation('Tiskové hranice a ořezové značky', (bytes, operationSignal) => exportPrintPdf(bytes, settings, operationSignal), snapshot.revision, signal); signal.throwIfAborted(); report = undefined; revision = -1; reportView.textContent = ''; status.textContent = t('Změna použita. Znovu načtěte kontrolu.');
  }); }, t), panelButton('Stáhnout tiskovou zprávu', () => { void run(async signal => { if (!report || revision < 0) throw new Error('read-first'); await current(revision, signal); downloadPanelBytes(new TextEncoder().encode(`${notice.textContent}\n${lines().join('\n')}`), 'text/plain;charset=utf-8', 'print-report.txt'); }); }, t), panelButton('Předchozích 25 položek', () => { offset = Math.max(0, offset - 25); render(); }, t), panelButton('Dalších 25 položek', () => { if (offset + 25 < (report?.findings.length ?? 0)) offset += 25; render(); }, t), reportView);
  return session.dispose;
}
