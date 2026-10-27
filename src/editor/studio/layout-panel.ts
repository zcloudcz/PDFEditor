import { setUIText, t } from '../i18n';
import type { StudioProject } from './types';
import { distributeSelection, insertReusableBlock, previewDesignResize, type LayoutAnchor, type LayoutRule, type LocalGuide } from './layout-rules';
import { loadPersonalTemplates } from './personal-templates';

export interface LayoutPanelHost {
  getProject(): StudioProject;
  getView(): { pageId: string; selectedIds: string[] };
  /** Host records one undoable transaction, then restores the view. */
  apply(project: StudioProject, view: { pageId: string; selectedIds: string[] }): void | Promise<void>;
  /** Optional canvas adapter. Guides remain transient and are never serialized. */
  setGuides?(pageId: string, guides: readonly LocalGuide[]): void;
  getGuides?(pageId: string): readonly LocalGuide[];
}

export function mountLayoutPanel(body: HTMLElement, host: LayoutPanelHost): () => void {
  const pageId = host.getView().pageId;
  const page = host.getProject().pages.find(item => item.id === pageId);
  if (!page) throw new Error(t('Page not found.'));
  const form = document.createElement('form');
  form.className = 'studio-layout-panel';
  const caption = (text: string) => { const span = document.createElement('span'); setUIText(span, () => t(text)); return span; };
  const number = (name: string, value: number, min: number, max: number) => {
    const label = document.createElement('label'); label.append(caption(name));
    const input = document.createElement('input'); input.type = 'number'; input.value = String(value);
    input.min = String(min); input.max = String(max); input.step = 'any'; input.required = true;
    label.append(input); form.append(label); return input;
  };
  const width = number('Šířka (pt)', page.width, 1, 14400);
  const height = number('Výška (pt)', page.height, 1, 14400);
  const select = (name: string) => {
    const label = document.createElement('label'); label.append(caption(name));
    const input = document.createElement('select');
    for (const [value, text] of [
      ['start', 'Začátek'], ['center', 'Střed'], ['end', 'Konec'], ['stretch', 'Roztáhnout'],
    ] as const) { const option = document.createElement('option'); option.value = value; setUIText(option, () => t(text)); input.append(option); }
    label.append(input); form.append(label); return input;
  };
  const horizontal = select('Vodorovné ukotvení');
  const vertical = select('Svislé ukotvení');
  const selectedObject = page.objects.find(object => host.getView().selectedIds.includes(object.id));
  horizontal.value = selectedObject?.layoutAnchors?.horizontal ?? 'start';
  vertical.value = selectedObject?.layoutAnchors?.vertical ?? 'start';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const preview = document.createElement('div'); preview.className = 'studio-layout-preview';
  const buttons = document.createElement('div');
  let disposed = false;
  let busy = false;
  let guides: LocalGuide[] = [...(host.getGuides?.(pageId) ?? [])];
  let proposed: StudioProject | null = null;
  const selectedRules = (): LayoutRule[] => {
    const selected = new Set(host.getView().selectedIds);
    const currentPage = host.getProject().pages.find(item => item.id === pageId);
    return (currentPage?.objects ?? []).filter(object => selected.has(object.id) && !object.locked)
      .map(object => ({ objectId: object.id, horizontal: horizontal.value as LayoutAnchor, vertical: vertical.value as LayoutAnchor }));
  };
  const calculate = () => {
    proposed = null; preview.replaceChildren(); error.textContent = '';
    try {
      if (!width.reportValidity() || !height.reportValidity()) return;
      const result = previewDesignResize(host.getProject(), pageId,
        { width: Number(width.value), height: Number(height.value) }, selectedRules());
      proposed = result.project;
      setUIText(status, () => t('Náhled změny formátu'));
      const list = document.createElement('ul');
      for (const id of result.changedObjectIds) {
        const object = result.project.pages.find(item => item.id === pageId)?.objects.find(item => item.id === id);
        if (!object) continue;
        const item = document.createElement('li');
        item.textContent = `${object.name}: ${object.x.toFixed(1)}, ${object.y.toFixed(1)} · ${object.width.toFixed(1)} × ${object.height.toFixed(1)} pt`;
        list.append(item);
      }
      preview.append(list);
      const resized = result.project.pages.find(item => item.id === pageId)!;
      const ns = 'http://www.w3.org/2000/svg';
      const drawing = document.createElementNS(ns, 'svg');
      drawing.setAttribute('viewBox', `0 0 ${resized.width} ${resized.height}`);
      drawing.setAttribute('role', 'img'); drawing.setAttribute('aria-label', t('Náhled hranic objektů'));
      drawing.style.cssText = 'width:100%;max-height:240px;background:white;border:1px solid #64748b';
      for (const object of resized.objects) {
        const rect = document.createElementNS(ns, 'rect');
        for (const [key, value] of Object.entries({ x: object.x, y: object.y, width: object.width, height: object.height,
          fill: 'none', stroke: '#2563eb', 'stroke-width': Math.max(resized.width, resized.height) / 250,
          transform: `rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})` })) rect.setAttribute(key, String(value));
        drawing.append(rect);
      }
      preview.prepend(drawing);
    } catch (caught) { error.textContent = caught instanceof Error ? caught.message : String(caught); }
  };
  const button = (name: string, action: () => void | Promise<void>) => {
    const element = document.createElement('button'); element.type = 'button'; setUIText(element, () => t(name));
    element.addEventListener('click', () => {
      if (disposed || busy) return;
      busy = true; error.textContent = '';
      void Promise.resolve().then(action).catch(caught => { if (!disposed) error.textContent = caught instanceof Error ? caught.message : String(caught); })
        .finally(() => { busy = false; });
    });
    buttons.append(element); return element;
  };
  button('Zobrazit náhled', calculate);
  button('Použít formát', async () => {
    calculate(); if (!proposed) return;
    await host.apply(proposed, host.getView());
  });
  for (const [axis, name] of [['horizontal', 'Rozmístit vodorovně'], ['vertical', 'Rozmístit svisle']] as const) {
    button(name, async () => {
      const view = host.getView();
      await host.apply(distributeSelection(host.getProject(), pageId, view.selectedIds, axis), view);
    });
  }
  const guideAxis = document.createElement('select');
  for (const [value, name] of [['x', 'Svislé vodítko'], ['y', 'Vodorovné vodítko']] as const) {
    const option = document.createElement('option'); option.value = value; setUIText(option, () => t(name)); guideAxis.append(option);
  }
  const guidePosition = number('Poloha vodítka (pt)', 0, 0, 14400);
  const guideList = document.createElement('ul');
  const guideLabel = document.createElement('label'); guideLabel.append(caption('Vodítka'), guideAxis); form.append(guideLabel);
  const renderGuides = () => {
    guideList.replaceChildren();
    guides.forEach((guide, index) => {
      const item = document.createElement('li'); item.textContent = `${guide.axis.toUpperCase()}: ${guide.position} pt `;
      const remove = document.createElement('button'); remove.type = 'button'; setUIText(remove, () => t('Smazat'));
      remove.addEventListener('click', () => { guides = guides.filter((_, i) => i !== index); host.setGuides?.(pageId, guides); renderGuides(); });
      item.append(remove); guideList.append(item);
    });
  };
  button('Přidat vodítko', () => {
    if (!guidePosition.reportValidity()) return;
    const axis = guideAxis.value === 'x' ? 'x' : 'y'; const position = Number(guidePosition.value);
    const currentPage = host.getProject().pages.find(item => item.id === pageId)!;
    if (guides.length >= 100 || position > (axis === 'x' ? currentPage.width : currentPage.height)) throw new Error(t('Guide extends beyond the design.'));
    guides = [...guides, { axis, position }]; host.setGuides?.(pageId, guides); renderGuides();
  });
  button('Smazat vodítka', () => { guides = []; host.setGuides?.(pageId, guides); renderGuides(); });
  renderGuides();
  const blocks = document.createElement('select'); blocks.setAttribute('aria-label', t('Znovupoužitelný blok'));
  try {
    for (const template of loadPersonalTemplates().filter(item => item.pages.length === 1 && item.pages[0].objects.length)) {
      const option = document.createElement('option'); option.value = template.id; option.textContent = template.name; blocks.append(option);
    }
  } catch { error.textContent = t('Operace se nezdařila.'); }
  form.append(caption('Znovupoužitelný blok'), blocks);
  const reuse = button('Vložit blok ze šablony', async () => {
    const template = loadPersonalTemplates().find(item => item.id === blocks.value);
    if (!template) return;
    await host.apply(insertReusableBlock(host.getProject(), pageId, template), host.getView());
  });
  reuse.disabled = !blocks.options.length;
  form.addEventListener('submit', event => event.preventDefault());
  form.append(status, preview, error, buttons, guideList); body.append(form);
  if (page.sourcePageIndex !== undefined) error.textContent = t('PDF-backed page resize requires an explicit PDF geometry transform.');
  return () => { disposed = true; };
}

