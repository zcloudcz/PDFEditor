import { describe, expect, it, vi } from 'vitest';
import { mountLayoutPanel } from './layout-panel';
import type { StudioProject } from './types';

const project = (): StudioProject => ({ version: 1, name: 'Design', pages: [{
  id: 'page', name: 'Page', width: 200, height: 100, background: '#ffffff', objects: [
    { id: 'rect', name: 'Rectangle', kind: 'rect', x: 10, y: 10, width: 20, height: 20,
      rotation: 0, opacity: 1, fill: '#ffffff', stroke: '#000000', strokeWidth: 0, locked: false },
  ],
}] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('layout panel', () => {
  it('previews without commit and applies an undoable host change with selection', async () => {
    const body = document.createElement('div'); const input = project(); const apply = vi.fn();
    const dispose = mountLayoutPanel(body, { getProject: () => input, getView: () => ({ pageId: 'page', selectedIds: ['rect'] }), apply });
    const fields = body.querySelectorAll<HTMLInputElement>('input[type="number"]');
    fields[0].value = '300';
    body.querySelectorAll('select')[0].value = 'end';
    const buttons = [...body.querySelectorAll('button')];
    buttons.find(button => button.textContent === 'Zobrazit náhled')!.click(); await flush();
    expect(apply).not.toHaveBeenCalled();
    expect(body.textContent).toContain('Rectangle: 110.0');
    buttons.find(button => button.textContent === 'Použít formát')!.click(); await flush();
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ pages: [expect.objectContaining({ width: 300 })] }),
      { pageId: 'page', selectedIds: ['rect'] });
    expect(input.pages[0].width).toBe(200); dispose();
  });

  it('keeps guides available for canvas dragging after the modal closes, and clears only explicitly', async () => {
    const body = document.createElement('div'); const setGuides = vi.fn();
    const dispose = mountLayoutPanel(body, { getProject: project, getView: () => ({ pageId: 'page', selectedIds: [] }), apply: vi.fn(), setGuides });
    const guidePosition = body.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]; guidePosition.value = '40';
    [...body.querySelectorAll('button')].find(button => button.textContent === 'Přidat vodítko')!.click(); await flush();
    expect(setGuides).toHaveBeenCalledWith('page', [{ axis: 'x', position: 40 }]);
    dispose(); expect(setGuides).toHaveBeenLastCalledWith('page', [{ axis: 'x', position: 40 }]);
    const next = document.createElement('div');
    mountLayoutPanel(next, { getProject: project, getView: () => ({ pageId: 'page', selectedIds: [] }), apply: vi.fn(), setGuides, getGuides: () => [{ axis: 'x', position: 40 }] });
    expect(next.textContent).toContain('X: 40 pt');
    [...next.querySelectorAll('button')].find(button => button.textContent === 'Smazat vodítka')!.click(); await flush();
    expect(setGuides).toHaveBeenLastCalledWith('page', []);
  });
});
