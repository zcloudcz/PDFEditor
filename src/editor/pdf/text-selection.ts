import { getDocument, TextLayer } from 'pdfjs-dist';
import type { StandardPdfToolsApi } from './standard-tools';

interface Bounds { left: number; top: number; width: number; height: number }
interface SelectionViewport { width: number; height: number; rotation: number; convertToPdfPoint(x: number, y: number): number[] }
interface TextFragment extends Bounds { rotation: number }
export interface PdfTextSelection { pageIndex: number; rect: [number, number, number, number]; quadPoints: number[] }

/** Rectangles are partial DOM text ranges, never whole PDF text items or a drawn marquee. */
export function mapTextSelectionRects(fragments: readonly TextFragment[], bounds: Bounds, viewport: SelectionViewport, pageIndex: number): PdfTextSelection | null {
  if (!fragments.length || fragments.length > 1000 || bounds.width <= 0 || bounds.height <= 0) return null;
  const points: number[] = [];
  for (const fragment of fragments) {
    const angle = ((fragment.rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(angle) || ![fragment.left, fragment.top, fragment.width, fragment.height].every(Number.isFinite) || fragment.width <= 0 || fragment.height <= 0) return null;
    const left = Math.max(0, fragment.left - bounds.left), top = Math.max(0, fragment.top - bounds.top);
    const right = Math.min(bounds.width, fragment.left + fragment.width - bounds.left), bottom = Math.min(bounds.height, fragment.top + fragment.height - bounds.top);
    if (right <= left || bottom <= top) return null;
    const corners = [[left, top], [right, top], [left, bottom], [right, bottom]];
    const order = angle === 90 ? [1, 3, 0, 2] : angle === 180 ? [3, 2, 1, 0] : angle === 270 ? [2, 0, 3, 1] : [0, 1, 2, 3];
    for (const index of order) { const p = corners[index]; points.push(...viewport.convertToPdfPoint(p[0] / bounds.width * viewport.width, p[1] / bounds.height * viewport.height)); }
  }
  if (points.some(value => !Number.isFinite(value))) return null;
  const xs = points.filter((_, index) => index % 2 === 0), ys = points.filter((_, index) => index % 2 === 1), x = Math.min(...xs), y = Math.min(...ys);
  return { pageIndex, rect: [x, y, Math.max(...xs) - x, Math.max(...ys) - y], quadPoints: points };
}

export function readTextSelection(layer: HTMLElement, selection: Selection | null, bounds: Bounds, viewport: SelectionViewport, pageIndex: number): PdfTextSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const selected = selection.getRangeAt(0);
  if (!layer.contains(selected.startContainer) || !layer.contains(selected.endContainer) || selected.toString().length > 10000) return null;
  const fragments: TextFragment[] = [], walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!selected.intersectsNode(node) || !node.textContent?.length) continue;
    const part = document.createRange(); part.selectNodeContents(node);
    if (selected.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(selected.startContainer, selected.startOffset);
    if (selected.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(selected.endContainer, selected.endOffset);
    if (part.collapsed || !part.toString().trim()) continue;
    const span = node.parentElement;
    const rotation = viewport.rotation + Number.parseFloat(span?.style.getPropertyValue('--rotate') || '0');
    for (const rect of part.getClientRects()) if (rect.width > 0 && rect.height > 0) fragments.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, rotation });
    if (fragments.length > 1000) return null;
  }
  return mapTextSelectionRects(fragments, bounds, viewport, pageIndex);
}

const layerCss = `.editor-text-selection-layer{position:absolute;left:0;top:0;line-height:1;transform-origin:0 0;user-select:text;cursor:text;text-size-adjust:none;--min-font-size:1;--scale-round-x:1px;--scale-round-y:1px}
.editor-text-selection-layer :is(span,br){position:absolute;white-space:pre;color:transparent;cursor:text;transform-origin:0 0;user-select:text}
.editor-text-selection-layer>span{font-size:calc(var(--total-scale-factor) * var(--min-font-size) * var(--font-height));transform:rotate(var(--rotate,0deg)) scaleX(var(--scale-x,1)) scale(calc(1 / var(--min-font-size)))}
.editor-text-selection-layer ::selection{background:rgba(2,132,199,.35);color:transparent}`;

/** A temporary selection tool on the native page. Enter commits; cancellation never creates PDF changes. */
export async function pickPdfTextSelection(bytes: Uint8Array, getSurface: NonNullable<StandardPdfToolsApi['getPageSurface']>, signal?: AbortSignal, instruction = 'Vyberte text na stránce. Enter potvrdí výběr, Escape zruší akci.'): Promise<PdfTextSelection | null> {
  signal?.throwIfAborted();
  const surface = getSurface(); if (!surface || !surface.container.isConnected) return null;
  const container = surface.container, controller = new AbortController(), loading = getDocument({ data: bytes.slice(), isEvalSupported: false });
  const overlay = document.createElement('div'), layer = document.createElement('div'), css = document.createElement('style'), hint = document.createElement('p');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', zIndex: '2147483646', userSelect: 'text', cursor: 'text' });
  overlay.dataset.pdfTextSelection = ''; layer.className = 'editor-text-selection-layer'; layer.tabIndex = 0; layer.setAttribute('role', 'document'); layer.setAttribute('aria-label', instruction); overlay.append(layer);
  css.textContent = layerCss; hint.setAttribute('role', 'status'); hint.textContent = instruction;
  Object.assign(hint.style, { position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', padding: '12px', background: '#0f172a', color: 'white', zIndex: '2147483647', pointerEvents: 'none' });
  let textLayer: TextLayer | undefined, viewport: SelectionViewport | undefined, ready = false, finished = false;
  let resolveSelection: (result: PdfTextSelection | null) => void = () => {};
  const result = new Promise<PdfTextSelection | null>(resolve => { resolveSelection = resolve; });
  const valid = (): boolean => { const current = getSurface(); return container.isConnected && current?.container === container && current.pageIndex === surface.pageIndex && current.width === surface.width && current.height === surface.height && current.zoom === surface.zoom; };
  const finish = (selection: PdfTextSelection | null): void => { if (!finished) { finished = true; resolveSelection(selection); } };
  const cancel = (): void => { finish(null); controller.abort(); };
  const stop = (event: Event): void => event.stopImmediatePropagation();
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    else if (event.key === 'Enter' && ready && viewport) { event.preventDefault(); event.stopImmediatePropagation(); if (!valid()) { cancel(); return; } const selected = readTextSelection(layer, window.getSelection(), container.getBoundingClientRect(), viewport, surface.pageIndex); if (selected) finish(selected); }
  };
  const abortLoading = (): void => { textLayer?.cancel(); void loading.destroy(); };
  controller.signal.addEventListener('abort', abortLoading, { once: true }); signal?.addEventListener('abort', cancel, { once: true });
  window.addEventListener('keydown', keydown, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
  window.addEventListener('editor:document-changed', cancel); window.addEventListener('editor:page-rendered', cancel);
  const observer = new MutationObserver(() => { if (!valid()) cancel(); }); observer.observe(document.body, { subtree: true, childList: true });
  for (const type of ['pointerdown', 'mousedown', 'dblclick']) overlay.addEventListener(type, stop);
  try {
    const doc = await loading.promise; if (!valid() || controller.signal.aborted || surface.pageIndex < 0 || surface.pageIndex >= doc.numPages) return null;
    const page = await doc.getPage(surface.pageIndex + 1), base = page.getViewport({ scale: 1 }), bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const displayViewport = page.getViewport({ scale: bounds.width / base.width }); viewport = displayViewport;
    layer.style.setProperty('--total-scale-factor', String(displayViewport.scale * page.userUnit));
    const rotation = displayViewport.rotation;
    layer.style.transform = rotation === 90 ? 'rotate(90deg) translateY(-100%)' : rotation === 180 ? 'rotate(180deg) translate(-100%,-100%)' : rotation === 270 ? 'rotate(270deg) translateX(-100%)' : '';
    const content = await page.getTextContent(); if (!valid() || controller.signal.aborted) return null;
    document.head.append(css); document.body.append(hint); container.append(overlay); window.getSelection()?.removeAllRanges();
    textLayer = new TextLayer({ textContentSource: content, container: layer, viewport: displayViewport });
    await textLayer.render(); if (!valid() || controller.signal.aborted) return null;
    ready = true; layer.focus({ preventScroll: true }); overlay.dataset.selectionReady = 'true';
    return await result;
  } catch (error) { if (controller.signal.aborted) return null; throw error; }
  finally {
    const selection = window.getSelection(); if (selection?.anchorNode && layer.contains(selection.anchorNode)) selection.removeAllRanges();
    ready = false; textLayer?.cancel(); overlay.remove(); hint.remove(); css.remove(); observer.disconnect();
    signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', abortLoading);
    window.removeEventListener('keydown', keydown, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel);
    window.removeEventListener('editor:document-changed', cancel); window.removeEventListener('editor:page-rendered', cancel);
    await loading.destroy();
  }
}
