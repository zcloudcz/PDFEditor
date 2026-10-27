import { describe, it, expect } from 'vitest';
import { fitZoom, pageDimensions } from './page-settings';
import { PDFDocument } from 'pdf-lib';

describe('document page dimensions', () => {
  it('creates exact Letter points and swaps landscape orientation', () => {
    expect(pageDimensions('letter', false, 0, 0)).toEqual({ width: 612, height: 792 });
    expect(pageDimensions('letter', true, 0, 0)).toEqual({ width: 792, height: 612 });
  });
  it('converts millimeters and rejects unsafe or non-finite sizes', () => {
    const dimensions = pageDimensions('custom', false, 254, 508);
    expect(dimensions.width).toBeCloseTo(720, 8);
    expect(dimensions.height).toBeCloseTo(1440, 8);
    for (const value of [NaN, Infinity, 0, 24, 2001]) expect(() => pageDimensions('custom', false, value, 297)).toThrow();
  });
  it('serializes a blank landscape A4 PDF with the requested dimensions', async () => {
    const dimensions = pageDimensions('a4', true, 0, 0);
    const document = await PDFDocument.create();
    document.addPage([dimensions.width, dimensions.height]);
    const reopened = await PDFDocument.load(await document.save());
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.getPage(0).getWidth()).toBeCloseTo(841.89, 2);
    expect(reopened.getPage(0).getHeight()).toBeCloseTo(595.28, 2);
  });
});
describe('page fit zoom', () => {
  it('chooses limiting dimension for whole-page fit and independent axis fits', () => {
    expect(fitZoom('page', 600, 800, 900, 400)).toBe(.5);
    expect(fitZoom('width', 600, 800, 900, 400)).toBe(1.5);
    expect(fitZoom('height', 600, 800, 900, 400)).toBe(.5);
  });
  it('handles hidden stages and clamps native supported zoom', () => {
    expect(fitZoom('page', 600, 800, 0, 400)).toBeNull();
    expect(fitZoom('width', 10, 10, 1000, 1000)).toBe(6);
    expect(fitZoom('height', 600, 2000, 200, 100)).toBe(.05);
    expect(fitZoom('height', 600, 2000, 200, 1)).toBe(.01);
  });
  it('fits a maximum-size custom page within a 650px workspace', () => {
    const page = pageDimensions('custom', false, 2000, 2000);
    const zoom = fitZoom('page', page.width, page.height, 650, 650)!;
    expect(zoom).toBeLessThan(.2);
    expect(page.width * zoom).toBeLessThanOrEqual(650);
    expect(page.height * zoom).toBeLessThanOrEqual(650);
  });
});
