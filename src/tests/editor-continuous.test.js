import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContinuousPages, clientToPage } from '../js/editcore/continuous-pages';

let stage, wrap, engine, view, activate;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('ImageData', class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: vi.fn() });
  document.body.innerHTML = '<div id="stage"><div id="pageWrap"><canvas id="page"></canvas><div id="overlay"><input value="uncommitted"></div></div></div>';
  stage = document.getElementById('stage'); wrap = document.getElementById('pageWrap');
  stage.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
  engine = {
    doc: 1, page: 1, pageIndex: 0, pageCount: 100, _pageCache: new Map(),
    M: { _FPDF_LoadPage: vi.fn((_, i) => i + 1), _FPDF_ClosePage: vi.fn(), _FPDF_GetPageWidthF: p => p % 2 ? 100 : 200, _FPDF_GetPageHeightF: p => p % 2 ? 200 : 100 },
    renderPage() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; },
  };
  activate = vi.fn((index, options) => {
    engine.pageIndex = index; engine.page = index + 1;
    view.sync(engine, view.zoom, 0);
    if (options.scroll) view.scrollTo(index);
  });
  view = new ContinuousPages(stage, wrap, activate, { maxCanvases: 3 });
  view.sync(engine, 1, 0);
  view.slots.forEach((slot, i) => {
    slot.getBoundingClientRect = () => {
      const top = view.slots.slice(0, i).reduce((sum, s) => sum + parseFloat(s.style.height) + 24, 0) - stage.scrollTop;
      const height = parseFloat(slot.style.height);
      return { top, bottom: top + height, height };
    };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('continuous document viewport', () => {
  it('lays out every mixed-size page without rendering or switching the active page', () => {
    expect(view.slots).toHaveLength(100);
    expect(view.slots[0].style.height).toBe('200px');
    expect(view.slots[1].style.width).toBe('200px');
    expect(view.slots[1].style.height).toBe('100px');
    expect(stage.querySelectorAll('canvas')).toHaveLength(1);
    expect(engine.pageIndex).toBe(0);
    expect(activate).not.toHaveBeenCalled();
  });
  it('bounds preview canvases and scrolling retains active editor DOM and pending text', () => {
    const input = wrap.querySelector('input');
    for (let i = 0; i < 5; i++) view.paintNearby();
    expect(view.list.querySelectorAll('.continuous-page > canvas').length).toBeLessThanOrEqual(3);
    stage.scrollTop = 8000;
    for (let i = 0; i < 5; i++) view.paintNearby();
    expect(view.slots[1].querySelector('canvas')).toBeNull();
    expect(view.list.querySelectorAll('.continuous-page > canvas').length).toBeLessThanOrEqual(3);
    expect(document.getElementById('overlay').querySelector('input')).toBe(input);
    expect(input.value).toBe('uncommitted');
    expect(wrap.parentElement).toBe(view.slots[0]);
    expect(activate).not.toHaveBeenCalled();
  });
  it('defers page rendering while the user is scrolling', () => {
    vi.useFakeTimers();
    try {
      const render = vi.spyOn(engine, 'renderPage');
      stage.dispatchEvent(new Event('scroll'));
      view.paintNearby();
      expect(render).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      view.paintNearby();
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('activates clicked pages without changing viewport scroll and retains the overlay node', () => {
    const overlay = document.getElementById('overlay');
    stage.scrollTop = 300;
    view.slots[2].click();
    expect(activate).toHaveBeenCalledWith(2, { scroll: false });
    expect(stage.scrollTop).toBe(300);
    expect(wrap.parentElement).toBe(view.slots[2]);
    expect(document.getElementById('overlay')).toBe(overlay);
  });
  it('preserves the visible page fraction when zooming and never removes active canvas', () => {
    stage.scrollTop = 260;
    const before = view.anchor();
    const canvas = document.getElementById('page');
    view.sync(engine, 2, 0);
    const after = view.anchor();
    expect(after.slot).toBe(before.slot);
    expect(after.fraction).toBeCloseTo(before.fraction, 8);
    expect(document.getElementById('page')).toBe(canvas);
    expect(view.slots[1].style.height).toBe('200px');
  });
  it('rebuilds slots on a document revision without discarding native DOM', () => {
    const overlay = document.getElementById('overlay');
    engine.pageCount = 2;
    view.sync(engine, 1, 1);
    expect(view.slots).toHaveLength(2);
    expect(document.getElementById('overlay')).toBe(overlay);
  });
});

describe('continuous active-page pointer coordinates', () => {
  it.each([[-600, 2], [50, 0.5], [-1500, 1]])('maps viewport coordinates after scrolling top=%s zoom=%s', (top, zoom) => {
    const rect = { left: -120, top };
    // A point 40 PDF points from the left, 60 points down from page top.
    expect(clientToPage(rect.left + 40 * zoom, top + 60 * zoom, rect, zoom, 792))
      .toEqual({ px: 40, py: 732 });
  });
});
