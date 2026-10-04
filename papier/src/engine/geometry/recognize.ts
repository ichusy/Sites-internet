import { POINT_STRIDE } from '../../core/model/pointCodec';
import type { ShapeKind } from '../../core/model/types';
import { distPointSeg } from './geom';

export type Pt = [number, number];

export interface RecognizedShape {
  kind: ShapeKind;
  vertices: Pt[];
  closed: boolean;
}

function toPts(pts: Float32Array): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += POINT_STRIDE) out.push([pts[i], pts[i + 1]]);
  return out;
}

function pathLength(p: Pt[]) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

function diag(p: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/** Rééchantillonne le tracé à pas constant le long de la courbe. */
export function resample(p: Pt[], step: number): Pt[] {
  if (p.length < 2 || step <= 0) return p.slice();
  const out: Pt[] = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    let [ax, ay] = p[i - 1];
    const [bx, by] = p[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      ax += (bx - ax) * t;
      ay += (by - ay) * t;
      out.push([ax, ay]);
      seg = Math.hypot(bx - ax, by - ay);
      acc = 0;
    }
    acc += seg;
  }
  const last = p[p.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.3) out.push(last);
  return out;
}

/** Douglas-Peucker sur une polyligne ouverte. */
function simplify(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p.slice();
  let maxD = 0, idx = 0;
  const [a, b] = [p[0], p[p.length - 1]];
  for (let i = 1; i < p.length - 1; i++) {
    const d = distPointSeg(p[i][0], p[i][1], a[0], a[1], b[0], b[1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [a, b];
  const left = simplify(p.slice(0, idx + 1), eps);
  return [...left.slice(0, -1), ...simplify(p.slice(idx), eps)];
}

/** Simplification d'une courbe fermée : coupée au point le plus éloigné du départ. */
function simplifyClosed(p: Pt[], eps: number): Pt[] {
  let far = 0, best = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(p.slice(0, far + 1), eps);
  const b = simplify([...p.slice(far), p[0]], eps);
  let verts = [...a.slice(0, -1), ...b.slice(0, -1)];
  // Retire les sommets presque alignés (angle > 155°).
  let changed = true;
  while (changed && verts.length > 3) {
    changed = false;
    for (let i = 0; i < verts.length; i++) {
      const prev = verts[(i + verts.length - 1) % verts.length];
      const cur = verts[i];
      const next = verts[(i + 1) % verts.length];
      if (angleAt(prev, cur, next) > (155 * Math.PI) / 180) {
        verts = verts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return verts;
}

function angleAt(a: Pt, b: Pt, c: Pt) {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function polygonError(p: Pt[], verts: Pt[]) {
  let sum = 0;
  for (const [x, y] of p) {
    let best = Infinity;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      best = Math.min(best, distPointSeg(x, y, a[0], a[1], b[0], b[1]));
    }
    sum += best;
  }
  return sum / p.length;
}

/** Aimante un angle (radians) sur les multiples de 90° s'il en est proche. */
function snapAngle(theta: number, tolDeg: number) {
  const q = Math.PI / 2;
  const snapped = Math.round(theta / q) * q;
  return Math.abs(theta - snapped) < (tolDeg * Math.PI) / 180 ? snapped : theta;
}

function fitEllipse(p: Pt[]) {
  const n = p.length;
  let cx = 0, cy = 0;
  for (const [x, y] of p) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of p) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(theta), s = Math.sin(theta);
  let vu = 0, vv = 0;
  for (const [x, y] of p) {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    vu += u * u;
    vv += v * v;
  }
  // Pour des points répartis uniformément sur une ellipse, variance = rayon² / 2.
  const a = Math.sqrt((2 * vu) / n);
  const b = Math.sqrt((2 * vv) / n);
  let err = 0;
  for (const [x, y] of p) {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    err += Math.abs(Math.hypot(u / (a || 1), v / (b || 1)) - 1);
  }
  return { cx, cy, a, b, theta, err: err / n };
}

function ellipseVertices(cx: number, cy: number, a: number, b: number, theta: number, steps = 72): Pt[] {
  const c = Math.cos(theta), s = Math.sin(theta);
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const u = a * Math.cos(t), v = b * Math.sin(t);
    out.push([cx + u * c - v * s, cy + u * s + v * c]);
  }
  return out;
}

/** Rectangle aligné sur l'orientation `theta` englobant les sommets. */
function rectFrom(verts: Pt[], theta: number): Pt[] {
  const c = Math.cos(theta), s = Math.sin(theta);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, y] of verts) {
    const u = x * c + y * s;
    const v = -x * s + y * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const back = (u: number, v: number): Pt => [u * c - v * s, u * s + v * c];
  return [back(minU, minV), back(maxU, minV), back(maxU, maxV), back(minU, maxV)];
}

/**
 * Reconnaît une ligne, une ellipse/cercle, un rectangle, un triangle ou un polygone
 * dans un tracé à main levée. Renvoie null si rien ne correspond franchement.
 */
export function recognizeShape(raw: Float32Array): RecognizedShape | null {
  const input = toPts(raw);
  if (input.length < 3) return null;
  const D = diag(input);
  if (D < 8) return null;
  const p = resample(input, D / 64);
  const L = pathLength(p);
  const first = p[0], last = p[p.length - 1];

  // Ligne droite : tous les points proches du segment extrémités.
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (chord > D * 0.8) {
    let dev = 0;
    for (const [x, y] of p) dev = Math.max(dev, distPointSeg(x, y, first[0], first[1], last[0], last[1]));
    if (dev < Math.max(chord * 0.07, 2) && L < chord * 1.3) {
      const len = chord;
      const theta = snapAngle(Math.atan2(last[1] - first[1], last[0] - first[0]), 6);
      const end: Pt = [first[0] + Math.cos(theta) * len, first[1] + Math.sin(theta) * len];
      return { kind: 'line', vertices: [first, end], closed: false };
    }
  }

  // Formes fermées uniquement au-delà.
  if (chord > Math.max(D * 0.3, L * 0.18)) return null;
  const loop = resample([...input, input[0]], D / 64);
  const ell = fitEllipse(loop);
  const verts = simplifyClosed(loop, D * 0.06);
  const polyErr = polygonError(loop, verts) / D;
  const k = verts.length;

  if (k >= 3 && k <= 6 && polyErr < 0.03 && polyErr * 3 < ell.err) {
    if (k === 3) return { kind: 'triangle', vertices: verts, closed: true };
    if (k === 4) {
      const angles = verts.map((v, i) => angleAt(verts[(i + 3) % 4], v, verts[(i + 1) % 4]));
      if (angles.every((a) => Math.abs(a - Math.PI / 2) < (18 * Math.PI) / 180)) {
        // Orientation : arête la plus longue, aimantée sur les axes.
        let best = 0, theta = 0;
        for (let i = 0; i < 4; i++) {
          const a = verts[i], b = verts[(i + 1) % 4];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len > best) {
            best = len;
            theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
          }
        }
        return { kind: 'rect', vertices: rectFrom(verts, snapAngle(theta, 8)), closed: true };
      }
    }
    return { kind: 'polygon', vertices: verts, closed: true };
  }
  if (ell.err < 0.09) {
    let { a, b, theta } = ell;
    if (Math.min(a, b) / Math.max(a, b) > 0.85) a = b = (a + b) / 2;
    theta = snapAngle(theta, 8);
    return { kind: 'ellipse', vertices: ellipseVertices(ell.cx, ell.cy, a, b, theta), closed: true };
  }
  if (k >= 3 && k <= 8 && polyErr < 0.04) return { kind: k === 3 ? 'triangle' : 'polygon', vertices: verts, closed: true };
  return null;
}

/**
 * Gribouillis : tracé compact avec de nombreux allers-retours.
 * Sert au geste « gribouiller par-dessus pour effacer ».
 */
export function isScribble(raw: Float32Array): boolean {
  const input = toPts(raw);
  if (input.length < 8) return false;
  const D = diag(input);
  if (D < 6) return false;
  const p = resample(input, D / 30);
  const L = pathLength(p);
  if (L < D * 3) return false;
  let reversals = 0;
  for (let i = 2; i < p.length - 2; i++) {
    const v1 = [p[i][0] - p[i - 2][0], p[i][1] - p[i - 2][1]];
    const v2 = [p[i + 2][0] - p[i][0], p[i + 2][1] - p[i][1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
    if (cos < -0.5) {
      reversals++;
      i += 2; // un même rebroussement ne compte qu'une fois
    }
  }
  return reversals >= 4;
}

/** Enveloppe convexe (chaîne monotone), renvoyée à plat [x0, y0, x1, y1, …]. */
export function convexHull(raw: Float32Array): number[] {
  const p = toPts(raw).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p.flat();
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
}

/** Le tracé est-il une boucle fermée (pour « entourer puis toucher ») ? */
export function isClosedLoop(raw: Float32Array): boolean {
  const p = toPts(raw);
  if (p.length < 8) return false;
  const D = diag(p);
  const gap = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
  return D > 20 && gap < D * 0.25 && pathLength(p) > D * 2;
}
