export interface MeasurementPoint { x: number; y: number }
export interface Calibration { pointsPerUnit: number; unit: string }
export interface Measurement { length: number; perimeter: number; area: number; unit: string; pointsPerUnit: number }
export interface MeasurementViewport { width: number; height: number; convertToPdfPoint(x: number, y: number): number[] }

/** Area/perimeter tools support simple polygons; crossing strokes have no unambiguous interior. */
export function assertSimpleMeasurementPolygon(input: readonly MeasurementPoint[]): void {
  if (input.length > 10000 || input.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('invalid-geometry');
  const points = input.filter((point, index) => index === 0 || point.x !== input[index - 1].x || point.y !== input[index - 1].y);
  if (points.length > 1 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop();
  if (points.length < 3 || points.length > 1000) throw new Error('invalid-geometry');
  const extent = Math.max(1, Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)));
  const epsilon = Number.EPSILON * 32 * extent * extent, linearEpsilon = Number.EPSILON * 32 * extent;
  const cross = (a: MeasurementPoint, b: MeasurementPoint, c: MeasurementPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a: MeasurementPoint, b: MeasurementPoint, p: MeasurementPoint) => Math.abs(cross(a, b, p)) <= epsilon && p.x >= Math.min(a.x, b.x) - linearEpsilon && p.x <= Math.max(a.x, b.x) + linearEpsilon && p.y >= Math.min(a.y, b.y) - linearEpsilon && p.y <= Math.max(a.y, b.y) + linearEpsilon;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += cross(points[0], a, b);
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      if (((abC > epsilon && abD < -epsilon || abC < -epsilon && abD > epsilon) && (cdA > epsilon && cdB < -epsilon || cdA < -epsilon && cdB > epsilon)) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) throw new Error('invalid-geometry');
    }
  }
  if (Math.abs(twiceArea) <= epsilon) throw new Error('invalid-geometry');
}

/** Coordinates are physical PDF points (1/72 inch); calibration is always explicit. */
export function measureGeometry(points: readonly MeasurementPoint[], calibration: Calibration): Measurement {
  if (points.length < 2 || points.length > 10000 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !Number.isFinite(calibration.pointsPerUnit) || calibration.pointsPerUnit <= 0 || !calibration.unit.trim() || calibration.unit.length > 30 || /[\p{Cc}\p{Cf}]/u.test(calibration.unit)) throw new Error('invalid-calibration');
  let length = 0, twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (i + 1 < points.length) length += Math.hypot(b.x - a.x, b.y - a.y);
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const closure = Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y), scale = calibration.pointsPerUnit;
  const result = { length: length / scale, perimeter: (length + closure) / scale, area: Math.abs(twiceArea) / (2 * scale * scale), unit: calibration.unit.trim(), pointsPerUnit: scale };
  if ([result.length,result.perimeter,result.area].some(value => !Number.isFinite(value))) throw new Error('invalid-calibration');
  return result;
}

/** PDF.js reverses CropBox/rotation/zoom; multiply raw user-space coordinates by UserUnit exactly once. */
export function mapMeasurementPoints(points: readonly MeasurementPoint[], viewport: MeasurementViewport, userUnit: number): MeasurementPoint[] {
  if (!Number.isFinite(userUnit) || userUnit <= 0 || !Number.isFinite(viewport.width) || viewport.width <= 0 || !Number.isFinite(viewport.height) || viewport.height <= 0 || points.length > 10000) throw new Error('invalid-geometry');
  return points.map(point => {
    if (![point.x,point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('invalid-geometry');
    const [x,y] = viewport.convertToPdfPoint(point.x * viewport.width, point.y * viewport.height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('invalid-geometry');
    return { x: x * userUnit, y: y * userUnit };
  });
}
