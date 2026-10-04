import type { BBox } from '../../core/model/types';

export type P = [number, number];

/** Extrémité résolue : point libre, ou boîte de l'élément accroché. */
export interface ResolvedEnd {
  x: number;
  y: number;
  box?: BBox;
}

export interface ConnectorCurve {
  p0: P;
  c1: P;
  c2: P;
  p1: P;
}

/** Écart entre la boîte d'un élément et le début du connecteur. */
const GAP = 6;

function center(e: ResolvedEnd): P {
  return e.box ? [(e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2] : [e.x, e.y];
}

/**
 * Point d'attache sur la boîte : milieu du côté qui fait face à `toward`
 * (droite/gauche si l'écart horizontal domine, haut/bas sinon), ce qui donne
 * des liaisons nettes pour les cartes mentales.
 */
function anchor(e: ResolvedEnd, toward: P): { p: P; horizontal: boolean } {
  const c = center(e);
  const dx = toward[0] - c[0];
  const dy = toward[1] - c[1];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (!e.box) return { p: c, horizontal };
  const [x0, y0, x1, y1] = e.box;
  if (horizontal) return { p: [dx >= 0 ? x1 + GAP : x0 - GAP, c[1]], horizontal };
  return { p: [c[0], dy >= 0 ? y1 + GAP : y0 - GAP], horizontal };
}

/** Courbe de Bézier cubique entre deux extrémités (tangentes perpendiculaires aux côtés d'attache). */
export function connectorCurve(a: ResolvedEnd, b: ResolvedEnd): ConnectorCurve {
  const ca = center(a);
  const cb = center(b);
  const A = anchor(a, cb);
  const B = anchor(b, ca);
  const p0 = A.p;
  const p1 = B.p;
  const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const k = Math.min(dist * 0.5, 160);
  const dir = (from: P, to: P, horizontal: boolean): P =>
    horizontal ? [Math.sign(to[0] - from[0]) || 1, 0] : [0, Math.sign(to[1] - from[1]) || 1];
  // Extrémités libres : tangente dans l'axe dominant de la liaison.
  const da = a.box ? dir(ca, p0, A.horizontal) : dir(p0, p1, A.horizontal);
  const db = b.box ? dir(cb, p1, B.horizontal) : dir(p1, p0, B.horizontal);
  return { p0, c1: [p0[0] + da[0] * k, p0[1] + da[1] * k], c2: [p1[0] + db[0] * k, p1[1] + db[1] * k], p1 };
}

export function bezierPoint(c: ConnectorCurve, t: number): P {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c.p0[0] + b * c.c1[0] + d * c.c2[0] + e * c.p1[0], a * c.p0[1] + b * c.c1[1] + d * c.c2[1] + e * c.p1[1]];
}

/** Points échantillonnés le long de la courbe, au format des traits (pas 4). */
export function sampleCurve(c: ConnectorCurve, n = 24): Float32Array {
  const out = new Float32Array((n + 1) * 4);
  for (let i = 0; i <= n; i++) {
    const [x, y] = bezierPoint(c, i / n);
    out[i * 4] = x;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = 0.5;
  }
  return out;
}

/** Triangle de pointe de flèche en `tip`, orienté depuis `from`. */
export function arrowHead(tip: P, from: P, size: number): P[] {
  let dx = tip[0] - from[0];
  let dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const bx = tip[0] - dx * size;
  const by = tip[1] - dy * size;
  const w = size * 0.55;
  return [tip, [bx - dy * w, by + dx * w], [bx + dy * w, by - dx * w]];
}
