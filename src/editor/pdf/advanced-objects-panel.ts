import { inspectOptionalContent, editOptionalContent, type PdfLayer } from './layers';
import { listPortfolio, editPortfolio, extractPortfolioItem, type PortfolioEntry } from './portfolio';
import { inspectEmbeddedMedia, extractEmbeddedMedia, type MediaDescriptor } from './embedded-media';
import { panelButton, panelInput, type StandardPdfToolsApi } from './standard-tools';
import { downloadPanelBytes, pdfPanelSession } from './accessibility-panel';

export function setupAdvancedObjectsTools(api: StandardPdfToolsApi): void {
  api.registerDocumentAction('Vrstvy, portfolio a média', () => api.mountDocumentPanel('Vrstvy, portfolio a média', body => mountAdvancedObjectsPanel(body, api)));
}
export function mountAdvancedObjectsPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const session = pdfPanelSession(body, api), { t, controls, status, run, current } = session;
  const notice = document.createElement('p'); notice.textContent = t('Pouze místní soubory. Média se nikdy automaticky neotevírají ani nespouštějí. Podporovány jsou jednoduché vrstvy OCG; složité konfigurace se odmítnou.'); controls.append(notice);
  const layersView = document.createElement('div'), filesView = document.createElement('div'), mediaView = document.createElement('div');
  let layers: PdfLayer[] = [], files: PortfolioEntry[] = [], media: MediaDescriptor[] = [], revision = -1, offset = 0;
  const fileInput = panelInput(controls, 'Soubor do portfolia (max. 20 MiB)', '', t, 'file');
  async function mutate(prepare: Parameters<StandardPdfToolsApi['runPdfOperation']>[1]) {
    await run(async signal => { if (revision < 0) throw new Error('read-first'); await current(revision, signal); await api.runPdfOperation('Upravit vrstvy nebo portfolio', prepare, revision, signal); signal.throwIfAborted(); revision = -1; layers = []; files = []; media = []; layersView.replaceChildren(); filesView.replaceChildren(); mediaView.replaceChildren(); status.textContent = t('Změna použita. Znovu načtěte kontrolu.'); });
  }
  function render() {
    layersView.replaceChildren(); filesView.replaceChildren(); mediaView.replaceChildren();
    for (const [localIndex, layer] of layers.slice(offset, offset + 25).entries()) {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `${t('Vrstva')}: ${layer.name}`; row.append(legend);
      const name = panelInput(row, 'Název vrstvy', layer.name, t), visible = panelInput(row, 'Viditelná vrstva', '', t, 'checkbox'); visible.checked = layer.visible;
      const wrapper = document.createElement('label'), title = document.createElement('span'), exportState = document.createElement('select'); title.textContent = t('Stav vrstvy při exportu'); wrapper.append(title, exportState);
      for (const [value, text] of [['Unchanged', 'Beze změny'], ['ON', 'Zapnuto'], ['OFF', 'Vypnuto']]) { const option = document.createElement('option'); option.value = value; option.textContent = t(text); exportState.append(option); } exportState.value = layer.exportState; row.append(wrapper);
      row.append(panelButton('Použít vrstvu', () => { const change = { id: layer.id, name: name.value, visible: visible.checked, exportState: exportState.value as PdfLayer['exportState'] }; void mutate((bytes, signal) => editOptionalContent(bytes, [change], signal)); }, t));
      for (const [direction, text] of [[-1, 'Posunout vrstvu nahoru'], [1, 'Posunout vrstvu dolů']] as const) {
        const at = offset + localIndex, button = panelButton(text, () => { const ids = layers.map(l => l.id), to = at + direction; [ids[at], ids[to]] = [ids[to], ids[at]]; void mutate((bytes, signal) => editOptionalContent(bytes, [{ kind: 'order', ids }], signal)); }, t); button.disabled = at + direction < 0 || at + direction >= layers.length; row.append(button);
      }
      layersView.append(row);
    }
    for (const file of files.slice(offset, offset + 25)) {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `${file.filename} (${file.size} B)`; row.append(legend);
      const description = panelInput(row, 'Popis souboru', file.description, t);
      row.append(panelButton('Použít popis souboru', () => { const value = description.value; void mutate((bytes, signal) => editPortfolio(bytes, { kind: 'metadata', id: file.id, description: value }, signal)); }, t), panelButton('Odstranit soubor z portfolia', () => { void mutate((bytes, signal) => editPortfolio(bytes, { kind: 'remove', id: file.id }, signal)); }, t), panelButton('Stáhnout soubor z portfolia', () => { void run(async signal => { const snapshot = await api.readPdfSnapshot(); if (snapshot.revision !== revision) throw new Error('stale'); const result = await extractPortfolioItem(snapshot.bytes, file.id, signal); await current(revision, signal); downloadPanelBytes(result.bytes, result.mimeType, result.filename); }); }, t)); filesView.append(row);
    }
    for (const item of media.slice(offset, offset + 25)) {
      const format = item.format === 'PDF sound stream' ? t('Zvukový stream PDF') : item.format === 'Embedded movie bytes' ? t('Vložená filmová data') : ['U3D', 'PRC'].includes(item.format) ? item.format : t('Neznámý formát');
      const row = document.createElement('p'); row.textContent = `${t('Stránka')} ${item.pageIndex + 1}: ${item.subtype}, ${format}. ${t(item.extractable ? 'Dostupné k extrakci' : 'Pouze inventář; extrakce není podporována')}`;
      if (item.extractable) row.append(panelButton('Stáhnout vložené médium', () => { void run(async signal => { const snapshot = await api.readPdfSnapshot(); if (snapshot.revision !== revision) throw new Error('stale'); const result = await extractEmbeddedMedia(snapshot.bytes, item.id, signal); await current(revision, signal); downloadPanelBytes(result.bytes, result.mimeType, result.filename); }); }, t)); mediaView.append(row);
    }
    status.textContent = `${t('Vrstvy')}: ${layers.length}; ${t('Soubory')}: ${files.length}; ${t('Média')}: ${media.length}; ${offset + 1}–${offset + 25}`;
  }
  controls.append(panelButton('Načíst vrstvy, portfolio a média', () => { void run(async signal => {
    const snapshot = await api.readPdfSnapshot(); signal.throwIfAborted();
    // Inventory sections fail independently so an unsupported OCG configuration does not hide attachments.
    const errors: string[] = []; let nextLayers: PdfLayer[] = [], nextFiles: PortfolioEntry[] = [], nextMedia: MediaDescriptor[] = [];
    try { nextLayers = await inspectOptionalContent(snapshot.bytes, signal); } catch { signal.throwIfAborted(); errors.push(t('Vrstvy nelze načíst.')); }
    try { nextFiles = await listPortfolio(snapshot.bytes, signal); } catch { signal.throwIfAborted(); errors.push(t('Portfolio nelze načíst.')); }
    try { nextMedia = await inspectEmbeddedMedia(snapshot.bytes, signal); } catch { signal.throwIfAborted(); errors.push(t('Média nelze načíst.')); }
    await current(snapshot.revision, signal); revision = snapshot.revision; layers = nextLayers; files = nextFiles; media = nextMedia; offset = 0; render(); status.textContent += ` ${errors.join(' ')}`;
  }); }, t), panelButton('Importovat soubor do portfolia', () => { void run(async signal => {
    const file = fileInput.files?.[0]; if (!file || !file.size || file.size > 20 * 1024 * 1024) throw new Error('file-limit');
    const snapshot = await api.readPdfSnapshot(), data = new Uint8Array(await file.arrayBuffer()); await current(snapshot.revision, signal);
    await api.runPdfOperation('Importovat soubor do portfolia', (bytes, operationSignal) => editPortfolio(bytes, { kind: 'import', filename: file.name, bytes: data, mimeType: file.type || undefined }, operationSignal), snapshot.revision, signal);
    signal.throwIfAborted(); revision = -1; layers = []; files = []; media = []; layersView.replaceChildren(); filesView.replaceChildren(); mediaView.replaceChildren(); status.textContent = t('Změna použita. Znovu načtěte kontrolu.');
  }); }, t), panelButton('Předchozích 25 položek', () => { offset = Math.max(0, offset - 25); render(); }, t), panelButton('Dalších 25 položek', () => { if (offset + 25 < Math.max(layers.length, files.length, media.length)) offset += 25; render(); }, t), layersView, filesView, mediaView);
  return session.dispose;
}
