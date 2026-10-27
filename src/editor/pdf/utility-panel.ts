import { applyPageFurniture, removePageFurniture, type FurnitureKind, type FurnitureSpec } from './page-furniture';
import { findPageCandidates, optimizePdf, renderOptimizationPreview, type OptimizationResult } from './optimize';
import { repairPdf } from './repair';
import { createBatchZip, runPdfBatch, type BatchOutcome } from './batch';
import { loadStandardDocument } from './forms';
import { parsePageSelection } from '../studio/page-actions';
import { panelButton, panelCloseGuard, panelInput, type StandardPdfToolsApi } from './standard-tools';

export function setupPdfUtilities(api: StandardPdfToolsApi): void {
  api.registerDocumentAction('PDF nástroje', () => api.mountDocumentPanel('PDF nástroje', body => mountUtilityPanel(body, api)));
}
function download(bytes: Uint8Array, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type })), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountUtilityPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const t = api.t ?? ((message: string) => message), guard = panelCloseGuard(body);
  const controls = document.createElement('fieldset'), status = document.createElement('p'), preview = document.createElement('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const explanation = document.createElement('p'); explanation.textContent = t('Nástroje pracují lokálně. Stejný název nahradí dřívější položku v celém PDF. Ostatní obsah zůstane zachován.');
  const kindLabel = document.createElement('label'), kindTitle = document.createElement('span'), kind = document.createElement('select'); kindTitle.textContent = t('Druh položky'); kindLabel.append(kindTitle, kind);
  for (const [value, label] of [['header', 'Záhlaví'], ['footer', 'Zápatí'], ['page-number', 'Čísla stran'], ['bates', 'Bates číslování'], ['text-watermark', 'Textový vodoznak'], ['image-watermark', 'Obrazový vodoznak']]) { const option = document.createElement('option'); option.value = value; option.textContent = t(label); kind.append(option); }
  controls.append(kindLabel);
  const id = panelInput(controls, 'Název položky', t('Číslování'), t), pages = panelInput(controls, 'Rozsah stránek (např. 1-3,5)', '1', t), text = panelInput(controls, 'Text ({page}, {pages}, {bates})', '{page} / {pages}', t);
  const start = panelInput(controls, 'Počáteční číslo', '1', t, 'number'), prefix = panelInput(controls, 'Bates prefix', '', t), padding = panelInput(controls, 'Bates počet číslic', '6', t, 'number');
  const size = panelInput(controls, 'Velikost písma (pt)', '12', t, 'number'), margin = panelInput(controls, 'Okraj (pt)', '24', t, 'number'), opacity = panelInput(controls, 'Krytí (0–1)', '1', t, 'number'), angle = panelInput(controls, 'Úhel (stupně)', '0', t, 'number');
  opacity.step = '0.05';
  const imageFile = panelInput(controls, 'Obrázek vodoznaku (PNG/JPEG)', '', t, 'file'); imageFile.accept = 'image/png,image/jpeg';
  const imageWidth = panelInput(controls, 'Šířka obrázku (pt)', '150', t, 'number'), imageHeight = panelInput(controls, 'Výška obrázku (pt)', '100', t, 'number');
  const alignLabel = document.createElement('label'), alignTitle = document.createElement('span'), align = document.createElement('select'); alignTitle.textContent = t('Zarovnání'); alignLabel.append(alignTitle, align);
  for (const [value, label] of [['center', 'Na střed'], ['left', 'Vlevo'], ['right', 'Vpravo']]) { const option = document.createElement('option'); option.value = value; option.textContent = t(label); align.append(option); } controls.append(alignLabel);
  let alive = true, abort: AbortController | undefined, pending: { result: OptimizationResult; revision: number; mode: 'lossless' | 'lossy' } | undefined;
  const cancel = panelButton('Zrušit operaci', () => abort?.abort(), t); cancel.disabled = true;
  const applyOptimized = panelButton('Použít ověřenou optimalizaci', () => { void run(async signal => { if (!pending) return; const { result, revision, mode } = pending; await api.runPdfOperation(mode === 'lossless' ? 'Bezztrátová optimalizace' : 'Ztrátová komprese obrázků (JPEG)', async () => result.bytes.slice(), revision, signal); pending = undefined; preview.replaceChildren(); applyOptimized.disabled = true; status.textContent = t('Optimalizace použita.'); }); }, t); applyOptimized.disabled = true;
  async function run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (abort || !alive) return; const controller = new AbortController(); abort = controller; controls.disabled = true; cancel.disabled = false; guard.setBusy(true); body.setAttribute('aria-busy', 'true');
    try { await action(controller.signal); }
    catch { if (alive) status.textContent = controller.signal.aborted ? t('Operace zrušena.') : t('Operace se nezdařila. Zkontrolujte vstup, rozsah a podporované struktury.'); }
    finally { abort = undefined; if (alive) { controls.disabled = false; cancel.disabled = true; guard.setBusy(false); body.removeAttribute('aria-busy'); } }
  }
  async function readSpec(bytes: Uint8Array): Promise<FurnitureSpec> {
    const doc = await loadStandardDocument(bytes), spec: FurnitureSpec = { id: await managedId(), kind: kind.value as FurnitureKind, indices: parsePageSelection(pages.value, doc.getPageCount()), text: text.value, start: Number(start.value), prefix: prefix.value, padding: Number(padding.value), fontSize: Number(size.value), margin: Number(margin.value), opacity: Number(opacity.value), angle: Number(angle.value), align: align.value as FurnitureSpec['align'] };
    if (spec.kind === 'image-watermark') { const file = imageFile.files?.[0]; if (!file || file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) throw new Error('invalid-image'); spec.image = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type === 'image/png' ? 'png' : 'jpeg', width: Number(imageWidth.value), height: Number(imageHeight.value) }; }
    return spec;
  }
  async function managedId(): Promise<string> {
    const name = id.value.trim().normalize('NFC'); if (!name || name.length > 200) throw new Error('invalid-name');
    return 'named-' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name)))].slice(0, 16).map(value => value.toString(16).padStart(2, '0')).join('');
  }
  controls.append(panelButton('Použít položku', () => { void run(async signal => { const snapshot = await api.readPdfSnapshot(); signal.throwIfAborted(); const spec = await readSpec(snapshot.bytes); signal.throwIfAborted(); await api.runPdfOperation('Číslování a vodoznaky', (bytes, operationSignal) => applyPageFurniture(bytes, spec, { signal: operationSignal }), snapshot.revision, signal); status.textContent = t('Spravovaná položka použita.'); }); }, t));
  controls.append(panelButton('Odstranit položku podle názvu', () => { void run(async signal => { const snapshot = await api.readPdfSnapshot(); signal.throwIfAborted(); const itemId = await managedId(); signal.throwIfAborted(); await api.runPdfOperation('Odstranit spravovanou položku', (bytes, operationSignal) => removePageFurniture(bytes, itemId, operationSignal), snapshot.revision, signal); status.textContent = t('Spravovaná položka odstraněna.'); }); }, t));
  const optimizationInfo = document.createElement('p'); optimizationInfo.textContent = t('Bezztrátová optimalizace odstraní nedostupné objekty a zabalí struktury. Text, vektory a obrázky zachová. Úspora není zaručena; před použitím porovná vzhled, text a anotace všech stran.'); controls.append(optimizationInfo);
  controls.append(panelButton('Porovnat bezztrátovou optimalizaci', () => { void run(async signal => {
    pending = undefined; applyOptimized.disabled = true; preview.replaceChildren(); const snapshot = await api.readPdfSnapshot(), result = await optimizePdf(snapshot.bytes, { mode: 'lossless' }, signal);
    pending = { result, revision: snapshot.revision, mode: 'lossless' }; applyOptimized.textContent = t('Použít ověřenou optimalizaci'); applyOptimized.disabled = !result.changed;
    status.textContent = `${t('Původní bajty')}: ${result.beforeBytes}; ${t('Výsledné bajty')}: ${result.afterBytes}. ${t('Vzhled, text a anotace ověřeny.')} ${result.changed ? '' : t('Menší výstup nevznikl; zachován originál.')}`;
  }); }, t), applyOptimized);
  const lossyInfo = document.createElement('p'); lossyInfo.textContent = t('Ztrátová komprese obrázků (JPEG): pouze podporované vložené RGB JPEG. Text a vektory se nepřevádějí na obrázek. Obraz se může změnit.'); controls.append(lossyInfo);
  const jpegQuality = panelInput(controls, 'JPEG kvalita (0,1–0,9)', '0.5', t, 'number'); jpegQuality.min = '0.1'; jpegQuality.max = '0.9'; jpegQuality.step = '0.05';
  controls.append(panelButton('Porovnat ztrátovou kompresi obrázků', () => { void run(async signal => {
    pending = undefined; applyOptimized.disabled = true; preview.replaceChildren(); const snapshot = await api.readPdfSnapshot(); signal.throwIfAborted();
    const result = await optimizePdf(snapshot.bytes, { mode: 'lossy', quality: Number(jpegQuality.value) }, signal);
    const pageIndex = api.getPageSurface?.()?.pageIndex ?? 0;
    const originalImage = await renderOptimizationPreview(snapshot.bytes, pageIndex, signal);
    const changedImage = await renderOptimizationPreview(result.bytes, pageIndex, signal); signal.throwIfAborted(); if (!alive) return;
    for (const [label, source] of [['Původní stránka', originalImage], ['Nová stránka', changedImage]]) {
      const figure = document.createElement('figure'), caption = document.createElement('figcaption'), image = document.createElement('img');
      caption.textContent = t(label); image.alt = t(label); image.src = source; image.style.maxWidth = '100%'; figure.append(caption, image); preview.append(figure);
    }
    pending = { result, revision: snapshot.revision, mode: 'lossy' }; applyOptimized.textContent = t('Použít ověřenou ztrátovou optimalizaci'); applyOptimized.disabled = !result.changed;
    status.textContent = `${t('Původní bajty')}: ${result.beforeBytes}; ${t('Výsledné bajty')}: ${result.afterBytes}; ${t('Očekávaná úspora')}: ${Math.max(0, result.beforeBytes - result.afterBytes)}; ${t('Překódované obrázky')}: ${result.recompressedImages ?? 0}. ${t('Text, vektory a anotace ověřeny; obraz se může změnit.')}`;
  }); }, t));
  const repairControls = document.createElement('fieldset'), repairLegend = document.createElement('legend'); repairLegend.textContent = t('Opravit chybějící konec PDF'); repairControls.append(repairLegend);
  const repairInput = panelInput(repairControls, 'Vyberte soubory PDF', '', t, 'file'); repairInput.accept = 'application/pdf,.pdf';
  repairControls.append(panelButton('Opravit chybějící konec PDF', () => { void run(async signal => {
    const file = repairInput.files?.[0]; if (!file || !file.size || file.size > 50 * 1024 * 1024) throw new Error('repair-limit');
    const raw = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted(); if (!alive) return;
    const result = await repairPdf(raw, signal); signal.throwIfAborted(); if (!alive) return;
    download(result.bytes, 'application/pdf', 'repaired.pdf'); status.textContent = t('Opravený soubor ověřen. Stáhnout PDF.');
  }); }, t)); controls.append(repairControls);
  controls.append(panelButton('Vyhledat prázdné a duplicitní stránky', () => { void run(async signal => {
    const snapshot = await api.readPdfSnapshot(), candidates = await findPageCandidates(snapshot.bytes, signal); preview.replaceChildren();
    const notice = document.createElement('p'); notice.textContent = t('Pouze kandidáti podle renderu. Vyberte stránky ke kontrole; nic se automaticky nemaže.'); preview.append(notice);
    for (const candidate of candidates) { const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; const description = document.createElement('span'); description.textContent = `${candidate.pageIndex + 1}: ${t(candidate.kind === 'blank' ? 'Prázdná stránka' : 'Duplicitní stránka')}${candidate.duplicateOf === undefined ? '' : ` (${candidate.duplicateOf + 1})`}`; label.append(checkbox, description); preview.append(label); }
    status.textContent = `${t('Nalezeno kandidátů')}: ${candidates.length}`;
  }); }, t));
  const batchFiles = panelInput(controls, 'Dávkové PDF soubory (max. 20 / 100 MiB)', '', t, 'file'); batchFiles.accept = 'application/pdf'; batchFiles.multiple = true;
  async function batch(mode: 'furniture' | 'optimize', signal: AbortSignal): Promise<void> {
    const files = [...(batchFiles.files ?? [])]; if (!files.length || files.length > 20 || files.some(file => file.size > 50 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error('batch-limit');
    const items = []; for (const file of files) { signal.throwIfAborted(); items.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); }
    const pipeline = mode === 'optimize' ? [{ kind: 'optimize' as const }] : [{ kind: 'furniture' as const, spec: await readSpec(items[0].bytes) }], outcomes: BatchOutcome[] = [];
    for await (const outcome of runPdfBatch(items, pipeline, signal)) { outcomes.push(outcome); if (alive) status.textContent = `${t('Zpracováno souborů')}: ${outcomes.length}/${items.length}`; }
    signal.throwIfAborted(); if (outcomes.some(outcome => outcome.status === 'success')) download(await createBatchZip(outcomes, signal), 'application/zip', 'pdf-batch.zip');
    status.textContent = `${t('Úspěšné soubory')}: ${outcomes.filter(outcome => outcome.status === 'success').length}; ${t('Selhané soubory')}: ${outcomes.filter(outcome => outcome.status === 'failed').length}`;
  }
  controls.append(panelButton('Dávka: použít položku a stáhnout ZIP', () => { void run(signal => batch('furniture', signal)); }, t), panelButton('Dávka: optimalizovat a stáhnout ZIP', () => { void run(signal => batch('optimize', signal)); }, t));
  body.append(explanation, controls, cancel, status, preview);
  return () => { alive = false; abort?.abort(); guard.dispose(); pending = undefined; };
}
