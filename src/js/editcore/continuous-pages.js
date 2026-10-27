import { t } from '../../editor/i18n';
export function clientToPage(clientX, clientY, rect, zoom, pageHeight) {
  return { px: (clientX - rect.left) / zoom, py: pageHeight - (clientY - rect.top) / zoom };
}

// Read-only native page access: never changes the active page/session/history.
export function withPreviewPage(engine, index, visit) {
  const cached = index === engine.pageIndex ? engine.page : engine._pageCache?.get(index);
  const page = cached || engine.M._FPDF_LoadPage(engine.doc, index);
  if (!page) throw new Error('Page preview could not be loaded.');
  try {
    return visit(page, engine.M._FPDF_GetPageWidthF(page), engine.M._FPDF_GetPageHeightF(page));
  } finally {
    if (!cached) engine.M._FPDF_ClosePage(page);
  }
}

export function renderPreview(engine, index, scale) {
  return withPreviewPage(engine, index, (page, width, height) => {
    // renderPage only needs these fields; a facade gives it independent scratch storage.
    const preview = Object.create(engine);
    Object.assign(preview, { page, pageWidth: width, pageHeight: height, _renderScratch: null });
    return preview.renderPage(Math.min(scale, 1600 / Math.max(width, height)));
  });
}

export class ContinuousPages {
  constructor(stage, activeWrap, activate, { maxCanvases = 6 } = {}) {
    this.stage = stage;
    stage.classList.add('continuous-stage');
    this.activeWrap = activeWrap;
    this.activate = activate;
    this.maxCanvases = maxCanvases;
    this.slots = [];
    this.frame = 0;
    this.list = document.createElement('div');
    this.list.className = 'continuous-pages';
    stage.append(this.list);
    stage.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.list.addEventListener('click', (event) => {
      const slot = event.target.closest('.continuous-page');
      if (!slot || this.activeWrap.contains(event.target)) return;
      const index = Number(slot.dataset.pageIndex);
      this.activate(index, { scroll: false });
      this.activeWrap.focus({ preventScroll: true });
    });
    this.list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!event.target.classList.contains('continuous-page')) return;
      event.preventDefault();
      this.activate(Number(event.target.dataset.pageIndex), { scroll: false });
      this.activeWrap.focus({ preventScroll: true });
    });
    this.activeWrap.tabIndex = -1;
  }

  anchor() {
    const top = this.stage.getBoundingClientRect().top;
    const slot = this.slots.find(s => s.getBoundingClientRect().bottom > top);
    if (!slot) return null;
    const rect = slot.getBoundingClientRect();
    return { slot, fraction: (top - rect.top) / Math.max(1, rect.height), left: this.stage.scrollLeft / (this.zoom || 1) };
  }

  sync(engine, zoom, epoch) {
    const rebuild = this.doc !== engine.doc || this.epoch !== epoch || this.slots.length !== engine.pageCount;
    const anchor = !rebuild && this.zoom !== zoom ? this.anchor() : null;
    this.engine = engine;
    if (rebuild) {
      this.activeWrap.remove();
      this.list.replaceChildren();
      this.doc = engine.doc;
      this.epoch = epoch;
      this.slots = Array.from({ length: engine.pageCount }, (_, index) => {
        const slot = document.createElement('section');
        slot.className = 'continuous-page';
        slot.dataset.pageIndex = String(index);
        slot.dataset.uiPageLabel = 'Stránka';
        slot.dataset.pageLabel = `${t('Stránka')} ${index + 1}`;
        slot.tabIndex = 0;
        slot.dataset.uiAriaLabel = 'Page {number}. Activate to edit.';
        slot.dataset.uiParams = JSON.stringify({ number: index + 1, 0: index + 1 });
        slot.setAttribute('aria-label', t(slot.dataset.uiAriaLabel, { number: index + 1 }));
        slot.size = withPreviewPage(engine, index, (_, w, h) => ({ w, h }));
        this.list.append(slot);
        return slot;
      });
    }
    if (rebuild || this.zoom !== zoom) {
      for (const slot of this.slots) {
        slot.style.width = `${slot.size.w * zoom}px`;
        slot.style.height = `${slot.size.h * zoom}px`;
        slot.querySelector(':scope > canvas')?.remove();
      }
    }
    this.zoom = zoom;
    const active = this.slots[engine.pageIndex];
    // Never clear/recreate the native overlay or editable DOM when scrolling.
    if (this.activeWrap.parentNode !== active) {
      active.querySelector(':scope > canvas')?.remove();
      active.append(this.activeWrap);
    }
    for (const slot of this.slots) slot.classList.toggle('is-active', slot === active);
    if (anchor) {
      const rect = anchor.slot.getBoundingClientRect();
      this.stage.scrollTop += rect.top + rect.height * anchor.fraction - this.stage.getBoundingClientRect().top;
      this.stage.scrollLeft = anchor.left * zoom;
    }
    this.schedule();
  }

  scrollTo(index) {
    const slot = this.slots[index];
    if (!slot) return;
    this.stage.scrollTop += slot.getBoundingClientRect().top - this.stage.getBoundingClientRect().top - 24;
    this.schedule();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paintNearby(); });
  }

  paintNearby() {
    if (!this.engine?.doc || this.engine.doc !== this.doc) return;
    const stage = this.stage.getBoundingClientRect();
    const nearby = this.slots.map(slot => ({ slot, rect: slot.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > stage.top - 500 && rect.top < stage.bottom + 500)
      .sort((a, b) => Math.abs(a.rect.top - stage.top) - Math.abs(b.rect.top - stage.top))
      .slice(0, this.maxCanvases);
    const keep = new Set(nearby.map(n => n.slot));
    for (const slot of this.slots) {
      if (!keep.has(slot) && !slot.contains(this.activeWrap)) slot.querySelector(':scope > canvas')?.remove();
    }
    // Render one page per animation frame, keeping interaction responsive.
    const slot = nearby.map(n => n.slot).find(s => !s.contains(this.activeWrap) && !s.querySelector(':scope > canvas'));
    if (!slot) return;
    try {
      const image = renderPreview(this.engine, Number(slot.dataset.pageIndex), this.zoom * (globalThis.devicePixelRatio || 1));
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
      slot.append(canvas);
    } catch {
      slot.dataset.uiAriaLabel = 'Page {number}. Preview unavailable; activate to open.';
      slot.setAttribute('aria-label', t(slot.dataset.uiAriaLabel, { number: Number(slot.dataset.pageIndex) + 1 }));
      return;
    }
    this.schedule();
  }
}
