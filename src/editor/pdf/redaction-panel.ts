import { getDocument } from 'pdfjs-dist';
import type { RedactionMark } from './redaction';
import { pickPdfPlacement } from './placement';
import { panelButton, panelCloseGuard, type StandardPdfToolsApi } from './standard-tools';

export interface RedactionToolsApi extends Pick<StandardPdfToolsApi, 'readPdfSnapshot' | 'getPageSurface' | 'mountDocumentPanel' | 'registerDocumentAction' | 't'> {
  applyRedactions(marks: readonly RedactionMark[], revision: number, confirmed: boolean, signal?: AbortSignal): Promise<void>;
}
export function mountRedactionPanel(body: HTMLElement, api: RedactionToolsApi, close: () => void): () => void {
  const t = api.t ?? (value => value), abort = new AbortController();
  let picking = false;
  const explanation = document.createElement('p');
  explanation.textContent = t('Označení je pouze náhled. Použít redakci nevratně odstraní obsah, komentáře, přílohy a metadata; vymaže historii i obnovu aktuálního dokumentu. Grafické objekty a nepodporované PDF budou odmítnuty.');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const choose = panelButton('Označit oblast na stránce', () => { void pick(); }, t);
  body.append(explanation, choose, status);
  async function pick() {
    if (picking || !api.getPageSurface) return;
    picking = true; choose.disabled = true;
    try {
      const snapshot = await api.readPdfSnapshot();
      if (abort.signal.aborted) return;
      // Placement runs on the same native page; the marking overlay never edits PDF.
      close();
      const mark = await pickPdfPlacement(snapshot.bytes, api.getPageSurface, 'rectangle', undefined, t('Označte oblast redakce. Escape zruší označení.'));
      if (!mark) return;
      api.mountDocumentPanel('Náhled redakce', (next, done) => mountRedactionPreview(next, api, snapshot, mark, done));
    } catch { status.textContent = t('Náhled redakce se nepodařilo připravit. Dokument se nezměnil.'); }
    finally { picking = false; choose.disabled = false; }
  }
  return () => abort.abort();
}

export function mountRedactionPreview(body: HTMLElement, api: RedactionToolsApi, snapshot: { bytes: Uint8Array; revision: number }, mark: RedactionMark, close: () => void): () => void {
  const t = api.t ?? (value => value), abort = new AbortController(), guard = panelCloseGuard(body);
  const revision = snapshot.revision;
  let ready = false, busy = false;
  const loading = getDocument({ data: snapshot.bytes.slice(), isEvalSupported: false });
  snapshot = { bytes: new Uint8Array(), revision };
  const canvas = document.createElement('canvas'); canvas.style.maxWidth = '100%'; canvas.setAttribute('aria-label', t('Náhled označené oblasti redakce'));
  const label = document.createElement('label'), consent = document.createElement('input'); consent.type = 'checkbox';
  label.append(consent, document.createTextNode(t('Rozumím, že obsah i historie a obnova budou nevratně odstraněny.')));
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const apply = panelButton('Použít redakci', () => { void commit(); }, t); apply.disabled = true;
  consent.addEventListener('change', () => { apply.disabled = !ready || !consent.checked || busy; });
  body.append(canvas, label, apply, status);
  void (async () => {
    try {
      const doc = await loading.promise, page = await doc.getPage(mark.pageIndex + 1);
      const unit = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.5, 900 / Math.max(unit.width, unit.height)) });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d'); if (!context) throw new Error('Preview unavailable');
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      if (abort.signal.aborted) return;
      const [x, y, w, h] = mark.rect;
      const a = viewport.convertToViewportPoint(x, y), b = viewport.convertToViewportPoint(x + w, y + h);
      context.fillStyle = 'rgba(220, 38, 38, 0.35)'; context.strokeStyle = '#dc2626'; context.lineWidth = 2;
      context.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      context.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ready = true; apply.disabled = !consent.checked;
    } catch { if (!abort.signal.aborted) status.textContent = t('Náhled redakce se nepodařilo připravit. Dokument se nezměnil.'); }
  })();
  async function commit() {
    if (!ready || busy || !consent.checked) return;
    busy = true; guard.setBusy(true); apply.disabled = true; consent.disabled = true;
    try {
      // Destroy the preview's document and pixels before the host purges owners.
      await loading.destroy(); canvas.width = canvas.height = 0;
      await api.applyRedactions([mark], revision, true, abort.signal);
      close();
    } catch (error) {
      status.textContent = t(error && typeof error === 'object' && 'code' in error && error.code === 'purge-incomplete'
        ? 'Odstranění starých kopií není dokončeno. Výsledek nelze potvrdit jako vyčištěný.'
        : 'Redakce byla odmítnuta. Dokument může obsahovat nepodporovanou strukturu nebo jinou uloženou obnovu.');
      ready = false;
    } finally { busy = false; guard.setBusy(false); }
  }
  return () => { abort.abort(); guard.dispose(); canvas.width = canvas.height = 0; void loading.destroy(); };
}
