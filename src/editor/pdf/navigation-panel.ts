import { setUIText, t } from '../i18n';
import { PdfNavigationError, type PdfNavigation, type PdfBookmark, type NavigationChange } from './navigation';

/** Navigation controls display document strings as text and never execute document actions. */
export function mountNavigationPanel(
  host: HTMLElement,
  initial: PdfNavigation,
  pageCount: number,
  activePage: number,
  run: (change: NavigationChange) => Promise<PdfNavigation>,
): () => void {
  let navigation = initial, busy = false, disposed = false;
  const panel = document.createElement('div'); panel.className = 'studio-page-manager pdf-navigation-panel';
  const alert = document.createElement('p'); alert.setAttribute('role', 'alert');
  const content = document.createElement('div'); panel.append(content, alert); host.append(panel);
  const dialog = host.closest('dialog');
  const closeButton = dialog?.querySelector<HTMLButtonElement>(':scope > button');
  const preventClose = (event: Event) => { if (busy) event.preventDefault(); };
  dialog?.addEventListener('cancel', preventClose);
  const caption = (element: HTMLElement, message: string) => setUIText(element, () => t(message));
  const label = (message: string, control: HTMLElement) => {
    const element = document.createElement('label'), span = document.createElement('span');
    caption(span, message); element.append(span, control); return element;
  };
  const pageInput = (value: number) => {
    const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = String(pageCount);
    input.step = '1'; input.required = true; input.value = String(Math.max(0, Math.min(pageCount - 1, value)) + 1); return input;
  };
  const titleInput = (value = '') => {
    const input = document.createElement('input'); input.type = 'text'; input.required = true; input.maxLength = 10000; input.value = value; return input;
  };
  const execute = async (change: NavigationChange) => {
    if (busy || disposed) return;
    busy = true; alert.textContent = '';
    if (closeButton) closeButton.disabled = true;
    for (const control of panel.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')) control.disabled = true;
    try { navigation = await run(change); if (!disposed) render(); }
    catch (error) {
      if (!disposed) caption(alert, error instanceof PdfNavigationError && error.code === 'unsupported-structure'
        ? 'Operace se nezdařila.' : error instanceof Error && !(error instanceof PdfNavigationError) ? error.message : 'Operace se nezdařila.');
    } finally {
      busy = false;
      if (closeButton) closeButton.disabled = false;
      if (!disposed) for (const control of panel.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')) control.disabled = false;
    }
  };
  const button = (message: string, action: string, callback: () => void) => {
    const control = document.createElement('button'); control.type = 'button'; control.dataset.navigationAction = action;
    caption(control, message); control.onclick = callback; return control;
  };
  function render() {
    content.replaceChildren();
    const heading = document.createElement('h3'); caption(heading, 'Záložky'); content.append(heading);
    const parent = document.createElement('select'); parent.name = 'parentBookmark';
    parent.append(new Option('—', ''));
    const tree = (items: PdfBookmark[], depth = 0): HTMLOListElement => {
      const list = document.createElement('ol');
      for (const bookmark of items) {
        parent.append(new Option(`${'· '.repeat(depth)}${bookmark.title}`, bookmark.id));
        const item = document.createElement('li'); item.dataset.bookmarkId = bookmark.id;
        const title = titleInput(bookmark.title);
        const target = document.createElement('p');
        if (bookmark.destination) target.textContent = `${t('Stránka')} ${bookmark.destination.pageIndex + 1}`;
        else target.textContent = bookmark.uri ?? '—';
        item.append(label('Název', title), target,
          button('Přejmenovat', 'rename-bookmark', () => { if (title.reportValidity() && title.value.trim()) void execute({ kind: 'rename-bookmark', id: bookmark.id, title: title.value }); }),
          button('Smazat', 'remove-bookmark', () => void execute({ kind: 'remove-bookmark', id: bookmark.id })));
        if (bookmark.children.length) item.append(tree(bookmark.children, depth + 1));
        list.append(item);
      }
      return list;
    };
    content.append(tree(navigation.bookmarks));
    const addForm = document.createElement('form'); addForm.dataset.navigationForm = 'add-bookmark';
    const title = titleInput(), page = pageInput(activePage);
    const add = document.createElement('button'); add.type = 'submit'; caption(add, 'Přidat záložku');
    addForm.append(label('Název', title), label('Cílová stránka', page), label('Nadřazená záložka', parent), add);
    addForm.onsubmit = event => { event.preventDefault(); if (addForm.reportValidity() && title.value.trim()) void execute({ kind: 'add-bookmark', title: title.value, pageIndex: Number(page.value) - 1, ...(parent.value ? { parentId: parent.value } : {}) }); };
    content.append(addForm);
    const linksHeading = document.createElement('h3'); caption(linksHeading, 'Odkazy'); content.append(linksHeading);
    const links = document.createElement('ol');
    for (const link of navigation.links) {
      const item = document.createElement('li'); item.dataset.linkId = link.id;
      const origin = document.createElement('p'); origin.textContent = `${t('Stránka')} ${link.pageIndex + 1}`;
      const uri = document.createElement('p'); uri.textContent = link.uri ?? '';
      const target = pageInput(link.destination?.pageIndex ?? activePage);
      item.append(origin, uri, label('Cílová stránka', target),
        button('Cílová stránka', 'set-link-destination', () => { if (target.reportValidity()) void execute({ kind: 'set-link-destination', id: link.id, pageIndex: Number(target.value) - 1 }); }),
        button('Smazat', 'remove-link', () => void execute({ kind: 'remove-link', id: link.id })));
      links.append(item);
    }
    content.append(links);
  }
  render();
  return () => { disposed = true; dialog?.removeEventListener('cancel', preventClose); panel.remove(); };
}
