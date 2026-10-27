import { recognizePages } from './ocr-service';
import { loadNavigationDocument } from './navigation';
import { parsePageSelection } from '../studio/page-actions';
import { panelButton, panelInput, type StandardPdfToolsApi } from './standard-tools';
import { DEFAULT_SCAN_PREPARATION, type ScanPreparation } from './scan-processing';
import { proposeOcrReconstruction, type OcrReconstructionProposal } from './ocr-reconstruction';
export interface OcrToolApi extends StandardPdfToolsApi { applyOcrReconstruction?(proposal: OcrReconstructionProposal, signal: AbortSignal): Promise<void> }

export function setupOcrTool(api: OcrToolApi): void {
  api.registerDocumentAction('Rozpoznat text (OCR)', () => api.mountDocumentPanel('Rozpoznat text (OCR)', body => mountOcrPanel(body, api)));
}

export function mountOcrPanel(body: HTMLElement, api: OcrToolApi): () => void {
  const t = api.t ?? ((value: string) => value);
  let alive = true, controller: AbortController | undefined;
  const explanation = document.createElement('p');
  explanation.textContent = t('OCR běží pouze v zařízení. Přidá neviditelný text a zachová původní vzhled PDF. Rozpoznání může obsahovat chyby.');
  const controls = document.createElement('fieldset');
  const pages = panelInput(controls, 'Stránky OCR (např. 1-3,5)', '1', t);
  const languageLabel = document.createElement('label'), label = document.createElement('span'), languages = document.createElement('select');
  label.textContent = t('Jazyky OCR'); languageLabel.append(label, languages);
  for (const [value, message] of [['ces+eng', 'Čeština a angličtina'], ['ces', 'Čeština'], ['eng', 'Angličtina']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = t(message); languages.append(option);
  }
  controls.append(languageLabel);
  const orientation = panelInput(controls, 'Otočení vstupu OCR (0, 90, 180, 270)', '0', t, 'number');
  const deskew = panelInput(controls, 'Narovnání vstupu OCR (−5 až 5 stupňů)', '0', t, 'number'); deskew.min = '-5'; deskew.max = '5'; deskew.step = '0.1';
  const contrast = panelInput(controls, 'Kontrast vstupu OCR (0,5 až 3)', '1', t, 'number'); contrast.min = '0.5'; contrast.max = '3'; contrast.step = '0.1';
  const denoise = panelInput(controls, 'Odstranit izolované tmavé pixely', '', t, 'checkbox');
  const preparation = (): ScanPreparation => ({ orientation: Number(orientation.value) as ScanPreparation['orientation'], deskew: Number(deskew.value), contrast: Number(contrast.value), denoise: denoise.checked });
  const comparison = document.createElement('div'), corrections = document.createElement('fieldset');
  let proposal: OcrReconstructionProposal | undefined;
  const reset = panelButton('Obnovit původní vstup OCR', () => { orientation.value = '0'; deskew.value = '0'; contrast.value = '1'; denoise.checked = false; proposal = undefined; comparison.replaceChildren(); corrections.replaceChildren(); apply.disabled = true; }, t);
  const preview = panelButton('Náhled a oprava OCR', () => { void inspect(); }, t);
  const apply = panelButton('Použít editovatelnou rekonstrukci', () => { void reconstruct(); }, t); apply.disabled = true;
  const limitation = document.createElement('p'); limitation.textContent = t('Rekonstrukce vloží editovatelný text a bílé krycí plochy nad původní sken. Původní obsah zůstává v PDF; nejde o redakci. Sloupce a tabulky mohou vyžadovat ruční úpravy. Výsledek není bezztrátový.');
  controls.append(reset, preview);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const textLabel = document.createElement('label'), textTitle = document.createElement('span'), recognized = document.createElement('textarea');
  textTitle.textContent = t('Rozpoznaný text ke kontrole'); recognized.readOnly = true; textLabel.append(textTitle, recognized);
  const cancel = panelButton('Zrušit OCR', () => controller?.abort(), t); cancel.disabled = true;
  const start = panelButton('Spustit OCR', () => { void run(); }, t);
  controls.append(start); body.append(explanation, controls, cancel, status, textLabel, comparison, limitation, corrections, apply);
  function showPreview(original: string, prepared: string): void {
    if (!alive) return; comparison.replaceChildren();
    for (const [url, title] of [[original, 'Původní sken'], [prepared, 'Upravený vstup OCR']]) { const image = document.createElement('img'); image.src = url; image.alt = t(title); image.style.maxWidth = '100%'; comparison.append(image); }
  }
  function busy(value: boolean): void { controls.disabled = corrections.disabled = value; cancel.disabled = !value; apply.disabled = value || !proposal || !api.applyOcrReconstruction; if (value) body.setAttribute('aria-busy', 'true'); else body.removeAttribute('aria-busy'); }
  async function inspect(): Promise<void> {
    if (controller || !alive) return; const abort = new AbortController(); controller = abort; proposal = undefined; busy(true); corrections.replaceChildren();
    status.textContent = t('Probíhá lokální OCR…');
    try {
      const snapshot = await api.readPdfSnapshot(); abort.signal.throwIfAborted(); const doc = await loadNavigationDocument(snapshot.bytes);
      const result = await recognizePages(snapshot.bytes, { indices: parsePageSelection(pages.value, doc.getPageCount()), languages: languages.value.split('+'), mode: 'editable', preparation: preparation(), preview: showPreview }, abort.signal);
      abort.signal.throwIfAborted(); const proposed = proposeOcrReconstruction(snapshot.revision, result.pages);
      if (!alive) return; proposal = proposed; recognized.value = result.pages.map(page => page.text).join('\n\n');
      for (const page of proposed.pages) for (const line of page.lines) {
        const wrapper = document.createElement('label'), title = document.createElement('span'), input = document.createElement('textarea');
        title.textContent = `${page.pageIndex + 1} · ${t('Jistota OCR')}: ${Math.round(line.confidence)} %`; input.value = line.text; input.maxLength = 2000; if (line.confidence < 80) wrapper.dataset.lowConfidence = 'true'; input.addEventListener('input', () => { line.text = input.value; }); wrapper.append(title, input); corrections.append(wrapper);
      }
      status.textContent = t('Náhled OCR je připraven. Opravte text před použitím.');
    } catch { if (alive) status.textContent = abort.signal.aborted ? t('OCR zrušeno. Dokument se nezměnil.') : t('OCR se nezdařilo. Dokument se nezměnil. Zkontrolujte rozsah a lokální aktiva.'); }
    finally { controller = undefined; if (alive) busy(false); }
  }
  async function reconstruct(): Promise<void> {
    if (controller || !proposal || !api.applyOcrReconstruction || !alive) return;
    const abort = new AbortController(); controller = abort; busy(true);
    try { await api.applyOcrReconstruction(proposal, abort.signal); if (alive) { proposal = undefined; status.textContent = t('Editovatelná rekonstrukce byla vložena. Původní sken zůstal zachován.'); } }
    catch { if (alive) status.textContent = t('Rekonstrukce se nezdařila. Obnovte náhled a zkontrolujte text.'); }
    finally { controller = undefined; if (alive) busy(false); }
  }
  async function run(): Promise<void> {
    if (controller || !alive) return;
    const abort = new AbortController(); controller = abort; controls.disabled = true; cancel.disabled = false; body.setAttribute('aria-busy', 'true');
    status.textContent = t('Probíhá lokální OCR…'); recognized.value = '';
    try {
      const snapshot = await api.readPdfSnapshot(); abort.signal.throwIfAborted();
      const document = await loadNavigationDocument(snapshot.bytes); abort.signal.throwIfAborted();
      const indices = parsePageSelection(pages.value, document.getPageCount()), selectedLanguages = languages.value.split('+');
      let resultText = '';
      await api.runPdfOperation('Rozpoznat text (OCR)', async (bytes, signal) => {
        const linkedAbort = () => abort.abort(signal.reason); signal.addEventListener('abort', linkedAbort, { once: true });
        try {
          if (signal.aborted) linkedAbort();
          const options = preparation();
          const unchanged = Object.keys(DEFAULT_SCAN_PREPARATION).every(key => options[key as keyof ScanPreparation] === DEFAULT_SCAN_PREPARATION[key as keyof ScanPreparation]);
          const result = await recognizePages(bytes, { indices, languages: selectedLanguages, mode: 'searchable', ...(unchanged ? {} : { preparation: options, preview: showPreview }) }, abort.signal, (done, total) => {
            if (alive) status.textContent = `${t('Rozpoznáno stránek')}: ${done}/${total}`;
          });
          resultText = result.pages.map(page => page.text).join('\n\n');
          abort.signal.throwIfAborted(); return result.pdfBytes;
        } finally { signal.removeEventListener('abort', linkedAbort); }
      }, snapshot.revision, abort.signal);
      if (alive) { proposal = undefined; apply.disabled = true; recognized.value = resultText; status.textContent = t('OCR dokončeno. Zkontrolujte rozpoznaný text.'); }
    } catch {
      if (alive) status.textContent = abort.signal.aborted ? t('OCR zrušeno. Dokument se nezměnil.') : t('OCR se nezdařilo. Dokument se nezměnil. Zkontrolujte rozsah a lokální aktiva.');
    } finally {
      controller = undefined;
      if (alive) { controls.disabled = false; cancel.disabled = true; body.removeAttribute('aria-busy'); }
    }
  }
  return () => { alive = false; controller?.abort(); };
}
