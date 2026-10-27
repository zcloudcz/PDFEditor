import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupToolbarIcons } from './toolbar-icons';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); document.body.replaceChildren(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('toolbar icons', () => {
  it('covers shared and graphics toolbars mounted outside the editor root', async () => {
    document.body.innerHTML = '<div id="editor-root"><div id="toolbar"></div></div><header id="document-toolbar"><button id="studio-export">Export</button></header>';
    cleanup = setupToolbarIcons();
    document.body.insertAdjacentHTML('beforeend', '<section id="graphic-studio"><div class="studio-toolbar"><button data-toolbar-action="fit">Fit</button></div></section>');
    await flush();
    expect(document.querySelector('#studio-export .ph-export')).not.toBeNull();
    expect(document.querySelector('#graphic-studio .ph-corners-out')).not.toBeNull();
  });

  it('preserves translated labels, native icons, accessibility and click handlers', () => {
    document.body.innerHTML = '<div id="editor-root"><header id="document-toolbar"><button id="studio-export" aria-label="Exportar">Exportar</button></header><div id="toolbar"><button id="undo" title="Undo"><i class="ph ph-arrow-u-up-left"></i></button></div></div>';
    const button = document.getElementById('studio-export')!;
    const click = vi.fn(); button.addEventListener('click', click);
    cleanup = setupToolbarIcons();
    expect(button.textContent).toBe('Exportar');
    expect(button.getAttribute('aria-label')).toBe('Exportar');
    expect(button.querySelector('.ph-export')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelectorAll('#undo i')).toHaveLength(1);
    expect(document.querySelector('#undo i')?.getAttribute('aria-hidden')).toBe('true');
    button.click(); expect(click).toHaveBeenCalledOnce();
  });

  it('restores icons after localization and dynamically rendered graphics toolbar changes', async () => {
    document.body.innerHTML = '<div id="editor-root"><header id="document-toolbar"><button id="studio-save">Uložit</button></header></div>';
    cleanup = setupToolbarIcons();
    const save = document.getElementById('studio-save')!;
    save.textContent = 'Speichern';
    document.getElementById('editor-root')!.insertAdjacentHTML('beforeend', '<div class="studio-toolbar"><button data-toolbar-action="undo">Zurück</button></div>');
    await flush();
    expect(save.querySelectorAll('.ph')).toHaveLength(1);
    expect(save.textContent).toBe('Speichern');
    expect(document.querySelector('.studio-toolbar .ph-arrow-u-up-left')).not.toBeNull();
    await flush();
    expect(save.querySelectorAll('.ph')).toHaveLength(1);
  });

  it('does not decorate document content or continue observing after disposal', async () => {
    document.body.innerHTML = '<div id="editor-root"><div id="toolbar"><button id="new-document">New</button></div><article><button data-toolbar-action="undo">User content</button></article></div>';
    cleanup = setupToolbarIcons();
    expect(document.querySelector('article .ph')).toBeNull();
    cleanup();
    document.getElementById('new-document')!.textContent = 'New document';
    await flush();
    expect(document.querySelector('#new-document .ph')).toBeNull();
  });
});
