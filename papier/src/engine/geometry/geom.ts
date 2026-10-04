import type { BBox, Mat2D } from '../../core/model/types';
import { POINT_STRIDE } from '../../core/model/pointCodec';

export function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function distSegSeg(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distPointSeg(ax, ay, cx, cy, dx, dy),
    distPointSeg(bx, by, cx, cy, dx, dy),
    distPointSeg(cx, cy, ax, ay, bx, by),
    distPointSeg(dx, dy, ax, ay, bx, by),
  );
}

export function applyMat(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Applique une transformation aux points (pas 4), renvoie une copie. */
export function transformPoints(pts: Float32Array, m: Mat2D): Float32Array {
  const out = pts.slice();
  for (let i = 0; i < out.length; i += POINT_STRIDE) {
    const [x, y] = applyMat(m, pts[i], pts[i + 1]);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

export function pointsBBox(pts: Float32Array, margin = 0): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += POINT_STRIDE) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return [0, 0, 0, 0];
  return [minX - margin, minY - margin, maxX + margin, maxY + margin];
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

/** Composition m ∘ t : applique d'abord t, puis m. */
export function multiplyMat(m: Mat2D, t: Mat2D): Mat2D {
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

export function invertMat(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function translateMat(dx: number, dy: number): Mat2D {
  return [1, 0, 0, 1, dx, dy];
}

/** Homothétie de rapport s centrée sur (cx, cy). */
export function scaleAboutMat(s: number, cx: number, cy: number): Mat2D {
  return [s, 0, 0, s, cx - s * cx, cy - s * cy];
}

/** Test pair-impair : le point est-il dans le polygone [x0, y0, x1, y1, …] ? */
export function pointInPolygon(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1];
    const xj = poly[j * 2], yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Proportion des points du trait (pas 4) situés dans le polygone (échantillonnée). */
export function fractionInside(pts: Float32Array, poly: ArrayLike<number>, maxSamples = 64): number {
  const n = pts.length / POINT_STRIDE;
  if (!n) return 0;
  const step = Math.max(1, Math.floor(n / maxSamples));
  let inside = 0;
  let total = 0;
  for (let i = 0; i < n; i += step) {
    total++;
    if (pointInPolygon(pts[i * POINT_STRIDE], pts[i * POINT_STRIDE + 1], poly)) inside++;
  }
  return inside / total;
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  const out: BBox = [...boxes[0]];
  for (const b of boxes) {
    out[0] = Math.min(out[0], b[0]);
    out[1] = Math.min(out[1], b[1]);
    out[2] = Math.max(out[2], b[2]);
    out[3] = Math.max(out[3], b[3]);
  }
  return out;
}

/** Rotation d'angle `a` (radians) autour de (cx, cy). */
export function rotateAboutMat(a: number, cx: number, cy: number): Mat2D {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
