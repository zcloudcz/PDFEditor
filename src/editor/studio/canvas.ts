import { setUIText, t } from '../i18n';
import type {
  StudioController,
  StudioObject,
  StudioObjectKind,
  StudioPage,
  StudioProject,
  StudioHistoryDelegate,
  StudioNativeSurface,
} from './types';
import {
  alignElements,
  clone,
  duplicateElements,
  duplicatePage,
  HEART_PATH,
  movePage,
  ProjectHistory,
  STAR_PATH,
  uid,
} from './model';
import './canvas.css';
import { createInlineTextEditor, type InlineTextEditor } from './inline-text-editor';
import { getTextRuns, layoutText, prepareTextFonts } from './text-layout';
import { glyphRunSvg } from '../typography/layout';
import { loadedFont } from '../typography/fonts';
import { textRunFamily, assertTextGlyphs } from './text-layout';
import { importEmbeddedImage } from './asset-library';
import { editedImageDataUrl } from './image-effects';
import { capturePersonalTemplate, findPersonalTemplates, insertPersonalTemplate, loadPersonalTemplates, savePersonalTemplate, deletePersonalTemplate } from './personal-templates';
import { applyBrandToSelection, exportBrandProfiles, importBrandProfiles, loadBrandProfiles, saveBrandProfile, deleteBrandProfile } from './brand-library';
import { loadBrandKit } from './brand-kit';
import { formatTextList } from './text-editor';

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}
function button(label: string, action: () => void, title = label) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.title = title;
  node.onclick = action;
  return node;
}
export function mountStudioCanvas(
  container: HTMLElement,
  initial: StudioProject,
  onChange: (project: StudioProject, committed?: boolean) => void,
  sharedHistory?: StudioHistoryDelegate,
): StudioController {
  let project = clone(initial),
    history = new ProjectHistory(project),
    active = project.pages[0].id;
  let selected = new Set<string>(),
    zoom = 1,
    fit = true,
    destroyed = false;
  const backgrounds = new Map<string, string>();
  const localGuides = new Map<string, readonly { axis: 'x' | 'y'; position: number }[]>();
  const imagePreviews = new Map<string, { src: string; key: string; promise: Promise<string> }>();
  const textFonts = new Map<string, { error?: unknown }>();
  const fontsReady = (object: StudioObject) => getTextRuns(object).every(run => loadedFont(textRunFamily(object, run)));
  function preparePreviewFonts(object: StudioObject) {
    const key = JSON.stringify([...new Set(getTextRuns(object).map(run => textRunFamily(object, run)))].sort());
    if (!textFonts.has(key)) {
      const state: { error?: unknown } = {};
      textFonts.set(key, state);
      void prepareTextFonts([object]).catch(error => { state.error = error; }).then(() => {
        if (destroyed) return;
        // Resolve against the current page/selection, never the object captured before loading.
        renderCanvas(); refreshTextValidation();
      });
    }
    return textFonts.get(key)!;
  }
  const pendingAssets = new Set<Promise<unknown>>();
  const trackAsset = <T,>(task: Promise<T>): Promise<T> => {
    pendingAssets.add(task);
    void task.then(() => pendingAssets.delete(task), () => pendingAssets.delete(task));
    return task;
  };
  let nativeSurface: StudioNativeSurface | undefined;
  const surfaceRoot = () => nativeSurface?.container ?? stage;
  let inline: InlineTextEditor | undefined;
  let inlineObject: StudioObject | undefined;
  let preserveOutsideTarget = false;
  container.classList.add('studio-editor');
  container.innerHTML = `<div class="studio-toolbar"></div><div class="studio-text-toolbar" role="toolbar"></div><aside class="studio-library"></aside><main class="studio-workspace"><div class="studio-page-heading"></div><div class="studio-stage"></div></main><aside class="studio-properties"></aside><footer class="studio-status"></footer>`;
  const toolbar = container.querySelector<HTMLElement>('.studio-toolbar')!;
  const textToolbar = container.querySelector<HTMLElement>('.studio-text-toolbar')!;
  const library = container.querySelector<HTMLElement>('.studio-library')!;
  const stage = container.querySelector<HTMLElement>('.studio-stage')!;
  const properties =
    container.querySelector<HTMLElement>('.studio-properties')!;
  const status = container.querySelector<HTMLElement>('.studio-status')!;
  const heading = container.querySelector<HTMLElement>('.studio-page-heading')!;
  const page = () =>
    project.pages.find((p) => p.id === active) || project.pages[0];
  const selection = () => page().objects.filter((o) => selected.has(o.id));
  const requestGraphicSelection = () => !nativeSurface || window.dispatchEvent(new CustomEvent('editor:graphic-selected', { cancelable: true }));
  function finishInline() {
    if (!inline) return;
    const editor = inline; inline = undefined; inlineObject = undefined; editor.destroy();
    surfaceRoot().querySelector('.studio-paper')?.setAttribute('role', 'img');
    history.push(project); onChange(clone(project), true);
    if (preserveOutsideTarget) {
      surfaceRoot().querySelector('[data-inline-editor]')?.remove();
      surfaceRoot().querySelectorAll('[data-object]').forEach(node => {
        const object = page().objects.find(item => item.id === node.getAttribute('data-object'));
        if (object) node.replaceWith(renderObject(object));
      });
      const textarea = properties.querySelector('textarea');
      if (textarea) textarea.value = selection()[0]?.text ?? '';
      const buttons = toolbar.querySelectorAll('button');
      if (buttons[0]) buttons[0].disabled = !(sharedHistory?.canUndo() ?? history.canUndo);
      if (buttons[1]) buttons[1].disabled = !(sharedHistory?.canRedo() ?? history.canRedo);
    } else {
      render(); surfaceRoot().querySelector<SVGSVGElement>('.studio-paper')?.focus();
    }
  }
  function startInline(object: StudioObject, selectAll = false, point?: { x: number; y: number }) {
    if (object.kind !== 'text' || object.locked) return;
    if (!requestGraphicSelection()) return;
    inline?.finish();
    selected = new Set([object.id]);
    render();
    const drawing = surfaceRoot().querySelector('.studio-paper');
    if (!drawing) return;
    drawing.setAttribute('role', 'group');
    inlineObject = object;
    inline = createInlineTextEditor(object, {
      label: t('Obsah textu'),
      change: () => onChange(clone(project), false),
      finish: finishInline,
      selectionChanged: () => {
        if (!inline) return;
        for (const style of ['bold', 'italic', 'underline'] as const) textToolbar.querySelector(`[data-text-style="${style}"]`)?.setAttribute('aria-pressed', String(inline.state(style)));
      },
    });
    inline.element.addEventListener('focusout', () => {
      const currentEditor = inline;
      queueMicrotask(() => {
        const focus = document.activeElement;
        if (!currentEditor || inline !== currentEditor || !focus || focus === document.body || currentEditor.element.contains(focus) || textToolbar.contains(focus)) return;
        preserveOutsideTarget = true; currentEditor.finish(); preserveOutsideTarget = false;
      });
    });
    const overlay = svg('foreignObject', {
      x: object.x, y: object.y, width: object.width, height: Math.max(object.height, layoutText(object).height),
      transform: `rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})`,
      'data-inline-editor': object.id,
    });
    overlay.style.overflow = 'visible'; overlay.append(inline.element);
    for (const group of drawing.querySelectorAll('[data-object]')) if (group.getAttribute('data-object') === object.id) group.setAttribute('visibility', 'hidden');
    drawing.append(overlay); inline.focus(selectAll); if (point) inline.focusAt(point.x, point.y); renderTextToolbar();
  }
  function toolbarPatch(patch: Partial<StudioObject>) {
    if (inlineObject && inline) {
      if (patch.fontSize !== undefined || patch.fill !== undefined) {
        if (inline.formatValues({ ...(patch.fontSize === undefined ? {} : { fontSize: patch.fontSize }), ...(patch.fill === undefined ? {} : { color: patch.fill }) })) return;
      }
      Object.assign(inlineObject, patch); inline.updateStyle(); onChange(clone(project), false); inline.focus();
    } else mutateSelected(patch);
  }
  function emphasis(key: 'bold' | 'italic' | 'underline') {
    if (inline) { inline.format(key); return; }
    const texts = selection().filter(o => o.kind === 'text' && !o.locked);
    const enabled = !texts.every(o => getTextRuns(o).every(run => !!run[key]));
    change(() => texts.forEach(o => {
      o.textRuns = getTextRuns(o).map(run => ({ ...run, [key]: enabled }));
      if (key === 'underline') o.underline = enabled;
    }));
  }
  function renderTextToolbar() {
    textToolbar.replaceChildren(); textToolbar.setAttribute('aria-label', t('Text'));
    const texts = selection().filter(o => o.kind === 'text');
    const object = inlineObject ?? texts[0];
    if (!object) { const hint = document.createElement('span'); setUIText(hint, () => t('Text')); textToolbar.append(hint); return; }
    const control = (label: string, action: () => void, active?: boolean) => {
      const node = button(label, action); node.setAttribute('aria-label', label);
      if (active !== undefined) node.setAttribute('aria-pressed', String(active));
      node.onmousedown = event => event.preventDefault(); textToolbar.append(node); return node;
    };
    control(t('Upravit text'), () => startInline(object, true));
    const family = document.createElement('span'); family.textContent = 'Liberation Sans'; textToolbar.append(family);
    const size = document.createElement('input'); size.type = 'number'; size.min = '4'; size.max = '500'; size.step = '1'; size.value = String(object.fontSize ?? 24); size.setAttribute('aria-label', t('Velikost písma'));
    size.onchange = () => { const value = Number(size.value); if (Number.isFinite(value) && value >= 4 && value <= 500) toolbarPatch({ fontSize: value }); };
    textToolbar.append(size);
    for (const [key, glyph, label] of [['bold', 'B', 'Tučné'], ['italic', 'I', 'Kurzíva'], ['underline', 'U', 'Podtržení']] as const) {
      const states = texts.flatMap(o => getTextRuns(o).map(run => !!run[key]));
      const node = control(t(label), () => emphasis(key)); node.textContent = glyph;
      node.setAttribute('aria-pressed', states.every(Boolean) ? 'true' : states.some(Boolean) ? 'mixed' : 'false');
      node.dataset.textStyle = key;
    }
    const color = document.createElement('input'); color.type = 'color'; color.value = object.fill === 'none' ? '#000000' : object.fill; color.setAttribute('aria-label', t('Color')); color.onchange = () => toolbarPatch({ fill: color.value }); textToolbar.append(color);
    const align = document.createElement('select'); align.setAttribute('aria-label', t('Alignment'));
    for (const [value, label] of [['left', 'Text vlevo'], ['center', 'Text na střed'], ['right', 'Text vpravo']] as const) { const option = document.createElement('option'); option.value = value; option.textContent = t(label); align.append(option); }
    align.value = object.textAlign ?? 'left'; align.onchange = () => { if (align.value === 'left' || align.value === 'center' || align.value === 'right') toolbarPatch({ textAlign: align.value }); }; textToolbar.append(align);
    const vertical = document.createElement('select'); vertical.setAttribute('aria-label', t('Svislé zarovnání textu'));
    for (const [value, label] of [['top', 'Text nahoře'], ['middle', 'Text uprostřed'], ['bottom', 'Text dole']] as const) { const option = document.createElement('option'); option.value = value; option.textContent = t(label); vertical.append(option); }
    vertical.value = object.verticalAlign ?? 'top'; vertical.onchange = () => { if (vertical.value === 'top' || vertical.value === 'middle' || vertical.value === 'bottom') toolbarPatch({ verticalAlign: vertical.value }); }; textToolbar.append(vertical);
    const spacing = document.createElement('input'); spacing.type = 'number'; spacing.min = '0.5'; spacing.max = '5'; spacing.step = '0.1'; spacing.value = String(object.lineHeight ?? 1.2); spacing.setAttribute('aria-label', t('Line Spacing')); spacing.onchange = () => { const value = Number(spacing.value); if (Number.isFinite(value) && value >= .5 && value <= 5) toolbarPatch({ lineHeight: value }); }; textToolbar.append(spacing);
    const wrap = control(t('Zalamovat text'), () => {
      toolbarPatch({ wrapText: !object.wrapText }); wrap.setAttribute('aria-pressed', String(object.wrapText ?? false));
    }, object.wrapText ?? false);
    if (texts.every(o => o.locked)) for (const item of textToolbar.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')) item.disabled = true;
  }
  const outsideInline = (event: PointerEvent) => {
    if (!inline || !(event.target instanceof Node)) return;
    if (inline.element.contains(event.target) || textToolbar.contains(event.target)) return;
    preserveOutsideTarget = true;
    inline.finish();
    preserveOutsideTarget = false;
  };
  document.addEventListener('pointerdown', outsideInline, true);
  function commit() {
    for (const p of project.pages) {
      p.name = p.name.slice(0, 300);
      for (const o of p.objects) {
        o.name = o.name.slice(0, 300);
        if (o.text) o.text = o.text.slice(0, 100000);
        o.x = Math.max(-100000, Math.min(100000, o.x));
        o.y = Math.max(-100000, Math.min(100000, o.y));
        o.width = Math.max(0.01, Math.min(14400, o.width));
        o.height = Math.max(0.01, Math.min(14400, o.height));
      }
    }
    history.push(project);
    onChange(clone(project), true);
    render();
  }
  function change(action: () => void) {
    if (!requestGraphicSelection()) return;
    action();
    commit();
  }
  function changeStructure(prepare: (before: StudioProject) => { project: StudioProject; pageId?: string }) {
    if (sharedHistory?.structuralChange) { sharedHistory.structuralChange(prepare); return; }
    change(() => {
      const next = prepare(clone(project));
      project = next.project; active = next.pageId ?? active; selected.clear();
    });
  }
  function restore(next: StudioProject | null) {
    if (!next) return;
    if (project.sourcePdf !== next.sourcePdf) backgrounds.clear();
    project = next;
    if (!project.pages.some((p) => p.id === active))
      active = project.pages[0].id;
    selected.clear();
    onChange(clone(project), true);
    render();
  }
  function selectObject(o: StudioObject, additive = false) {
    if (!additive && !selected.has(o.id)) selected.clear();
    const ids = o.groupId
      ? page()
          .objects.filter((item) => item.groupId === o.groupId)
          .map((item) => item.id)
      : [o.id];
    if (additive && selected.has(o.id))
      ids.forEach((id) => selected.delete(id));
    else ids.forEach((id) => selected.add(id));
  }
  function mutateSelected(patch: Partial<StudioObject>) {
    change(() =>
      selection()
        .filter((o) => !o.locked)
        .forEach((o) => {
          if (o.kind === 'text' && o.textRuns && (patch.fontSize !== undefined || patch.fill !== undefined)) {
            o.textRuns = o.textRuns.map(run => ({ ...run, ...(patch.fontSize === undefined ? {} : { fontSize: patch.fontSize }), ...(patch.fill === undefined ? {} : { color: patch.fill }) }));
          }
          if (o.brandRoles) {
            if (patch.fill !== undefined) delete o.brandRoles.fill;
            if (patch.stroke !== undefined) delete o.brandRoles.stroke;
            if (patch.fontFamily !== undefined || patch.fontSize !== undefined) delete o.brandRoles.textStyle;
            if (!Object.keys(o.brandRoles).length) delete o.brandRoles;
          }
          Object.assign(o, patch);
        })
    );
  }
  function removeSelected() {
    change(() => {
      page().objects = page().objects.filter(
        (o) => !selected.has(o.id) || o.locked
      );
      selected.clear();
    });
  }
  function duplicateSelected() {
    change(() => {
      const copies = duplicateElements(selection().filter((o) => !o.locked));
      page().objects.push(...copies);
      selected = new Set(copies.map((o) => o.id));
    });
  }
  function insert(kind: StudioObjectKind, extra: Partial<StudioObject> = {}) {
    change(() => {
      const object: StudioObject = {
        id: uid(),
        kind,
        name: {
          rect: t('Obdélník'),
          ellipse: t('Elipsa'),
          line: t('Čára'),
          arrow: t('Šipka'),
          text: t('Text'),
          image: t('Obrázek'),
          path: t('Ikona'),
        }[kind],
        x: page().width * 0.2,
        y: page().height * 0.2,
        width: 160,
        height: 100,
        rotation: 0,
        opacity: 1,
        fill: '#7956d8',
        stroke: '#362560',
        strokeWidth: 0,
        locked: false,
        ...extra,
      };
      page().objects.push(object);
      selected = new Set([object.id]);
    });
  }
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp';
  imageInput.hidden = true;
  container.append(imageInput);
  let replaceImageId: string | undefined;
  imageInput.onchange = async () => {
    const file = imageInput.files?.[0];
    const target = replaceImageId; replaceImageId = undefined;
    imageInput.value = '';
    if (!file) return;
    try {
      const asset = await trackAsset(importEmbeddedImage(file, undefined, new AbortController().signal));
      if (destroyed) return;
      if (target) {
        change(() => {
          const current = page().objects.find(object => object.id === target && object.kind === 'image' && !object.locked);
          if (!current) return;
          current.src = asset.src;
          current.imageProvenance = asset.provenance;
          delete current.imageCutout;
        });
      } else insert('image', {
        src: asset.src,
        imageProvenance: asset.provenance,
        name: t('Obrázek'),
        width: Math.min(300, page().width * 0.6),
        height: Math.min(300, page().width * 0.6) * asset.height / asset.width,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });
    } catch { if (!destroyed) alert(t('Obrázek nelze načíst.')); }
  };
  function renderObject(o: StudioObject): SVGGElement {
    const group = svg('g', {
      transform: `translate(${o.x} ${o.y}) rotate(${o.rotation} ${o.width / 2} ${o.height / 2})`,
      opacity: o.kind === 'text' ? 1 : o.opacity,
      'data-object': o.id,
      cursor: o.locked ? 'not-allowed' : 'move',
    });
    const paint = {
      fill: o.fill,
      stroke: o.stroke,
      'stroke-width': o.strokeWidth,
    };
    if (o.kind === 'rect')
      group.append(svg('rect', { width: o.width, height: o.height, ...paint }));
    if (o.kind === 'ellipse')
      group.append(
        svg('ellipse', {
          cx: o.width / 2,
          cy: o.height / 2,
          rx: o.width / 2,
          ry: o.height / 2,
          ...paint,
        })
      );
    if (o.kind === 'line' || o.kind === 'arrow') {
      group.append(
        svg('line', {
          x1: 0,
          y1: 0,
          x2: o.width,
          y2: o.height,
          ...paint,
          'stroke-width': o.strokeWidth,
        })
      );
      if (o.kind === 'arrow') {
        const angle = Math.atan2(o.height, o.width),
          size = Math.max(8, o.strokeWidth * 4);
        group.append(
          svg('path', {
            d: `M${o.width - size * Math.cos(angle - 0.5)} ${o.height - size * Math.sin(angle - 0.5)} L${o.width} ${o.height} L${o.width - size * Math.cos(angle + 0.5)} ${o.height - size * Math.sin(angle + 0.5)}`,
            fill: 'none',
            stroke: o.stroke,
            'stroke-width': o.strokeWidth,
          })
        );
      }
    }
    if (o.kind === 'path')
      group.append(
        svg('path', {
          d: o.path || '',
          transform: `scale(${o.width / 100} ${o.height / 100})`,
          ...paint,
        })
      );
    if (o.kind === 'text') {
      const ready = fontsReady(o);
      if (ready) {
        const paths = svg('g', { role: 'img', 'aria-label': o.text ?? '' });
        paths.innerHTML = layoutText(o).lines.map(line => line.runs.map(run => glyphRunSvg(run, line.y, o)).join('')).join('');
        group.append(paths);
      } else {
      const text = svg('text', { 'xml:space': 'preserve' });
      text.style.whiteSpace = 'pre';
      for (const line of layoutText(o).lines) for (const run of line.runs) {
        const span = svg('tspan', { x: run.x, y: line.y, 'font-family': `${run.fontFamily}, Arial, sans-serif`, 'font-size': run.fontSize ?? o.fontSize ?? 24, fill: run.color ?? o.fill, 'text-decoration': run.underline ? 'underline' : 'none' });
        span.textContent = run.text; text.append(span);
      }
      group.append(text);
      preparePreviewFonts(o);
      }
    }
    if (o.kind === 'image' && o.src) {
      const image = svg('image', { width: o.width, height: o.height, preserveAspectRatio: 'none' });
      const crop = o.crop;
      const hasCrop = crop && (crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1);
      if (!hasCrop && !o.imageMask && !o.imageAdjustments && !o.imageCutout && (!o.imageFit || o.imageFit === 'stretch')) image.setAttribute('href', o.src);
      else {
        const key = JSON.stringify([o.width, o.height, o.crop, o.imageFit, o.imageMask, o.imageAdjustments, o.imageCutout]);
        let cached = imagePreviews.get(o.id);
        if (!cached || cached.src !== o.src || cached.key !== key) {
          cached = { src: o.src, key, promise: trackAsset(editedImageDataUrl(o)) };
          imagePreviews.set(o.id, cached);
          if (imagePreviews.size > 4) imagePreviews.delete(imagePreviews.keys().next().value!);
        }
        void cached.promise.then(data => { if (!destroyed && image.isConnected) image.setAttribute('href', data); })
          .catch(() => { if (!destroyed) setUIText(status, () => t('Obrázek nelze načíst.')); });
      }
      group.append(image);
    }
    group.append(
      svg('rect', {
        width: o.width,
        height: o.height,
        fill: 'transparent',
        stroke: 'none',
        'pointer-events': 'all',
      })
    );
    if (selected.has(o.id)) {
      group.append(
        svg('rect', {
          width: o.width,
          height: o.height,
          fill: 'none',
          stroke: '#2459c4',
          'stroke-width': 1.5 / zoom,
          'stroke-dasharray': o.locked ? '4 3' : 'none',
          'pointer-events': 'none',
          'data-selection-mark': 'true',
        })
      );
      if (!o.locked)
        group.append(
          svg('rect', {
            x: o.width - 5 / zoom,
            y: o.height - 5 / zoom,
            width: 10 / zoom,
            height: 10 / zoom,
            fill: '#fff',
            stroke: '#2459c4',
            'stroke-width': 1 / zoom,
            'data-resize': o.id,
            'data-selection-mark': 'true',
            cursor: 'nwse-resize',
          })
        );
    }
    return group;
  }
  function renderCanvas() {
    if (inline) return;
    const hadCanvasFocus =
      !!document.activeElement?.closest('.studio-paper') &&
      container.contains(document.activeElement);
    const p = page();
    surfaceRoot().querySelector('.studio-paper')?.remove();
    if (nativeSurface) zoom = nativeSurface.zoom;
    else if (fit)
      zoom = Math.min(
        1.5,
        Math.max(0.15, (stage.clientWidth - 70) / p.width),
        Math.max(0.15, (stage.clientHeight - 60) / p.height)
      );
    const drawing = svg('svg', {
      viewBox: `0 0 ${nativeSurface?.width ?? p.width} ${nativeSurface?.height ?? p.height}`,
      width: (nativeSurface?.width ?? p.width) * zoom,
      height: (nativeSurface?.height ?? p.height) * zoom,
      role: 'img',
      'aria-label': t('Canvas: {name}', { name: p.name }),
      tabindex: 0,
    });
    drawing.classList.add('studio-paper');
    drawing.style.background = nativeSurface ? 'transparent' : p.background;
    if (nativeSurface) drawing.classList.add('studio-native-overlay');
    const sourceSibling =
      p.sourcePageIndex === undefined
        ? undefined
        : project.pages.find(
            (candidate) =>
              candidate.sourcePageIndex === p.sourcePageIndex &&
              backgrounds.has(candidate.id)
          );
    const background =
      backgrounds.get(p.id) ||
      (sourceSibling && backgrounds.get(sourceSibling.id));
    if (background && !nativeSurface)
      drawing.append(
        svg('image', {
          href: background,
          width: p.width,
          height: p.height,
          preserveAspectRatio: 'none',
          'pointer-events': 'none',
        })
      );
    p.objects.forEach((o) => drawing.append(renderObject(o)));
    for (const guide of localGuides.get(p.id) ?? []) drawing.append(svg('line', {
      'data-local-guide': guide.axis, x1: guide.axis === 'x' ? guide.position : 0,
      y1: guide.axis === 'y' ? guide.position : 0, x2: guide.axis === 'x' ? guide.position : p.width,
      y2: guide.axis === 'y' ? guide.position : p.height, stroke: '#0891b2',
      'stroke-width': 1 / zoom, 'stroke-dasharray': '4 3', 'pointer-events': 'none',
    }));
    surfaceRoot().append(drawing);
    if (nativeSurface) drawing.addEventListener('mousedown', event => event.stopPropagation());
    if (hadCanvasFocus) drawing.focus();
    drawing.onpointerdown = (event) => {
      if (event.button !== 0) return;
      const target = event.target as Element,
        id = target.closest('[data-object]')?.getAttribute('data-object') ?? target.getAttribute('data-resize');
      const object = p.objects.find((o) => o.id === id);
      if (!object) {
        selected.clear();
        render();
        return;
      }
      if (nativeSurface) {
        event.stopPropagation();
        if (!requestGraphicSelection()) {
          event.preventDefault();
          return;
        }
      }
      selectObject(object, event.shiftKey);
      drawing.focus();
      renderProperties();
      renderLayers();
      renderTextToolbar();
      if (object.locked || !selected.has(object.id)) {
        renderCanvas();
        return;
      }
      const resize = target.hasAttribute('data-resize');
      const originals = clone(selection().filter((o) => !o.locked));
      const startX = event.clientX,
        startY = event.clientY,
        originX = object.x,
        originY = object.y;
      let moved = false;
      drawing.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 3 && !moved) return;
        moved = true;
        let dx = (e.clientX - startX) / zoom,
          dy = (e.clientY - startY) / zoom;
        if (!e.altKey && !resize) {
          dx = Math.round((originX + dx) / 5) * 5 - originX;
          dy = Math.round((originY + dy) / 5) * 5 - originY;
        }
        drawing
          .querySelectorAll('[data-guide]')
          .forEach((node) => node.remove());
        if (!e.altKey && !resize) {
          const original = originals.find((o) => o.id === object.id)!;
          const xs = [
            ...(localGuides.get(p.id) ?? []).filter(guide => guide.axis === 'x').map(guide => guide.position),
            0,
            p.width / 2,
            p.width,
            ...p.objects
              .filter((o) => !selected.has(o.id))
              .flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width]),
          ];
          const ys = [
            ...(localGuides.get(p.id) ?? []).filter(guide => guide.axis === 'y').map(guide => guide.position),
            0,
            p.height / 2,
            p.height,
            ...p.objects
              .filter((o) => !selected.has(o.id))
              .flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height]),
          ];
          for (const [axis, targets, points] of [
            [
              'x',
              xs,
              [
                original.x + dx,
                original.x + dx + original.width / 2,
                original.x + dx + original.width,
              ],
            ],
            [
              'y',
              ys,
              [
                original.y + dy,
                original.y + dy + original.height / 2,
                original.y + dy + original.height,
              ],
            ],
          ] as const) {
            let nearest: { target: number; delta: number } | undefined;
            for (const target of targets)
              for (const point of points)
                if (
                  Math.abs(target - point) < 4 / zoom &&
                  (!nearest ||
                    Math.abs(target - point) < Math.abs(nearest.delta))
                )
                  nearest = { target, delta: target - point };
            if (nearest) {
              if (axis === 'x') dx += nearest.delta;
              else dy += nearest.delta;
              drawing.append(
                svg('line', {
                  'data-guide': 'true',
                  x1: axis === 'x' ? nearest.target : 0,
                  y1: axis === 'y' ? nearest.target : 0,
                  x2: axis === 'x' ? nearest.target : p.width,
                  y2: axis === 'y' ? nearest.target : p.height,
                  stroke: '#ed568e',
                  'stroke-width': 1 / zoom,
                  'stroke-dasharray': '4 3',
                  'pointer-events': 'none',
                })
              );
            }
          }
        }
        originals.forEach((original) => {
          const current = p.objects.find((o) => o.id === original.id)!;
          if (resize) {
            const rad = (original.rotation * Math.PI) / 180;
            current.width = Math.max(
              8,
              original.width + dx * Math.cos(rad) + dy * Math.sin(rad)
            );
            current.height = Math.max(
              8,
              original.height - dx * Math.sin(rad) + dy * Math.cos(rad)
            );
          } else {
            if (e.altKey && current.kind === 'image') {
              const crop = original.crop ?? { x: 0, y: 0, width: 1, height: 1 };
              current.crop = {
                ...crop,
                x: Math.max(0, Math.min(1 - crop.width, crop.x - dx * crop.width / original.width)),
                y: Math.max(0, Math.min(1 - crop.height, crop.y - dy * crop.height / original.height)),
              };
            } else {
              current.x = original.x + dx;
              current.y = original.y + dy;
            }
          }
          const old = Array.from(
            drawing.querySelectorAll('[data-object]')
          ).find((node) => node.getAttribute('data-object') === current.id);
          old?.replaceWith(renderObject(current));
        });
      };
      const up = () => {
        drawing.removeEventListener('pointermove', move);
        drawing.removeEventListener('pointerup', up);
        drawing.removeEventListener('pointercancel', up);
        if (moved) commit();
        else {
          drawing.querySelectorAll('[data-selection-mark],[data-selection-overlay]').forEach(node => node.remove());
          for (const current of selection()) {
            const marker = svg('g', { 'data-selection-overlay': 'true', transform: `translate(${current.x} ${current.y}) rotate(${current.rotation} ${current.width / 2} ${current.height / 2})` });
            marker.append(svg('rect', { width: current.width, height: current.height, fill: 'none', stroke: '#2459c4', 'stroke-width': 1.5 / zoom, 'pointer-events': 'none' }));
            if (!current.locked) marker.append(svg('rect', { x: current.width - 5 / zoom, y: current.height - 5 / zoom, width: 10 / zoom, height: 10 / zoom, fill: '#fff', stroke: '#2459c4', 'data-resize': current.id, cursor: 'nwse-resize' }));
            drawing.append(marker);
          }
        }
      };
      drawing.addEventListener('pointermove', move);
      drawing.addEventListener('pointerup', up);
      drawing.addEventListener('pointercancel', up);
    };
    drawing.ondblclick = (event) => {
      const id = (event.target as Element)
        .closest('[data-object]')
        ?.getAttribute('data-object');
      const o = p.objects.find((o) => o.id === id) ?? (selected.size === 1 ? selection()[0] : undefined);
      if (o?.kind === 'text' && !o.locked) {
        startInline(o, false, { x: event.clientX, y: event.clientY });
      }
    };
    status.textContent = t('{current} / {total} pages · {width} × {height} pt · {zoom} % · Shift: multiple selection · Alt: no snapping', { current: project.pages.indexOf(p) + 1, total: project.pages.length, width: Math.round(p.width), height: Math.round(p.height), zoom: Math.round(zoom * 100) });
  }
  function field(
    label: string,
    value: string | number,
    type: string,
    update: (value: string) => void,
    options: { min?: number; max?: number; step?: number } = {}
  ) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    if (type === 'text') input.maxLength = 300;
    input.value = String(value);
    for (const [key, val] of Object.entries(options))
      input.setAttribute(key, String(val));
    let appliedValue = input.value;
    const applyValue = () => {
      if (input.value === appliedValue) return;
      if (
        type === 'number' &&
        (!Number.isFinite(input.valueAsNumber) || !input.checkValidity())
      ) {
        renderProperties();
        return;
      }
      appliedValue = input.value;
      update(appliedValue);
    };
    input.onchange = applyValue;
    input.onblur = applyValue;
    wrapper.append(input);
    return wrapper;
  }
  function refreshTextValidation() {
    const object = selection()[0];
    const warning = properties.querySelector<HTMLElement>('[data-text-validation]');
    if (!object || object.kind !== 'text' || warning?.dataset.textValidation !== object.id) return;
    let message = '';
    try {
      if (fontsReady(object)) assertTextGlyphs(object);
      else {
        const state = preparePreviewFonts(object);
        if (state.error) throw state.error;
      }
    } catch (error) { message = (error as Error).message; }
    warning.textContent = message; warning.hidden = !message;
  }
  function renderProperties() {
    properties.replaceChildren();
    const title = document.createElement('h3');
    setUIText(title, () => selected.size ? t('Vlastnosti výběru') : t('Stránka'));
    properties.append(title);
    const items = selection(),
      o = items[0];
    if (!o) {
      properties.append(
        field(t('Název'), page().name, 'text', (v) =>
          change(() => (page().name = v))
        ),
        field(t('Barva pozadí'), page().background, 'color', (v) =>
          change(() => (page().background = v))
        )
      );
      if (page().sourcePageIndex !== undefined) {
        const backgroundInput = properties.querySelector<HTMLInputElement>(
          'input[type="color"]'
        );
        if (backgroundInput) backgroundInput.disabled = true;
        const note = document.createElement('p');
        note.className = 'studio-help';
        setUIText(note, () => t('Pozadí je součástí původní stránky PDF a při exportu se zachová.'));
        properties.append(note);
      }
      const help = document.createElement('p');
      help.className = 'studio-help';
      setUIText(help, () => t('Vyberte prvek na plátně nebo vložte text, tvar či obrázek. Rozměry zadáváte v bodech PDF.'));
      properties.append(help);
      return;
    }
    properties.append(
      field(t('Název vrstvy'), o.name, 'text', (v) => change(() => (o.name = v)))
    );
    const lock = button(o.locked ? t('Odemknout') : t('Zamknout'), () =>
      change(() => {
        const locked = !o.locked;
        items.forEach((item) => (item.locked = locked));
      })
    );
    properties.append(lock);
    if (o.locked) return;
    const grid = document.createElement('div');
    grid.className = 'studio-property-grid';
    for (const [key, label, min, max] of [
      ['x', 'X', -100000, 100000],
      ['y', 'Y', -100000, 100000],
      ['width', t('Šířka'), 1, 10000],
      ['height', t('Výška'), 1, 10000],
      ['rotation', t('Otočení °'), -360, 360],
      ['opacity', t('Průhlednost'), 0, 1],
    ] as const)
      grid.append(
        field(
          label,
          Math.round(o[key] * 100) / 100,
          'number',
          (v) => mutateSelected({ [key]: Number(v) }),
          { min, max, step: key === 'opacity' ? 0.05 : 1 }
        )
      );
    properties.append(
      grid,
      field(t('Výplň'), o.fill === 'none' ? '#ffffff' : o.fill, 'color', (v) =>
        mutateSelected({ fill: v })
      ),
      button(t('Bez výplně'), () => mutateSelected({ fill: 'none' })),
      field(t('Obrys'), o.stroke === 'none' ? '#000000' : o.stroke, 'color', (v) =>
        mutateSelected({ stroke: v })
      ),
      field(
        t('Síla obrysu'),
        o.strokeWidth,
        'number',
        (v) => mutateSelected({ strokeWidth: Number(v) }),
        { min: 0, max: 100, step: 1 }
      )
    );
    const brandRolesTitle = document.createElement('h4');
    setUIText(brandRolesTitle, () => t('Role značky'));
    properties.append(brandRolesTitle);
    for (const role of ['primary', 'accent', 'paper'] as const) properties.append(
      button(t('Přiřadit barvu: {role}', { role: { primary: t('Hlavní'), accent: t('Doplňková'), paper: t('Podklad') }[role] }), () => change(() => selection().filter(item => !item.locked).forEach(item => {
        item.brandRoles = { ...item.brandRoles, fill: role };
      })))
    );
    properties.append(button(t('Zrušit role značky'), () => change(() => selection().filter(item => !item.locked).forEach(item => { delete item.brandRoles; }))));
    if (o.kind === 'text') for (const role of ['heading', 'body'] as const) properties.append(
      button(t('Přiřadit textový styl: {role}', { role: { heading: t('Nadpis'), body: t('Běžný text') }[role] }), () => change(() => selection().filter(item => item.kind === 'text' && !item.locked).forEach(item => {
        item.brandRoles = { ...item.brandRoles, textStyle: role };
      })))
    );
    if (o.kind === 'text') {
      const font = document.createElement('select');
      font.setAttribute('aria-label', t('Řez písma'));
      for (const [value, label] of [
        ['Liberation Sans', t('Normální')],
        ['Liberation Sans Bold', t('Tučné')],
        ['Liberation Sans Italic', t('Kurzíva')],
        ['Liberation Sans BoldItalic', `${t('Tučné')} + ${t('Kurzíva')}`],
        ['Noto Sans Arabic', 'Noto Sans Arabic'],
        ['Noto Sans Arabic Bold', 'Noto Sans Arabic Bold'],
        ['Noto Sans Devanagari', 'Noto Sans Devanagari'],
        ['Noto Sans Devanagari Bold', 'Noto Sans Devanagari Bold'],
        ['Noto Sans CJK JP', 'Noto Sans CJK JP'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        font.append(option);
      }
      font.value = o.fontFamily || 'Liberation Sans';
      font.onchange = () => change(() => selection().filter(item => item.kind === 'text' && !item.locked).forEach(item => {
        item.fontFamily = font.value;
        if (item.brandRoles) { delete item.brandRoles.textStyle; if (!Object.keys(item.brandRoles).length) delete item.brandRoles; }
        if (item.textRuns) item.textRuns = item.textRuns.map(run => ({ ...run, bold: font.value.includes('Bold'), italic: font.value.includes('Italic') }));
      }));
      properties.append(font);
      const direction = document.createElement('select');
      direction.setAttribute('aria-label', t('Směr textu'));
      for (const [value, label] of [['auto', t('Automaticky')], ['ltr', t('Zleva doprava')], ['rtl', t('Zprava doleva')]]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; direction.append(option);
      }
      direction.value = o.textDirection ?? 'auto';
      direction.onchange = () => change(() => { o.textDirection = direction.value as 'auto' | 'ltr' | 'rtl'; });
      const language = document.createElement('select'); language.setAttribute('aria-label', t('Jazyk textu'));
      for (const value of ['und', 'cs', 'en', 'ar', 'hi', 'ja']) { const option = document.createElement('option'); option.value = value; option.textContent = value; language.append(option); }
      language.value = o.textLanguage ?? 'und';
      language.onchange = () => change(() => { o.textLanguage = language.value as StudioObject['textLanguage']; });
      properties.append(direction, language);
      properties.append(
        button(t('Stín textu'), () => mutateSelected({ textShadow: { x: 3, y: 3, color: '#000000', opacity: 0.4 } })),
        button(t('Bez stínu'), () => mutateSelected({ textShadow: undefined })),
        button(t('Barevný přechod textu'), () => mutateSelected({ textGradient: { from: '#2563eb', to: '#db2777' } })),
        button(t('Bez přechodu'), () => mutateSelected({ textGradient: undefined })),
        button(t('Text na oblouku (SVG)'), () => mutateSelected({ textPath: { radius: Math.max(100, o.width) }, wrapText: false })),
        button(t('Rovný text'), () => mutateSelected({ textPath: undefined })),
      );
      if (o.textShadow) {
        const shadow = o.textShadow;
        for (const [key, label] of [['x', 'Posun stínu X (pt)'], ['y', 'Posun stínu Y (pt)']] as const) properties.append(field(t(label), shadow[key], 'number', value => mutateSelected({ textShadow: { ...shadow, [key]: Number(value) } }), { min: -500, max: 500 }));
        properties.append(field(t('Barva stínu'), shadow.color, 'color', value => mutateSelected({ textShadow: { ...shadow, color: value } })));
      }
      if (o.textGradient) {
        const gradient = o.textGradient;
        for (const [key, label] of [['from', 'Začátek přechodu'], ['to', 'Konec přechodu']] as const) properties.append(field(t(label), gradient[key], 'color', value => mutateSelected({ textGradient: { ...gradient, [key]: value } })));
      }
      if (o.textPath) properties.append(field(t('Poloměr oblouku (pt)'), o.textPath.radius, 'number', value => mutateSelected({ textPath: { radius: Number(value) } }), { min: 10, max: 10000 }));
      if (o.textPath) { const note = document.createElement('p'); setUIText(note, () => t('Text na oblouku lze exportovat jako vektorové SVG. PDF a PPTX tento profil nepodporují.')); properties.append(note); }
      properties.append(
        field(t('Mezery mezi odstavci (pt)'), o.paragraphSpacing ?? 0, 'number', value => mutateSelected({ paragraphSpacing: Number(value) }), { min: 0, max: 500 }),
        field(t('Prostrkání znaků (pt)'), o.tracking ?? 0, 'number', value => mutateSelected({ tracking: Number(value) }), { min: 0, max: 100, step: 0.1 }),
        ...(['bullet', 'number', 'none'] as const).map((kind, index) => button(t(['Odrážky', 'Číslovaný seznam', 'Bez seznamu'][index]), () => change(() => selection().forEach(item => formatTextList(item, kind))))),
      );
      const warning = document.createElement('p'); warning.setAttribute('role', 'status');
      warning.dataset.textValidation = o.id; properties.append(warning);
      refreshTextValidation();
      const text = document.createElement('textarea');
      text.maxLength = 100000;
      text.value = o.text || '';
      text.setAttribute('aria-label', t('Obsah textu'));
      text.rows = 4;
      let appliedText = text.value;
      text.onfocus = () => { if (o.textRuns) startInline(o, true); };
      const updateText = () => {
        if (o.textRuns) return;
        const value = text.value.slice(0, 100000);
        if (appliedText === value) return;
        appliedText = value;
        items
          .filter((item) => !item.locked && item.kind === 'text')
          .forEach((item) => { item.text = value; item.textRuns = undefined; });
        onChange(clone(project), false);
        renderCanvas();
      };
      const finishText = () => {
        updateText();
        history.push(project);
        onChange(clone(project), true);
        const historyButtons = toolbar.querySelectorAll('button');
        if (historyButtons[0]) historyButtons[0].disabled = !(sharedHistory?.canUndo() ?? history.canUndo);
        if (historyButtons[1]) historyButtons[1].disabled = !(sharedHistory?.canRedo() ?? history.canRedo);
      };
      text.oninput = updateText;
      text.onblur = finishText;
      text.onchange = finishText;
      properties.append(
        o.textRuns ? button(t('Upravit text'), () => startInline(o, true)) : text,
        field(
          t('Velikost písma'),
          o.fontSize || 24,
          'number',
          (v) => mutateSelected({ fontSize: Number(v) }),
          { min: 4, max: 500 }
        ),
        button(t('Text vlevo'), () => mutateSelected({ textAlign: 'left' })),
        button(t('Text na střed'), () => mutateSelected({ textAlign: 'center' })),
        button(t('Text vpravo'), () => mutateSelected({ textAlign: 'right' }))
      );
    }
    if (o.kind === 'image') {
      const mutateImages = (action: (image: StudioObject) => void) => change(() => items.filter(item => item.kind === 'image' && !item.locked).forEach(action));
      const subtitle = document.createElement('h4');
      setUIText(subtitle, () => t('Ořez obrázku (%)'));
      properties.append(subtitle);
      const crop = o.crop || { x: 0, y: 0, width: 1, height: 1 };
      for (const [key, label] of [
        ['x', 'Zleva'],
        ['y', 'Shora'],
        ['width', t('Šířka')],
        ['height', t('Výška')],
      ] as const)
        properties.append(
          field(
            label,
            Math.round(crop[key] * 100),
            'number',
            (v) => {
              const next = { ...crop, [key]: Number(v) / 100 };
              next.x = Math.min(next.x, 0.99);
              next.y = Math.min(next.y, 0.99);
              next.width = Math.max(0.01, Math.min(next.width, 1 - next.x));
              next.height = Math.max(0.01, Math.min(next.height, 1 - next.y));
              mutateImages(image => { image.crop = next; });
            },
            { min: key === 'width' || key === 'height' ? 1 : 0, max: 100 }
          )
        );
      properties.append(
        button(t('Roztáhnout'), () => mutateImages(image => { image.imageFit = 'stretch'; })),
        button(t('Přizpůsobit obrázek'), () => mutateImages(image => { image.imageFit = 'contain'; })),
        button(t('Vyplnit rámeček'), () => mutateImages(image => { image.imageFit = 'cover'; })),
        button(t('Kruhová maska'), () => mutateImages(image => { image.imageMask = { kind: 'circle' }; })),
        button(t('Zaoblená maska'), () => mutateImages(image => { image.imageMask = { kind: 'rounded', radius: 0.15 }; })),
        button(t('Bez masky'), () => mutateImages(image => { delete image.imageMask; })),
        field(t('Poloměr zaoblení (%)'), o.imageMask?.kind === 'rounded' ? o.imageMask.radius * 100 : 15, 'number',
          value => mutateImages(image => { image.imageMask = { kind: 'rounded', radius: Number(value) / 100 }; }), { min: 0, max: 50 }),
        ...([['brightness', t('Jas')], ['contrast', t('Kontrast')], ['saturation', t('Sytost')], ['blur', t('Rozmazání (px)')]] as const).map(([key, label]) =>
          field(label, key === 'blur' ? (o.imageAdjustments?.blur ?? 0) : Math.round((o.imageAdjustments?.[key] ?? 1) * 100), 'number',
            value => mutateImages(image => {
              const current = image.imageAdjustments ?? { brightness: 1, contrast: 1, saturation: 1, blur: 0 };
              image.imageAdjustments = { ...current, [key]: key === 'blur' ? Number(value) : Number(value) / 100 };
            }), { min: 0, max: key === 'blur' ? 20 : 200 })),
        button(t('Nahradit obrázek'), () => { replaceImageId = o.id; imageInput.click(); }),
        button(t('Obnovit úpravy obrázku'), () => mutateImages(image => {
          delete image.crop; delete image.imageFit; delete image.imageMask; delete image.imageAdjustments; delete image.imageCutout;
        }))
      );
    }
    const align = document.createElement('div');
    align.className = 'studio-property-grid';
    for (const [axis, label] of [
      ['left', t('Doleva')],
      ['center', t('Na střed')],
      ['right', t('Doprava')],
      ['top', t('Nahoru')],
      ['middle', t('Doprostřed')],
      ['bottom', t('Dolů')],
    ] as const)
      align.append(
        button(label, () =>
          change(() => {
            const index = project.pages.findIndex((p) => p.id === active);
            project.pages[index] = alignElements(page(), [...selected], axis);
          })
        )
      );
    properties.append(align);
    properties.append(
      button(t('Seskupit'), () =>
        change(() => {
          const groupId = uid();
          items.forEach((item) => (item.groupId = groupId));
        })
      ),
      button(t('Rozdělit skupinu'), () => mutateSelected({ groupId: undefined })),
      button(t('Duplikovat'), duplicateSelected),
      button(t('Smazat'), removeSelected)
    );
  }
  const layers = document.createElement('div');
  function renderLayers() {
    layers.replaceChildren();
    const title = document.createElement('h3');
    setUIText(title, () => t('Vrstvy'));
    layers.append(title);
    [...page().objects].reverse().forEach((o) => {
      const row = document.createElement('div');
      row.className =
        'studio-layer' + (selected.has(o.id) ? ' is-selected' : '');
      const pick = button(`${o.locked ? '🔒 ' : ''}${o.name}`, () => {
        if (!requestGraphicSelection()) return;
        selected.clear();
        selectObject(o);
        render();
        surfaceRoot().querySelector<SVGSVGElement>('.studio-paper')?.focus();
      });
      row.append(
        pick,
        button(
          '↑',
          () =>
            change(() => {
              const list = page().objects,
                index = list.indexOf(o);
              if (index < list.length - 1)
                [list[index], list[index + 1]] = [list[index + 1], list[index]];
            }),
          t('O vrstvu výš')
        ),
        button(
          '↓',
          () =>
            change(() => {
              const list = page().objects,
                index = list.indexOf(o);
              if (index > 0)
                [list[index], list[index - 1]] = [list[index - 1], list[index]];
            }),
          t('O vrstvu níž')
        )
      );
      layers.append(row);
    });
  }
  let templateSearch = '';
  let templateFavoritesOnly = false;
  function renderLibrary() {
    library.replaceChildren();
    const title = document.createElement('h3');
    setUIText(title, () => t('Vytvořit'));
    library.append(title);
    const inserts = document.createElement('div');
    inserts.className = 'studio-inserts';
    inserts.append(
      button(t('T  Text'), () =>
        insert('text', {
          name: t('Text'),
          // Document content uses characters covered by the bundled PDF font.
          text: 'Your text',
          fontSize: 32,
          fontFamily: 'Liberation Sans',
          wrapText: true,
          fill: '#252039',
          width: 260,
          height: 80,
        })
      ),
      button(t('▧  Obrázek'), () => { replaceImageId = undefined; imageInput.click(); }),
      button(t('□  Obdélník'), () => insert('rect')),
      button(t('○  Elipsa'), () => insert('ellipse')),
      button(t('╱  Čára'), () => insert('line', { height: 1, strokeWidth: 3 })),
      button(t('↗  Šipka'), () => insert('arrow', { height: 70, strokeWidth: 3 })),
      button(t('☆  Hvězda'), () =>
        insert('path', {
          path: STAR_PATH,
          name: t('Hvězda'),
          width: 120,
          height: 120,
        })
      ),
      button(t('♡  Srdce'), () =>
        insert('path', {
          path: HEART_PATH,
          name: 'Srdce',
          width: 120,
          height: 120,
        })
      )
    );
    library.append(inserts);
    const personalTitle = document.createElement('h3');
    setUIText(personalTitle, () => t('Moje šablony'));
    library.append(personalTitle);
    library.append(button(t('Uložit výběr jako šablonu'), () => {
      const name = window.prompt(t('Název šablony:'));
      if (name === null) return;
      const source = window.prompt(t('Původ šablony:'));
      if (source === null) return;
      const license = window.prompt(t('Licence nebo oprávnění k použití šablony:'));
      if (license === null) return;
      const tags = window.prompt(t('Štítky oddělené čárkou:'));
      if (tags === null) return;
      try {
        const template = capturePersonalTemplate(project, selected.size ? [...selected] : [active], {
          name, source, license, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
        });
        savePersonalTemplate(template);
        renderLibrary();
      } catch { alert(t('Šablonu nelze uložit. Vyberte návrhovou stránku bez původního PDF a u obrázků vyplňte původ.')); }
    }));
    const search = document.createElement('input');
    search.type = 'search'; search.value = templateSearch; search.placeholder = t('Hledat šablony');
    search.setAttribute('aria-label', t('Hledat šablony'));
    search.onchange = () => { templateSearch = search.value; renderLibrary(); };
    library.append(search, button(t('Jen oblíbené'), () => { templateFavoritesOnly = !templateFavoritesOnly; renderLibrary(); }));
    try {
      for (const template of findPersonalTemplates(loadPersonalTemplates(), templateSearch, undefined, templateFavoritesOnly)) {
        const row = document.createElement('div'); row.className = 'studio-page-row';
        const preview = document.createElement('span'); preview.className = 'studio-template-preview';
        preview.style.background = template.pages[0].background;
        preview.title = `${Math.round(template.pages[0].width)} × ${Math.round(template.pages[0].height)} pt`;
        preview.style.width = '48px'; preview.style.height = '48px'; preview.style.display = 'inline-flex';
        const thumbnail = svg('svg', { viewBox: `0 0 ${template.pages[0].width} ${template.pages[0].height}`, width: 48, height: 48, 'aria-hidden': 'true' });
        for (const object of template.pages[0].objects.slice(0, 60)) {
          if (object.kind === 'rect') thumbnail.append(svg('rect', { x: object.x, y: object.y, width: object.width, height: object.height, fill: object.fill }));
          else if (object.kind === 'ellipse') thumbnail.append(svg('ellipse', { cx: object.x + object.width / 2, cy: object.y + object.height / 2, rx: object.width / 2, ry: object.height / 2, fill: object.fill }));
          else if (object.kind === 'text') { const label = svg('text', { x: object.x, y: object.y + (object.fontSize ?? 12), fill: object.fill, 'font-size': object.fontSize ?? 12 }); label.textContent = object.text?.slice(0, 80) ?? ''; thumbnail.append(label); }
          else if (object.kind === 'image' && object.src) thumbnail.append(svg('image', { x: object.x, y: object.y, width: object.width, height: object.height, href: object.src }));
        }
        preview.append(thumbnail);
        row.append(preview,
          button(template.name, () => changeStructure(before => {
            const at = before.pages.findIndex(page => page.id === active) + 1;
            const next = insertPersonalTemplate(before, template, at);
            return { project: next, pageId: next.pages[at].id };
          })),
          button(template.favorite ? '★' : '☆', () => { savePersonalTemplate({ ...template, favorite: !template.favorite }); renderLibrary(); }, t('Oblíbené')),
          button('×', () => { deletePersonalTemplate(template.id); renderLibrary(); }, t('Smazat šablonu')));
        library.append(row);
      }
    } catch { const note = document.createElement('p'); setUIText(note, () => t('Knihovna šablon není dostupná.')); library.append(note); }
    const brandTitle = document.createElement('h3'); setUIText(brandTitle, () => t('Moje značky'));
    library.append(brandTitle, button(t('Uložit novou značku'), () => {
      const kit = loadBrandKit();
      const name = window.prompt(t('Název značky:'), kit.name);
      if (name === null) return;
      try {
        saveBrandProfile({ version: 1, id: uid(), name: name.trim(),
          colors: { primary: kit.colors[0], accent: kit.colors[1], paper: kit.colors[2] ?? '#ffffff' },
          textStyles: { heading: { fontFamily: 'Liberation Sans Bold', fontSize: 32 }, body: { fontFamily: kit.font, fontSize: 12 } },
          ...(kit.logo ? { logo: kit.logo } : {}),
        });
        renderLibrary();
      } catch { alert(t('Značku nelze uložit.')); }
    }));
    try {
      for (const brand of loadBrandProfiles()) {
        const row = document.createElement('div'); row.className = 'studio-page-row';
        const swatch = document.createElement('span'); swatch.className = 'studio-template-preview'; swatch.style.background = brand.colors.primary;
        row.append(swatch, button(brand.name, () => change(() => {
          const ids = selected.size ? [...selected] : project.pages.flatMap(page => page.objects.map(object => object.id));
          project = applyBrandToSelection(project, brand, ids);
        }), t('Použít značku na přiřazené role')),
        button(t('Upravit značku'), () => {
          const primary = window.prompt(t('Hlavní barva (#RRGGBB):'), brand.colors.primary);
          if (primary === null) return;
          const accent = window.prompt(t('Doplňková barva (#RRGGBB):'), brand.colors.accent);
          if (accent === null) return;
          const paper = window.prompt(t('Barva podkladu (#RRGGBB):'), brand.colors.paper);
          if (paper === null) return;
          const heading = window.prompt(t('Velikost nadpisu (pt):'), String(brand.textStyles.heading.fontSize));
          if (heading === null) return;
          const body = window.prompt(t('Velikost běžného textu (pt):'), String(brand.textStyles.body.fontSize));
          if (body === null) return;
          try {
            saveBrandProfile({ ...brand, colors: { primary, accent, paper }, textStyles: {
              heading: { ...brand.textStyles.heading, fontSize: Number(heading) },
              body: { ...brand.textStyles.body, fontSize: Number(body) },
            } });
            renderLibrary();
          } catch { alert(t('Značku nelze uložit.')); }
        }),
        button('×', () => { deleteBrandProfile(brand.id); renderLibrary(); }, t('Smazat značku')));
        library.append(row);
      }
    } catch { const note = document.createElement('p'); setUIText(note, () => t('Knihovna značek není dostupná.')); library.append(note); }
    library.append(button(t('Exportovat značky'), () => {
      try {
        const url = URL.createObjectURL(new Blob([exportBrandProfiles(loadBrandProfiles())], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'pdf-editor-brands.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch { alert(t('Značky nelze exportovat.')); }
    }));
    const brandImport = document.createElement('input'); brandImport.type = 'file'; brandImport.accept = 'application/json,.json';
    brandImport.setAttribute('aria-label', t('Importovat značky'));
    brandImport.onchange = async () => {
      const file = brandImport.files?.[0]; if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error();
        for (const profile of importBrandProfiles(await file.text())) saveBrandProfile(profile);
        renderLibrary();
      } catch { alert(t('Značky nelze importovat.')); }
    };
    library.append(brandImport);
    const pagesTitle = document.createElement('h3');
    setUIText(pagesTitle, () => t('Stránky'));
    library.append(pagesTitle);
    project.pages.forEach((p, index) => {
      const row = document.createElement('div');
      row.className =
        'studio-page-row' + (active === p.id ? ' is-selected' : '');
      row.draggable = true;
      row.ondragstart = (e) =>
        e.dataTransfer?.setData('text/studio-page', p.id);
      row.ondragover = (e) => e.preventDefault();
      row.ondrop = (e) => {
        e.preventDefault();
        const id = e.dataTransfer?.getData('text/studio-page');
        if (id) changeStructure(before => ({ project: movePage(before, id, index) }));
      };
      row.append(
        button(`${index + 1}. ${p.name}`, () => {
          if (nativeSurface) {
            window.dispatchEvent(new CustomEvent('editor:graphic-page-selected', { detail: { pageIndex: p.sourcePageIndex ?? index } }));
            return;
          }
          active = p.id;
          selected.clear();
          render();
        }),
        button(
          '↑',
          () => changeStructure(before => ({ project: movePage(before, p.id, index - 1) })),
          t('Přesunout stránku nahoru')
        ),
        button(
          '↓',
          () => changeStructure(before => ({ project: movePage(before, p.id, index + 1) })),
          t('Přesunout stránku dolů')
        )
      );
      library.append(row);
    });
    library.append(
      button(t('+ Stránka'), () =>
        changeStructure(before => {
          const p: StudioPage = {
            id: uid(),
            name: `Stránka ${before.pages.length + 1}`,
            width: page().width,
            height: page().height,
            background: '#ffffff',
            objects: [],
          };
          before.pages.push(p);
          return { project: before, pageId: p.id };
        })
      ),
      button(t('Kopie stránky'), () =>
        changeStructure(before => {
          const index = before.pages.findIndex((p) => p.id === active);
          const next = duplicatePage(before, active);
          return { project: next, pageId: next.pages[index + 1].id };
        })
      ),
      button(t('Smazat stránku'), () => {
        if (project.pages.length < 2) return;
        changeStructure(before => {
          before.pages = before.pages.filter((p) => p.id !== active);
          return { project: before, pageId: before.pages[0].id };
        });
      }),
      layers
    );
    renderLayers();
  }
  function render() {
    toolbar.replaceChildren();
    const undo = button(t('↶ Zpět').replace(/^[↶↷]\s*/, ''), () => sharedHistory ? sharedHistory.undo() : restore(history.undo()));
    undo.dataset.toolbarAction = 'undo';
    undo.disabled = !(sharedHistory?.canUndo() ?? history.canUndo);
    const redo = button(t('↷ Znovu').replace(/^[↶↷]\s*/, ''), () => sharedHistory ? sharedHistory.redo() : restore(history.redo()));
    redo.dataset.toolbarAction = 'redo';
    redo.disabled = !(sharedHistory?.canRedo() ?? history.canRedo);
    toolbar.append(
      undo,
      redo,
      button(
        '−',
        () => {
          fit = false;
          zoom = Math.max(0.1, zoom - 0.1);
          renderCanvas();
        },
        t('Oddálit')
      ),
      button(t('Přizpůsobit'), () => {
        fit = true;
        renderCanvas();
      }),
      button(
        '+',
        () => {
          fit = false;
          zoom = Math.min(4, zoom + 0.1);
          renderCanvas();
        },
        t('Přiblížit')
      )
    );
    ['undo', 'redo', 'zoom-out', 'fit', 'zoom-in'].forEach((action, index) => { (toolbar.children[index] as HTMLElement).dataset.toolbarAction = action; });
    setUIText(heading, () => page().name +
      (page().sourcePageIndex !== undefined ? t(' · podklad z PDF') : ''));
    renderLibrary();
    renderProperties();
    renderCanvas();
    renderTextToolbar();
  }
  const keydown = (e: KeyboardEvent) => {
    if (nativeSurface && e.target instanceof Element && e.target.closest('#text-editor-app') && !e.target.closest('.studio-native-overlay')) return;
    if (
      (e.target as Element)?.closest(
        'input,textarea,select,[contenteditable="true"]'
      )
    )
      return;
    if (
      !container.contains(document.activeElement) &&
      !container.matches(':hover')
    )
      return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && selection().length === 1 && selection()[0].kind === 'text') {
      e.preventDefault(); startInline(selection()[0], true);
    } else if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault(); emphasis(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (sharedHistory) { if (e.shiftKey) sharedHistory.redo(); else sharedHistory.undo(); }
      else restore(e.shiftKey ? history.redo() : history.undo());
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (sharedHistory) sharedHistory.redo(); else restore(history.redo());
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelected();
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (page().objects.length && !requestGraphicSelection()) return;
      selected = new Set(page().objects.map((o) => o.id));
      render();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    } else if (e.key === 'Escape') {
      selected.clear();
      render();
    } else if (e.key.startsWith('Arrow') && selected.size) {
      e.preventDefault();
      const delta = e.shiftKey ? 10 : 1;
      change(() =>
        selection()
          .filter((o) => !o.locked)
          .forEach((o) => {
            if (e.key === 'ArrowLeft') o.x -= delta;
            if (e.key === 'ArrowRight') o.x += delta;
            if (e.key === 'ArrowUp') o.y -= delta;
            if (e.key === 'ArrowDown') o.y += delta;
          })
      );
    }
  };
  container.addEventListener('keydown', keydown);
  const observer = new ResizeObserver(() => renderCanvas());
  observer.observe(stage);
  const localeChanged = () => render();
  window.addEventListener('editor:locale-changed', localeChanged);
  render();
  return {
    getGuides: pageId => structuredClone([...(localGuides.get(pageId) ?? [])]),
    setGuides(pageId, guides) {
      if (!guides.length) { localGuides.delete(pageId); if (active === pageId && !destroyed) renderCanvas(); return; }
      const target = project.pages.find(page => page.id === pageId);
      if (!target || guides.length > 100 || guides.some(guide => !['x', 'y'].includes(guide.axis) ||
          !Number.isFinite(guide.position) || guide.position < 0 || guide.position > (guide.axis === 'x' ? target.width : target.height))) throw new Error(t('Neplatná vodítka.'));
      localGuides.set(pageId, structuredClone(guides));
      if (active === pageId) renderCanvas();
    },
    getProject: () => clone(project),
    updateNativeSource(sourcePdf) {
      project.sourcePdf = sourcePdf;
      backgrounds.clear();
    },
    attachNativeSurface(surface) {
      if (![surface.width, surface.height, surface.zoom].every(value => Number.isFinite(value) && value > 0)) return;
      const nextPage = project.pages.find(item => item.sourcePageIndex === surface.pageIndex) ?? project.pages[surface.pageIndex];
      if (!nextPage) return;
      const samePage = nativeSurface?.container === surface.container && active === nextPage.id;
      if (samePage && nativeSurface?.width === surface.width && nativeSurface.height === surface.height && nativeSurface.zoom === surface.zoom) return;
      if (!samePage) {
        inline?.finish();
        surfaceRoot().querySelector('.studio-paper')?.remove();
        selected.clear();
      }
      nativeSurface = surface;
      active = nextPage.id;
      zoom = surface.zoom;
      if (samePage && inline) {
        const drawing = surfaceRoot().querySelector('.studio-paper');
        drawing?.setAttribute('viewBox', `0 0 ${surface.width} ${surface.height}`);
        drawing?.setAttribute('width', String(surface.width * zoom));
        drawing?.setAttribute('height', String(surface.height * zoom));
      } else render();
    },
    detachNativeSurface() {
      if (!nativeSurface) return;
      inline?.finish();
      surfaceRoot().querySelector('.studio-paper')?.remove();
      nativeSurface = undefined;
      render();
    },
    clearSelection() {
      inline?.finish();
      if (!selected.size) return;
      selected.clear();
      render();
    },
    getActivePageId: () => active,
    getViewState: () => ({ pageId: active, selectedIds: [...selected] }),
    restoreViewState(view) {
      const nextPage = project.pages.find(page => page.id === view.pageId) ?? project.pages[view.pageIndex ?? -1] ?? page();
      const nextSelected = view.selectedIds.filter(id => nextPage.objects.some(object => object.id === id));
      if (nextSelected.length && !requestGraphicSelection()) return;
      active = nextPage.id;
      selected = new Set(nextSelected);
      render();
    },
    refreshHistory() {
      const undo = toolbar.querySelector<HTMLButtonElement>('[data-toolbar-action="undo"]');
      const redo = toolbar.querySelector<HTMLButtonElement>('[data-toolbar-action="redo"]');
      if (undo) undo.disabled = !(sharedHistory?.canUndo() ?? history.canUndo);
      if (redo) redo.disabled = !(sharedHistory?.canRedo() ?? history.canRedo);
    },
    setProject(next, options?: { recordHistory?: boolean }) {
      inline?.destroy(); inline = undefined; inlineObject = undefined;
      const sourceChanged = project.sourcePdf !== next.sourcePdf;
      project = clone(next);
      if (options?.recordHistory) history.push(project);
      else history = new ProjectHistory(project);
      if (
        !options?.recordHistory ||
        !project.pages.some((p) => p.id === active)
      )
        active = project.pages[0].id;
      selected.clear();
      if (sourceChanged) backgrounds.clear();
      if (sourceChanged) imagePreviews.clear();
      if (options?.recordHistory) onChange(clone(project), true);
      render();
    },
    setPageBackground(id, dataURL) {
      backgrounds.set(id, dataURL);
      if (active === id) renderCanvas();
    },
    async purgeForSanitization() {
      this.destroy();
      await Promise.allSettled([...pendingAssets]);
      backgrounds.clear(); imagePreviews.clear(); localGuides.clear(); selected.clear();
      inline = undefined; inlineObject = undefined; nativeSurface = undefined;
      replaceImageId = undefined; imageInput.onchange = null; imageInput.value = '';
      initial = { version: 1, name: '', pages: [] };
      project = clone(initial); history = new ProjectHistory(project); active = '';
      toolbar.replaceChildren(); textToolbar.replaceChildren(); library.replaceChildren();
      properties.replaceChildren(); stage.replaceChildren();
    },
    destroy() {
      destroyed = true;
      imagePreviews.clear();
      inline?.destroy();
      surfaceRoot().querySelector('.studio-paper')?.remove();
      document.removeEventListener('pointerdown', outsideInline, true);
      window.removeEventListener('editor:locale-changed', localeChanged);
      observer.disconnect();
      container.removeEventListener('keydown', keydown);
      for (const child of [...container.children]) {
        if (!nativeSurface || !child.contains(nativeSurface.container)) child.remove();
      }
      container.classList.remove('studio-editor');
    },
  };
}


