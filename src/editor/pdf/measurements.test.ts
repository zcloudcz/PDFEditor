// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'));
import { measureGeometry, mapMeasurementPoints, assertSimpleMeasurementPolygon } from './measurements';
import { getDocument } from 'pdfjs-dist';
import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

describe('explicitly calibrated measurements', () => {
  it('rejects crossed, overlapping and degenerate polygons rather than reporting misleading area', () => {
    expect(() => assertSimpleMeasurementPolygon([{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}])).toThrow();
    expect(() => assertSimpleMeasurementPolygon([{x:0,y:0},{x:10,y:0},{x:5,y:0},{x:5,y:10}])).toThrow();
    expect(() => assertSimpleMeasurementPolygon([{x:0,y:0},{x:5,y:0},{x:10,y:0}])).toThrow();
    expect(() => assertSimpleMeasurementPolygon([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:0}])).not.toThrow();
    expect(() => assertSimpleMeasurementPolygon([{x:0,y:0},{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}])).not.toThrow();
  });
  it('computes polyline length, closed perimeter and polygon area', () => {
    expect(measureGeometry([{x:0,y:0},{x:30,y:0},{x:30,y:40}], {pointsPerUnit:10,unit:'cm'})).toEqual({length:7,perimeter:12,area:6,unit:'cm',pointsPerUnit:10});
  });
  it('refuses missing calibration, invalid units and degenerate input', () => {
    for (const pointsPerUnit of [0,-1,NaN,Infinity]) expect(() => measureGeometry([{x:0,y:0},{x:1,y:1}],{pointsPerUnit,unit:'m'})).toThrow();
    expect(() => measureGeometry([{x:0,y:0}],{pointsPerUnit:1,unit:'m'})).toThrow();
    expect(() => measureGeometry([{x:0,y:0},{x:1,y:1}],{pointsPerUnit:1,unit:''})).toThrow();
  });
  it.each([0,90,180,270])('maps CropBox + UserUnit + rotation %s back to physical PDF points', async rotation => {
    const pdf=await PDFDocument.create(),page=pdf.addPage([300,400]);page.setCropBox(20,30,200,300);page.setRotation(degrees(rotation));page.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));
    const doc=await getDocument({data:await pdf.save()}).promise;
    const view = (await doc.getPage(1)).getViewport({scale:3});
    const source = [[40,60],[140,60]];
    const points = source.map(([x,y]) => { const point=view.convertToViewportPoint(x,y); return {x:point[0]/view.width,y:point[1]/view.height}; });
    const mapped = mapMeasurementPoints(points,view,2);
    expect(mapped[0].x).toBeCloseTo(80); expect(mapped[0].y).toBeCloseTo(120);
    expect(measureGeometry(mapped,{pointsPerUnit:20,unit:'cm'}).length).toBeCloseTo(10);await doc.destroy();
  });
});
