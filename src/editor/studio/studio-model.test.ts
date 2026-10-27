import { describe, expect, it, vi } from 'vitest';
import { mountStudioCanvas } from './canvas';
import { setLocale, t } from '../i18n';
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import {
  ProjectHistory,
  duplicatePage,
  movePage,
  duplicateElements,
  alignElements,
} from './model';
import type { StudioObject, StudioProject } from './types';

const project = (): StudioProject => ({
  version: 1,
  name: 'Test',
  pages: [
    {
      id: 'p1',
      width: 600,
      height: 800,
      name: 'Page',
      background: '#ffffff',
      objects: [],
    },
    {
      id: 'p2',
      width: 600,
      height: 800,
      name: 'Page',
      background: '#ffffff',
      objects: [],
    },
  ],
});

describe('studio document history', () => {
  it('keeps inserted placeholder text exportable and preserves document data across UI languages', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const container = document.createElement('div');
    document.body.append(container);
    await setLocale('zh');
    const controller = mountStudioCanvas(container, project(), vi.fn());
    try {
      Array.from(container.querySelectorAll('button')).find(button => button.textContent === t('T  Text'))!.click();
      const snapshot = controller.getProject();
      const font = fontkit.create(readFileSync('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'));
      for (const character of snapshot.pages[0].objects[0].text!) {
        expect(font.glyphForCodePoint(character.codePointAt(0)!).id).not.toBe(0);
      }
      await setLocale('ar');
      expect(controller.getProject()).toEqual(snapshot);
    } finally {
      controller.destroy(); container.remove(); vi.unstubAllGlobals(); await setLocale('cs');
    }
  });
  it('restores page structure and independent snapshots through undo and redo', () => {
    const history = new ProjectHistory(project());
    const next = project();
    next.pages.pop();
    history.push(next);
    next.name = 'external mutation';
    expect(history.undo()?.pages).toHaveLength(2);
    expect(history.redo()?.name).toBe('Test');
  });
  it('invalidates redo on a new edit', () => {
    const history = new ProjectHistory(project());
    history.push({ ...project(), name: 'Second' });
    history.undo();
    history.push({ ...project(), name: 'Third' });
    expect(history.redo()).toBeNull();
  });
  it('duplicates pages with fresh identity and preserves native page references', () => {
    const p = project();
    p.pages[0].sourcePageIndex = 3;
    const copy = duplicatePage(p, 'p1');
    expect(copy.pages).toHaveLength(3);
    expect(copy.pages[1].id).not.toBe('p1');
    expect(copy.pages[1].sourcePageIndex).toBe(3);
    expect(p.pages).toHaveLength(2);
    expect(movePage(copy, 'p1', 2).pages[2].id).toBe('p1');
  });
  it('duplicates groups without linking them to their originals', () => {
    const item: StudioObject = {
      id: 'a',
      kind: 'rect',
      name: 'A',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 1,
      locked: false,
      groupId: 'g',
    };
    const copies = duplicateElements([item, { ...item, id: 'b' }]);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe('g');
    expect(copies[0].id).not.toBe(item.id);
    expect(copies[0].x).toBe(26);
    expect(item.x).toBe(10);
  });
  it('aligns one item to the page, multiple items to their bounds and preserves locks', () => {
    const item: StudioObject = {
      id: 'a',
      kind: 'rect',
      name: 'A',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 1,
      locked: false,
    };
    const p = project().pages[0];
    p.objects = [
      item,
      { ...item, id: 'b', x: 200 },
      { ...item, id: 'c', x: 320, locked: true },
    ];
    expect(alignElements(p, ['a'], 'center').objects[0].x).toBe(250);
    const aligned = alignElements(p, ['a', 'b', 'c'], 'left');
    expect(aligned.objects.map((o) => o.x)).toEqual([10, 10, 320]);
    expect(p.objects[1].x).toBe(200);
  });
});

describe('studio UI document mutations', () => {
  it('invalidates native previews on history source changes and disables PDF background color', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const container = document.createElement('div');
    document.body.append(container);
    const first = project();
    first.sourcePdf = 'first';
    first.pages[0].sourcePageIndex = 0;
    const controller = mountStudioCanvas(container, first, () => {});
    expect(
      container.querySelector<HTMLInputElement>('input[type="color"]')?.disabled
    ).toBe(true);
    controller.setPageBackground('p1', 'data:image/png;base64,first');
    controller.setProject(
      { ...first, sourcePdf: 'second' },
      { recordHistory: true }
    );
    controller.setPageBackground('p1', 'data:image/png;base64,second');
    expect(
      container.querySelector('.studio-paper image')?.getAttribute('href')
    ).toContain('second');
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.dataset.toolbarAction === 'undo')!
      .click();
    expect(container.querySelector('.studio-paper image')).toBeNull();
    expect(controller.getProject().sourcePdf).toBe('first');
    controller.setPageBackground('p1', 'data:image/png;base64,first');
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.dataset.toolbarAction === 'redo')!
      .click();
    expect(container.querySelector('.studio-paper image')).toBeNull();
    controller.destroy();
    container.remove();
    vi.unstubAllGlobals();
  });
  it('keeps canvas focus after resize, accepts arbitrary imported IDs and rejects out-of-range fields', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const container = document.createElement('div');
    document.body.append(container);
    const controller = mountStudioCanvas(container, project(), () => {});
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === '□  Obdélník')!
      .click();
    const edited = controller.getProject();
    edited.pages[0].objects[0].id = 'quote"[test]';
    controller.setProject(edited);
    const object = container.querySelector<SVGGElement>('[data-object]')!;
    let drawing = container.querySelector<SVGSVGElement>('.studio-paper')!;
    drawing.setPointerCapture = () => {};
    const down = new MouseEvent('pointerdown', {
      clientX: 10,
      clientY: 10,
      bubbles: true,
    });
    Object.defineProperty(down, 'target', { value: object });
    drawing.onpointerdown!(down as PointerEvent);
    drawing.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    drawing = container.querySelector<SVGSVGElement>('.studio-paper')!;
    expect(document.activeElement).toBe(drawing);
    drawing.setPointerCapture = () => {};
    const handle = drawing.querySelector('[data-resize]')!;
    const resize = new MouseEvent('pointerdown', { clientX: 10, clientY: 10 });
    Object.defineProperty(resize, 'target', { value: handle });
    drawing.onpointerdown!(resize as PointerEvent);
    drawing.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 20, clientY: 20 })
    );
    drawing.dispatchEvent(new MouseEvent('pointerup'));
    expect(controller.getProject().pages[0].objects[0].width).toBeGreaterThan(
      160
    );
    expect(document.activeElement).toBe(
      container.querySelector('.studio-paper')
    );
    const x = Array.from(container.querySelectorAll('label'))
      .find((l) => l.firstChild?.textContent === 'X')!
      .querySelector('input')!;
    x.value = '100001';
    x.dispatchEvent(new Event('change'));
    expect(controller.getProject().pages[0].objects[0].x).toBeLessThan(100001);
    controller.destroy();
    container.remove();
    vi.unstubAllGlobals();
  });
  it('inserts, edits, duplicates and undoes through the public controller', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const container = document.createElement('div');
    document.body.append(container);
    const changed = vi.fn();
    const controller = mountStudioCanvas(container, project(), changed);
    const click = (text: string) => {
      const node = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === text
      );
      expect(node).toBeTruthy();
      node!.click();
    };
    click('T  Text');
    expect(controller.getProject().pages[0].objects[0].kind).toBe('text');
    const textarea = container.querySelector('textarea')!;
    textarea.focus();
    textarea.value = 'Příliš žluťoučký kůň';
    textarea.dispatchEvent(new Event('input'));
    expect(container.querySelector('.studio-paper text')?.textContent).toBe(
      'Příliš žluťoučký kůň'
    );
    expect(document.activeElement).toBe(textarea);
    textarea.blur();
    expect(controller.getProject().pages[0].objects[0].text).toBe(
      'Příliš žluťoučký kůň'
    );
    click('Zpět');
    expect(controller.getProject().pages[0].objects[0].text).toBe('Your text');
    click('Znovu');
    const layer = container.querySelector<HTMLButtonElement>(
      '.studio-layer button'
    )!;
    layer.click();
    expect(document.activeElement).toBe(
      container.querySelector('.studio-paper')
    );
    click('Duplikovat');
    expect(controller.getProject().pages[0].objects).toHaveLength(2);
    click('Zpět');
    expect(controller.getProject().pages[0].objects).toHaveLength(1);
    click('Kopie stránky');
    expect(controller.getProject().pages).toHaveLength(3);
    click('Zpět');
    expect(controller.getProject().pages).toHaveLength(2);
    controller.setProject(
      { ...controller.getProject(), name: 'Renamed' },
      { recordHistory: true }
    );
    click('Zpět');
    expect(controller.getProject().name).toBe('Test');
    click('Znovu');
    expect(controller.getProject().name).toBe('Renamed');
    expect(changed).toHaveBeenCalled();
    controller.destroy();
    expect(container.children).toHaveLength(0);
    container.remove();
    vi.unstubAllGlobals();
  });
});
