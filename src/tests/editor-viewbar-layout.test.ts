import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const nativeStyles = readFileSync('src/css/edit-pdf-text.css', 'utf8');
const shellStyles = readFileSync('src/editor/shell.css', 'utf8');
const hostStyles = readFileSync('src/editor/studio/host.css', 'utf8');

afterEach(() => document.body.replaceChildren());
it('lays out native zoom and page groups in separate flow boxes inside the shared pane', () => {
  const style = document.createElement('style'); style.textContent = nativeStyles + shellStyles + hostStyles;
  expect(hostStyles.length).toBeGreaterThan(100);
  document.body.append(style);
  const canvas = document.createElement('div'); canvas.className = 'studio-native-surface';
  canvas.innerHTML = '<div id="text-editor-app"><div id="viewbar"><div class="fit-controls"><button class="btn">Fit page</button></div><div class="vbzoom"><button id="zoomOut" class="btn icon">−</button></div><div class="vbcenter"><span id="pageLabel">1 / 2</span></div></div></div>';
  document.body.append(canvas);
  const counter = getComputedStyle(canvas.querySelector('.vbcenter')!);
  expect(counter.position).toBe('static'); expect(counter.transform).toBe('none');
  expect(getComputedStyle(canvas.querySelector('#viewbar')!).flexWrap).toBe('wrap');
  expect(getComputedStyle(canvas.querySelector('.fit-controls .btn')!).width).toBe('auto');
});
