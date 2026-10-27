import type { StudioObject, StudioProject } from './types';
import { type ImageCutout, validateImageCutout } from './image-masks';
import { applyCutoutAlpha, MAX_CUTOUT_EDGE, segmentBackground } from './background-segmentation';
import { editedImageDataUrl } from './image-effects';

/** Schema validity alone does not establish that a bounded mask can be rendered. */
export async function prepareImageCutoutDraft(object: StudioObject, edit: ImageCutout | undefined, signal: AbortSignal): Promise<StudioObject> {
  signal.throwIfAborted();
  if (object.kind !== 'image' || object.locked || !object.src || (edit && !validateImageCutout(edit))) throw new Error('Invalid image cutout.');
  const next = structuredClone(object);
  if (edit) next.imageCutout = structuredClone(edit);
  else delete next.imageCutout;
  await editedImageDataUrl(next, 2, signal);
  signal.throwIfAborted();
  return next;
}

export interface MaskToolApi {
  t(message: string): string;
  registerDocumentAction(label: string, action: () => void | Promise<void>): HTMLButtonElement;
  mountDocumentPanel(title: string, mount: (body: HTMLElement, close: () => void) => void | (() => void)): void;
  readProjectSnapshot(): Promise<{ project: StudioProject; revision: number; view: { pageId?: string; selectedIds: string[] } }>;
  runProjectOperation(label: string, prepare: (project: StudioProject, signal: AbortSignal) => Promise<StudioProject>, expectedRevision?: number, signal?: AbortSignal): Promise<void>;
}

/** Modal draft: only Apply enters project history; closing or cancellation discards every brush stroke. */
export function setupMaskTool(api: MaskToolApi): void {
  api.registerDocumentAction('Vyříznout pozadí obrázku', () => api.mountDocumentPanel('Vyříznout pozadí obrázku', (body, close) => {
    const t = api.t;
    const session = new AbortController();
    let previewTask: AbortController | undefined;
    let disposed = false;
    let snapshot: Awaited<ReturnType<MaskToolApi['readProjectSnapshot']>>;
    const message = document.createElement('p'); message.setAttribute('role', 'status'); body.append(message);
    const fail = (error: unknown) => { if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) message.textContent = t('Operace se nezdařila.'); };
    void api.readProjectSnapshot().then(async value => {
      if (disposed) return;
      snapshot = value;
      const page = value.project.pages.find(item => item.id === value.view.pageId) ?? value.project.pages[0];
      const object = page.objects.find(item => value.view.selectedIds.includes(item.id) && item.kind === 'image' && item.src && !item.locked);
      if (!object?.src) { message.textContent = t('Vyberte odemčený obrázek.'); return; }
      const original = object.src;
      let draft: ImageCutout | undefined = object.imageCutout ? structuredClone(object.imageCutout) : undefined;
      const image = new Image(); image.src = original;
      await image.decode();
      if (disposed) return;
      const scale = Math.min(1, MAX_CUTOUT_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const source = document.createElement('canvas'); source.width = width; source.height = height;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) throw new Error('Canvas unavailable.');
      sourceContext.drawImage(image, 0, 0, width, height);
      const pixels = sourceContext.getImageData(0, 0, width, height);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.style.cssText = 'display:block;max-width:100%;max-height:60vh;touch-action:none;background-color:#eee;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0';
      canvas.setAttribute('aria-label', t('Náhled masky obrázku'));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable.');
      const controls = document.createElement('div'); controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0';
      body.append(controls, canvas);
      message.textContent = t('Klikněte na barvu pozadí a opravte okraje štětcem. Jemné vlasy a podobně barevné oblasti vyžadují ruční opravu.');
      let mode: 'seed' | 'keep' | 'remove' = 'seed';
      let tolerance = draft?.seed?.tolerance ?? 0.12;
      let radius = 0.025;
      let activeStroke: ImageCutout['strokes'][number] | undefined;
      const control = (label: string, action: () => void) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = t(label); button.onclick = action; controls.append(button); return button; };
      const modes = [
        control('Pozadí', () => { mode = 'seed'; updateModes(); }),
        control('Zachovat štětcem', () => { mode = 'keep'; updateModes(); }),
        control('Odstranit štětcem', () => { mode = 'remove'; updateModes(); }),
      ];
      const updateModes = () => modes.forEach((button, index) => button.setAttribute('aria-pressed', String(['seed', 'keep', 'remove'][index] === mode)));
      updateModes();
      const slider = (label: string, value: number, min: number, max: number, update: (value: number) => void) => {
        const wrapper = document.createElement('label'); wrapper.textContent = `${t(label)} `;
        const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value); input.oninput = () => update(Number(input.value));
        wrapper.append(input); controls.append(wrapper);
      };
      slider('Tolerance barvy (%)', Math.round(tolerance * 100), 0, 100, value => {
        tolerance = value / 100;
        if (draft?.seed) { draft.seed.tolerance = tolerance; void renderPreview(); }
      });
      slider('Velikost štětce (%)', Math.round(radius * 1000), 1, 200, value => { radius = value / 1000; });
      const renderPreview = async () => {
        previewTask?.abort();
        const task = new AbortController(); previewTask = task;
        if (session.signal.aborted) return;
        try {
          const alpha = draft && validateImageCutout(draft) ? await segmentBackground(pixels, draft, task.signal) : undefined;
          if (disposed || task.signal.aborted) return;
          const output = alpha ? applyCutoutAlpha(pixels, alpha) : pixels;
          const preview = context.createImageData(width, height);
          preview.data.set(output.data);
          context.putImageData(preview, 0, 0);
        } catch (error) { fail(error); }
      };
      const position = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
      };
      canvas.onpointerdown = event => {
        if (event.button !== 0) return;
        const at = position(event);
        if (mode === 'seed') { draft = { version: 1, seed: { ...at, tolerance }, strokes: draft?.strokes ?? [] }; void renderPreview(); return; }
        const strokes = draft?.strokes ?? [];
        if (strokes.length >= 128 || strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) >= 4096) { message.textContent = t('Limit tahů masky byl dosažen.'); return; }
        activeStroke = { mode, radius, points: [at] };
        draft = { version: 1, ...(draft?.seed ? { seed: draft.seed } : {}), strokes: [...strokes, activeStroke] };
        canvas.setPointerCapture(event.pointerId);
      };
      canvas.onpointermove = event => {
        if (!activeStroke || !canvas.hasPointerCapture(event.pointerId)) return;
        if (activeStroke.points.length >= 512 || draft!.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) >= 4096) return;
        const at = position(event), previous = activeStroke.points.at(-1)!;
        if (Math.hypot((at.x - previous.x) * width, (at.y - previous.y) * height) >= 2) activeStroke.points.push(at);
      };
      const finish = () => { if (activeStroke) { activeStroke = undefined; void renderPreview(); } };
      canvas.onpointerup = finish; canvas.onpointercancel = finish;
      control('Obnovit původní obrázek', () => { draft = undefined; void renderPreview(); });
      control('Zrušit', close);
      const apply = control('Použít masku', () => {
        if (draft && !validateImageCutout(draft)) { message.textContent = t('Neplatná maska obrázku.'); return; }
        apply.disabled = true;
        const edit = draft ? structuredClone(draft) : undefined;
        void api.runProjectOperation('Maska obrázku', async (project, signal) => {
          signal.throwIfAborted();
          const targetPage = project.pages.find(item => item.id === page.id);
          const target = targetPage?.objects.find(item => item.id === object.id && item.kind === 'image');
          if (!target || target.src !== original) throw new Error('Image changed.');
          const prepared = await prepareImageCutoutDraft(target, edit, signal);
          targetPage!.objects[targetPage!.objects.indexOf(target)] = prepared;
          return project;
        }, snapshot.revision, session.signal).then(close).catch(error => { apply.disabled = false; fail(error); });
      });
      void renderPreview();
    }).catch(fail);
    return () => { disposed = true; session.abort(); previewTask?.abort(); };
  }));
}
