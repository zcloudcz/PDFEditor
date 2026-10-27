import { describe, expect, it, vi } from 'vitest';
import { bytesBase64 } from './project-io';
import type { StudioProject } from './types';

// Fake pdf.js: counts how often a whole document is parsed and destroyed.
const pdfjs = vi.hoisted(() => ({ parsed: [] as Uint8Array[], destroyed: 0 }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: ({ data }: { data: Uint8Array }) => {
    pdfjs.parsed.push(data);
    return {
      promise: Promise.resolve({
        getPage: async () => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup: () => {},
        }),
        destroy: async () => { pdfjs.destroyed++; },
      }),
    };
  },
}));
const { renderPdfBackground } = await import('./exports');

const project = (bytes: number[], pages = 3): StudioProject => ({
  version: 1,
  name: 'p',
  sourcePdf: bytesBase64(new Uint8Array(bytes)),
  pages: Array.from({ length: pages }, (_, i) => ({ id: `p${i}`, sourcePageIndex: i, width: 100, height: 100, objects: [] as unknown[] })),
} as unknown as StudioProject);

describe('renderPdfBackground', () => {
  it('parses the source PDF once for all pages and releases it when the source changes', async () => {
    const first = project([1, 2, 3]);
    await Promise.all(first.pages.map(page => renderPdfBackground(first, page.id)));
    expect(pdfjs.parsed).toHaveLength(1);
    expect([...pdfjs.parsed[0]]).toEqual([1, 2, 3]);
    expect(pdfjs.destroyed).toBe(0);

    const second = project([4, 5]);
    await renderPdfBackground(second, 'p0');
    expect(pdfjs.parsed).toHaveLength(2);
    await vi.waitFor(() => expect(pdfjs.destroyed).toBe(1));
  });
});
