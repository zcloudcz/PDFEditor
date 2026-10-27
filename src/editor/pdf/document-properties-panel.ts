import { panelButton, panelCloseGuard, type StandardPdfToolsApi } from './standard-tools';
import { editDocumentProperties, readDocumentProperties, type DocumentPropertiesChange, type PdfDocumentProperties } from './document-properties';

export function mountDocumentPropertiesPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const t = api.t ?? (value => value), guard = panelCloseGuard(body);
  let disposed = false, busy = false;
  const content = document.createElement('div'), alert = document.createElement('p'); alert.setAttribute('role', 'alert'); body.append(content, alert);
  const render = async () => {
    const snapshot = await api.readPdfSnapshot(); if (disposed) return;
    const value = await readDocumentProperties(snapshot.bytes); if (disposed) return;
    content.replaceChildren();
    const fields = {} as Record<keyof PdfDocumentProperties, HTMLInputElement | HTMLTextAreaElement>;
    const labels: Array<[keyof PdfDocumentProperties, string]> = [['title','Název'],['author','Autor'],['subject','Předmět'],['keywords','Klíčová slova'],['creator','Tvůrce'],['producer','Producent'],['xmp','XMP metadata']];
    for (const [field, title] of labels) {
      const label = document.createElement('label'), caption = document.createElement('span'); caption.textContent = t(title);
      const input = field === 'xmp' ? document.createElement('textarea') : document.createElement('input');
      input.value = value[field] ?? ''; input.maxLength = field === 'xmp' ? 1024 * 1024 : 10000;
      fields[field] = input; label.append(caption, input); content.append(label);
    }
    const save = panelButton('Uložit vlastnosti', () => { if (busy) return; busy = true; guard.setBusy(true); alert.textContent = '';
      const changes: DocumentPropertiesChange = {
        title: fields.title.value, author: fields.author.value, subject: fields.subject.value,
        keywords: fields.keywords.value, creator: fields.creator.value, producer: fields.producer.value,
      };
      if (fields.xmp.value !== (value.xmp ?? '')) changes.xmp = fields.xmp.value || null;
      for (const control of content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button')) control.disabled = true;
      void api.runPdfOperation('Vlastnosti PDF', bytes => editDocumentProperties(bytes, changes), snapshot.revision)
        .then(() => render())
        .catch(() => { if (!disposed) alert.textContent = t('Operace se nezdařila.'); })
        .finally(() => { busy = false; guard.setBusy(false); if (!disposed) for (const control of content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button')) control.disabled = false; });
    }, t);
    content.append(save);
  };
  void render().catch(() => { if (!disposed) alert.textContent = t('Operace se nezdařila.'); });
  return () => { disposed = true; guard.dispose(); };
}
