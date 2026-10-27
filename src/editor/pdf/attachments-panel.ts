import { panelButton, panelCloseGuard, type StandardPdfToolsApi } from './standard-tools';
import { editAttachments, exportAttachment, listAttachments, type AttachmentChange } from './attachments';

export function mountAttachmentsPanel(body: HTMLElement, api: StandardPdfToolsApi): () => void {
  const t = api.t ?? (value => value), guard = panelCloseGuard(body);
  let disposed = false, busy = false;
  const content = document.createElement('div'), alert = document.createElement('p'); alert.setAttribute('role', 'alert'); body.append(content, alert);
  const failure = () => { if (!disposed) alert.textContent = t('Operace se nezdařila.'); };
  const render = async () => {
    const snapshot = await api.readPdfSnapshot(); if (disposed) return;
    const files = await listAttachments(snapshot.bytes); if (disposed) return;
    content.replaceChildren();
    if (!files.length) { const empty = document.createElement('p'); empty.textContent = t('Žádné přílohy'); content.append(empty); }
    const list = document.createElement('ul');
    const mutate = async (change: AttachmentChange) => {
      if (busy) return; busy = true; guard.setBusy(true); alert.textContent = '';
      for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = true;
      try { await api.runPdfOperation('Přílohy PDF', bytes => editAttachments(bytes, change), snapshot.revision); await render(); }
      catch { failure(); }
      finally { busy = false; guard.setBusy(false); if (!disposed) for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = false; }
    };
    for (const file of files) {
      const item = document.createElement('li'), name = document.createElement('span'); name.textContent = file.filename;
      const save = panelButton('Exportovat přílohu', () => { if (busy) return; busy = true; guard.setBusy(true);
        void exportAttachment(snapshot.bytes, file.id).then(result => {
          if (disposed) return;
          const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: result.mimeType }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }).catch(failure).finally(() => { busy = false; guard.setBusy(false); });
      }, t);
      const remove = panelButton('Odstranit přílohu', () => { void mutate({ kind: 'remove', id: file.id }); }, t);
      item.append(name, save, remove); list.append(item);
    }
    content.append(list);
    const label = document.createElement('label'), caption = document.createElement('span'), input = document.createElement('input');
    caption.textContent = t('Importovat přílohu'); input.type = 'file';
    input.addEventListener('change', () => { const file = input.files?.[0]; if (!file || busy || disposed) return;
      if (file.size > 20 * 1024 * 1024) { failure(); return; }
      busy = true; guard.setBusy(true);
      for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = true;
      void file.arrayBuffer().then(data => {
        if (disposed) return;
        busy = false; guard.setBusy(false);
        return mutate({ kind: 'import', filename: file.name, bytes: new Uint8Array(data), mimeType: file.type || undefined });
      }).catch(failure).finally(() => {
        if (busy && !disposed) { busy = false; guard.setBusy(false); for (const control of content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = false; }
      });
    }); label.append(caption, input); content.append(label);
  };
  void render().catch(failure);
  return () => { disposed = true; guard.dispose(); };
}
