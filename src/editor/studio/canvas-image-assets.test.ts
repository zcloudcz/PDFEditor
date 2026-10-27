import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountStudioCanvas } from './canvas';
import { createTemplate } from './templates';
import { capturePersonalTemplate, savePersonalTemplate } from './personal-templates';
import { saveBrandProfile } from './brand-library';
import type { StudioProject } from './types';
import { exportSvg } from './exports';

beforeEach(() => { localStorage.clear(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = (root: HTMLElement, label: string) => {
  const button = [...root.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  expect(button, label).toBeTruthy(); (button as HTMLButtonElement).click();
};

describe('image and reusable asset controls on the same canvas', () => {
  it('edits an image nondestructively and resets all edits while preserving its source', () => {
    const project = createTemplate('social');
    const image = project.pages[0].objects[0];
    image.kind = 'image'; image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3u8AAAAASUVORK5CYII=';
    const host = document.createElement('div'); document.body.append(host);
    const controller = mountStudioCanvas(host, project, vi.fn());
    controller.restoreViewState!({ pageId: project.pages[0].id, selectedIds: [image.id] });
    click(host, 'Kruhová maska');
    click(host, 'Vyplnit rámeček');
    expect(controller.getProject().pages[0].objects[0]).toMatchObject({ imageMask: { kind: 'circle' }, imageFit: 'cover', src: image.src });
    click(host, 'Obnovit úpravy obrázku');
    expect(controller.getProject().pages[0].objects[0].imageMask).toBeUndefined();
    expect(controller.getProject().pages[0].objects[0].src).toBe(image.src);
    controller.destroy();
  });

  it('inserts a saved page into the current document and applies only explicit brand roles', () => {
    const project = createTemplate('flyer');
    const design = createTemplate('social');
    savePersonalTemplate(capturePersonalTemplate(design, [design.pages[0].id], { name: 'Campaign', tags: ['social'], license: 'CC0-1.0', source: 'Created by me' }));
    saveBrandProfile({ version: 1, id: 'b', name: 'My Brand', colors: { primary: '#112233', accent: '#abcdef', paper: '#ffffff' },
      textStyles: { heading: { fontFamily: 'Liberation Sans Bold', fontSize: 32 }, body: { fontFamily: 'Liberation Sans', fontSize: 12 } } });
    const host = document.createElement('div'); document.body.append(host);
    const controller = mountStudioCanvas(host, project, vi.fn());
    controller.restoreViewState!({ pageId: project.pages[0].id, selectedIds: [project.pages[0].objects[0].id] });
    click(host, 'Přiřadit barvu: Hlavní');
    click(host, 'My Brand');
    expect(controller.getProject().pages[0].objects[0].fill).toBe('#112233');
    expect(controller.getProject().pages[0].objects[1].fill).toBe(project.pages[0].objects[1].fill);
    click(host, 'Campaign');
    expect(controller.getProject().pages).toHaveLength(2);
    expect(controller.getProject().pages[0].id).toBe(project.pages[0].id);
    controller.destroy();
  });

  it.each(['contain', 'cover'] as const)('matches rendered preview and SVG export for a non-square source in %s mode', async fit => {
    const source = createCanvas(200, 100), paint = source.getContext('2d');
    paint.fillStyle = '#ff0000'; paint.fillRect(0, 0, 100, 100);
    paint.fillStyle = '#0000ff'; paint.fillRect(100, 0, 100, 100);
    const src = `data:image/png;base64,${source.toBuffer('image/png').toString('base64')}`;
    const project: StudioProject = { version: 1, name: 'Image', pages: [{ id: 'page', name: 'Page', width: 100, height: 100, background: '#ffffff', objects: [
      { id: 'photo', kind: 'image', name: 'Photo', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false, src,
        imageFit: fit },
    ] }] };
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      if (tag !== 'canvas') return original(tag, options);
      const canvas = createCanvas(1, 1);
      (canvas as unknown as { toBlob: (callback: (blob: Blob) => void) => void }).toBlob = callback =>
        callback(new Blob([Uint8Array.from(canvas.toBuffer('image/png'))], { type: 'image/png' }));
      return canvas as unknown as HTMLCanvasElement;
    });
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => Object.assign(await loadImage(Buffer.from(await blob.arrayBuffer())), { close() {} }));
    const host = document.createElement('div'); document.body.append(host);
    const controller = mountStudioCanvas(host, project, vi.fn());
    await vi.waitFor(() => {
      const href = host.querySelector('.studio-paper image')?.getAttribute('href');
      expect(href).toMatch(/^data:image\/png;base64,/);
      expect(href).not.toBe(src);
    });
    const preview = host.querySelector('.studio-paper image')?.getAttribute('href');
    expect(preview).toMatch(/^data:image\/png;base64,/);
    const exported = /href="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(await exportSvg(project, 'page'))?.[1];
    expect(exported).toBe(preview);
    const decoded = await loadImage(Buffer.from(preview!.split(',')[1], 'base64'));
    const pixels = createCanvas(200, 200); pixels.getContext('2d').drawImage(decoded, 0, 0);
    const top = pixels.getContext('2d').getImageData(100, 10, 1, 1).data;
    expect(top[3]).toBe(fit === 'contain' ? 0 : 255);
    controller.destroy();
  });
});
