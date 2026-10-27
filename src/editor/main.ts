import { setUIText, t, setupLocalization } from './i18n';
import { setupToolbarIcons } from './toolbar-icons';
import { setupNativeContextToolbar } from './context-toolbar';
import '@phosphor-icons/web/regular';
import { loadFallbackFonts } from '../js/utils/font-loader';
import markup from './editor-markup.html?raw';
import '../css/edit-pdf-text.css';
import './shell.css';
import { PRODUCT_NAME } from './brand';
import { setupDocumentControls, type DocumentLaunchOptions } from './document-controls';
import { prepareDocument, replaceDocumentSafely } from '../editor-safety/open-document';
import { setupStudio } from './studio/host';
import { setupStandardPdfTools } from './pdf/standard-tools';
import { setupOcrTool } from './pdf/ocr-panel';
import { setupPdfUtilities } from './pdf/utility-panel';
import { setupComparisonTools } from './pdf/compare-tools';
import { setupStructureTools } from './pdf/structure-tools';
import { setupLayoutTools } from './studio/layout-tools';
import { setupMaskTool } from './studio/mask-editor';
import { setupRedactionTools } from './pdf/redaction-tools';
import { setupAccessibilityTools } from './pdf/accessibility-panel';
import { setupAdvancedObjectsTools } from './pdf/advanced-objects-panel';
import { setupPrintTools } from './pdf/print-panel';
import { setupConversionTools } from './conversion/conversion-panel';
import { setupDataTools } from './data/data-tools';
import { exportPdf } from './studio/exports';

document.title = PRODUCT_NAME;
const root = document.getElementById('editor-root')!;
root.innerHTML = `
  <header class="product-header"><strong id="product-name"></strong><span><span data-ui-text="Lokální náhled">Lokální náhled </span><a href="https://github.com/alam00000/bentopdf/blob/main/LICENSE" target="_blank" rel="noopener noreferrer"><span data-ui-text="Licence">Licence</span></a></span></header>
  <main id="uploader" class="welcome">
    <section id="drop-zone" aria-labelledby="welcome-title">
      <div class="paper-mark" aria-hidden="true"><span>PDF</span><i></i><i></i><i></i></div>
      <h1 id="welcome-title"><span data-ui-text="Váš dokument.">Váš dokument.</span><br><span data-ui-text="Vaše úpravy.">Vaše úpravy.</span></h1>
      <p><span data-ui-text="Otevřete PDF, klikněte na text a upravte ho přímo na stránce. Výsledek stáhnete jako novou kopii.">Otevřete PDF, klikněte na text a upravte ho přímo na stránce. Výsledek stáhnete jako novou kopii.</span></p>
      <div class="welcome-actions"><button id="open-document" class="primary"><span data-ui-text="Otevřít PDF">Otevřít PDF</span></button><button id="open-sample"><span data-ui-text="Vyzkoušet ukázku">Vyzkoušet ukázku</span></button></div>
      <input id="file-input" type="file" accept="application/pdf,.pdf" hidden />
      <p class="privacy"><span data-ui-text="Soubor zůstává v tomto prohlížeči. Můžete ho také přetáhnout sem.">Soubor zůstává v tomto prohlížeči. Můžete ho také přetáhnout sem.</span></p>
      <p id="shell-status" role="status" aria-live="polite"></p>
    </section>
    <aside class="welcome-guide"><h2><span data-ui-text="Od textu k hotovému PDF">Od textu k hotovému PDF</span></h2><ol><li><span data-ui-text="Otevřete dokument nebo ukázku.">Otevřete dokument nebo ukázku.</span></li><li><span data-ui-text="Kliknutím vyberte text. Dvojklikem ho přepište.">Kliknutím vyberte text. Dvojklikem ho přepište.</span></li><li><span data-ui-text="Klikněte mimo text a zvolte Exportovat kopii.">Klikněte mimo text a zvolte Exportovat kopii.</span></li></ol></aside>
  </main>
  <footer class="product-footer"><span data-ui-text="Otevřený software">Otevřený software </span><a href="https://github.com/alam00000/bentopdf/blob/main/LICENSE" target="_blank" rel="noopener noreferrer"><span data-ui-text="Licence a původní projekt">Licence a původní projekt</span></a></footer>
  ${markup}`;
document.getElementById('product-name')!.textContent = PRODUCT_NAME;

let app: typeof import('../js/editcore/app.js') | undefined;
let opening = false;
async function launchEditor(file: File, options?: DocumentLaunchOptions) {
  if (opening) return false;
  opening = true;
  const status = document.getElementById('shell-status')!;
  setUIText(status, () => t('Otevírám dokument…'));
  try {
    app ??= await import('../js/editcore/app.js');
    if (!(await app.engineReady)) throw new Error(t('Engine unavailable'));
    const { PdfEngine } = await import('../js/editcore/core.js');
    if (!(await loadFallbackFonts(PdfEngine.fallbackFonts, ['eng', 'ces']))) {
      throw new Error(t('Local fallback font unavailable'));
    }
    app.setOpenRequestHandler(launchEditor);
    app.setConfirmPlaintextExport(() => window.confirm(t('Tento dokument byl chráněn heslem. Exportovaná kopie nebude zašifrovaná a půjde otevřít bez hesla. Chcete stáhnout nechráněnou kopii?')));
    const opened = await replaceDocumentSafely({
      prepare: async () => prepareDocument(new Uint8Array(await file.arrayBuffer()), {
        createEngine: () => PdfEngine.create(),
        requestPassword: async ({ incorrect }) => window.prompt(incorrect ? t('Nesprávné heslo. Zadejte heslo k PDF znovu:') : t('Zadejte heslo k PDF:')),
      }),
      // Internal document transactions already captured both editable layers.
      isDirty: () => !options?.checkpointed && app!.hasUnsavedChanges(),
      confirmDiscard: () => window.confirm(t('Otevřením jiného dokumentu ztratíte neexportované úpravy. Pokračovat?')),
      commit: async prepared => {
        try {
          if (!window.dispatchEvent(new Event('editor:before-document-open', { cancelable: true }))) return false;
          return await app!.openFile(file, null, prepared.bytes, prepared.password, prepared.encrypted || options?.protectedSource === true);
        }
        finally { prepared.password = undefined; }
      },
    });
    if (!opened) { status.textContent = ''; return false; }
    document.getElementById('text-editor-app')!.removeAttribute('hidden');
    document.getElementById('uploader')!.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('editor:document-opened', { detail: { createdDesign: options?.createdDesign } }));
    app.setOnSaved(() => {
      const toast = document.getElementById('toast')!;
      setUIText(toast, () => t('Upravená kopie byla připravena ke stažení.'));
      toast.hidden = false;
      window.setTimeout(() => { toast.hidden = true; }, 4000);
    });
    status.textContent = '';
    return true;
  } catch {
    setUIText(status, () => t('Dokument se nepodařilo otevřít. Zkontrolujte, že jde o platný soubor PDF.'));
    if (!document.getElementById('text-editor-app')!.hidden) {
      window.alert(status.textContent);
    }
    return false;
  } finally { opening = false; }
}

const fileInput = document.getElementById('file-input') as HTMLInputElement;
setupDocumentControls(() => app, launchEditor);
const studio = setupStudio(() => app, launchEditor);
const readMergedPdfSnapshot = async () => {
  const snapshot = await studio.readProjectSnapshot();
  return { bytes: await exportPdf(snapshot.project), revision: snapshot.revision };
};
setupStandardPdfTools({ ...studio, t });
setupStructureTools({ ...studio, t });
setupLayoutTools({ ...studio, t });
setupMaskTool({ ...studio, t });
setupRedactionTools({ ...studio, t });
setupOcrTool({ ...studio, t });
setupPdfUtilities({ ...studio, t });
setupComparisonTools({ ...studio, t, readComparisonSnapshot: readMergedPdfSnapshot });
setupAccessibilityTools({ ...studio, t });
setupAdvancedObjectsTools({ ...studio, t });
setupPrintTools({ ...studio, t, readPdfSnapshot: readMergedPdfSnapshot });
setupConversionTools({ ...studio, t });
setupDataTools({ ...studio, t });
setupNativeContextToolbar();
setupToolbarIcons();
setupLocalization();
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void launchEditor(fileInput.files[0]); fileInput.value = ''; });
const drop = document.getElementById('drop-zone')!;
drop.addEventListener('dragover', (event) => { event.preventDefault(); });
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void launchEditor(file);
});
document.getElementById('exitEditor')!.addEventListener('click', () => {
  if (window.confirm(t('Zavřít dokument? Neexportované úpravy se ztratí.'))) window.location.reload();
});
document.getElementById('toggleInspector')!.addEventListener('click', () => {
  document.getElementById('inspector')!.classList.toggle('collapsed');
});
// These controls belong to the upstream marketing host, not the native app.
for (const id of ['zoomMenuBtn', 'docInfoBtn', 'vbCollapse', 'vbRestore', 'pageInput', 'pageTotal']) {
  document.getElementById(id)?.setAttribute('hidden', '');
}
document.querySelector('.editcaret')?.remove();

for (const id of ['undo', 'redo']) document.getElementById(id)?.removeAttribute('hidden');
for (const el of document.querySelectorAll<HTMLElement>('button[title]')) {
  el.setAttribute('aria-label', el.title);
  el.dataset.uiAriaLabel = el.dataset.uiTitle || el.title;
}
document.getElementById('save')!.dataset.uiAriaLabel = 'Exportovat kopii';
document.getElementById('open-document')!.addEventListener('click', () => document.getElementById('file-input')!.click());

const sampleButton = document.getElementById('open-sample') as HTMLButtonElement;
sampleButton.addEventListener('click', async () => {
  sampleButton.disabled = true;
  const status = document.getElementById('shell-status')!;
  setUIText(status, () => t('Připravuji ukázkový dokument…'));
  try {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    page.drawText('Your document, your words.', { x: 60, y: 735, size: 25, font, color: rgb(0.13, 0.19, 0.28) });
    page.drawText('Double-click this sentence to edit existing PDF text.', { x: 60, y: 675, size: 15, font });
    page.drawText('Change a few words, then export a new copy.', { x: 60, y: 645, size: 15, font });
    page.drawText('This sample was created locally in your browser.', { x: 60, y: 90, size: 11, font });
    const second = pdf.addPage([595, 842]);
    second.drawText('A second page to explore.', { x: 60, y: 735, size: 25, font });
    second.drawText('Use the page controls below to move between pages.', { x: 60, y: 675, size: 15, font });
    const bytes = await pdf.save();
    await launchEditor(new File([new Uint8Array(bytes)], 'ukazka.pdf', { type: 'application/pdf' }));
  } catch {
    setUIText(status, () => t('Ukázku se nepodařilo otevřít. Obnovte stránku a zkuste to znovu.'));
  } finally { sampleButton.disabled = false; }
});
