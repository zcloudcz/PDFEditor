import './toolbar-icons.css';

const toolbarSelector = '#document-toolbar, #toolbar, .studio-toolbar, #viewbar';
const iconsById: Readonly<Record<string, string>> = {
  'document-navigation': 'bookmarks',
  'document-undo': 'arrow-u-up-left',
  'document-redo': 'arrow-u-up-right',
  'studio-templates': 'squares-four',
  'studio-brand': 'palette',
  'studio-import-pdf': 'file-plus',
  'studio-pages': 'files',
  'native-pages': 'files',
  'studio-open': 'folder-open',
  'studio-save': 'floppy-disk',
  'studio-export': 'export',
  'studio-close': 'pencil-simple',
  'open-graphic-tools': 'shapes',
  'new-document': 'file-plus',
  'add-blank-page': 'plus-square',
};
const iconsByAction: Readonly<Record<string, string>> = {
  undo: 'arrow-u-up-left',
  redo: 'arrow-u-up-right',
  'zoom-out': 'magnifying-glass-minus',
  fit: 'corners-out',
  'zoom-in': 'magnifying-glass-plus',
};
const iconsByFit: Readonly<Record<string, string>> = {
  page: 'corners-out',
  width: 'arrows-horizontal',
  height: 'arrows-vertical',
};

/** Add decorative icons without replacing labels, handlers or localized names. */
export function setupToolbarIcons(root: HTMLElement = document.body): () => void {
  const decorate = (toolbar: Element) => {
    for (const button of toolbar.querySelectorAll<HTMLElement>('button, label.btn')) {
      const name = iconsById[button.id] ?? iconsByAction[button.dataset.toolbarAction ?? ''] ?? iconsByFit[button.dataset.fit ?? ''];
      let icon = button.querySelector<HTMLElement>(':scope > .ph');
      if (!icon && name) {
        icon = document.createElement('i');
        icon.className = `ph ph-${name} toolbar-button-icon`;
        button.prepend(icon);
      }
      for (const existing of button.querySelectorAll<HTMLElement>(':scope > .ph')) {
        if (existing.getAttribute('aria-hidden') !== 'true') existing.setAttribute('aria-hidden', 'true');
      }
      if (icon) button.classList.add('toolbar-button-with-icon');
    }
  };
  const discover = (node: Element) => {
    if (node.matches(toolbarSelector)) decorate(node);
    node.querySelectorAll(toolbarSelector).forEach(decorate);
  };
  discover(root);
  // Toolbars can be created later, and graphics/history or language changes can
  // replace their buttons. Restrict decoration to toolbar scopes, never labels
  // in the user's document. Our own inserted icons require no second mutation.
  const observer = new MutationObserver(records => {
    const changed = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const toolbar = target?.closest(toolbarSelector);
      if (toolbar) changed.add(toolbar);
      else for (const added of record.addedNodes) if (added instanceof Element) discover(added);
    }
    changed.forEach(decorate);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
