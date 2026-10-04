import { POINT_STRIDE } from '../../core/model/pointCodec';
import { distPointSeg, distSegSeg } from './geom';

/** Segment parcouru par la gomme entre deux événements, avec son rayon. */
export interface EraserSweep {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

/** Le trait (points à pas 4, demi-épaisseur hw) est-il touché par la gomme ? */
export function strokeHit(pts: Float32Array, hw: number, s: EraserSweep): boolean {
  const thr = s.r + hw;
  const n = pts.length / POINT_STRIDE;
  if (n === 1) return distPointSeg(pts[0], pts[1], s.ax, s.ay, s.bx, s.by) <= thr;
  for (let i = 0; i < n - 1; i++) {
    const j = i * POINT_STRIDE;
    const k = j + POINT_STRIDE;
    if (distSegSeg(pts[j], pts[j + 1], pts[k], pts[k + 1], s.ax, s.ay, s.bx, s.by) <= thr) return true;
  }
  return false;
}

/** Ajoute des points intermédiaires pour qu'aucun segment ne dépasse `maxStep`. */
export function densify(pts: Float32Array, maxStep: number): Float32Array {
  const n = pts.length / POINT_STRIDE;
  if (n < 2 || maxStep <= 0) return pts;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = i * POINT_STRIDE;
    if (i > 0) {
      const h = j - POINT_STRIDE;
      const len = Math.hypot(pts[j] - pts[h], pts[j + 1] - pts[h + 1]);
      const steps = Math.ceil(len / maxStep);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        for (let c = 0; c < POINT_STRIDE; c++) out.push(pts[h + c] + (pts[j + c] - pts[h + c]) * t);
      }
    }
    for (let c = 0; c < POINT_STRIDE; c++) out.push(pts[j + c]);
  }
  return Float32Array.from(out);
}

/**
 * Gomme partielle : renvoie les morceaux restants du trait, ou null s'il n'est pas touché.
 * Un tableau vide signifie que le trait est entièrement effacé.
 */
export function splitStroke(pts: Float32Array, hw: number, s: EraserSweep): Float32Array[] | null {
  if (!strokeHit(pts, hw, s)) return null;
  const dense = densify(pts, Math.max(s.r * 0.5, 0.5));
  const n = dense.length / POINT_STRIDE;
  const thr = s.r + hw * 0.5;
  const keep = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const j = i * POINT_STRIDE;
    keep[i] = distPointSeg(dense[j], dense[j + 1], s.ax, s.ay, s.bx, s.by) > thr;
  }
  const pieces: Float32Array[] = [];
  let start = -1;
  let cut = false;
  const flush = (end: number) => {
    if (end < n) cut = true;
    if (start >= 0 && end - start >= 2) {
      pieces.push(dense.slice(start * POINT_STRIDE, end * POINT_STRIDE));
    }
    start = -1;
  };
  for (let i = 0; i < n; i++) {
    if (!keep[i]) {
      flush(i);
      continue;
    }
    if (start < 0) start = i;
    // Coupure si le segment suivant traverse la gomme alors que ses deux extrémités sont gardées.
    if (i + 1 < n && keep[i + 1]) {
      const j = i * POINT_STRIDE;
      const k = j + POINT_STRIDE;
      if (distSegSeg(dense[j], dense[j + 1], dense[k], dense[k + 1], s.ax, s.ay, s.bx, s.by) <= thr) {
        flush(i + 1);
      }
    }
  }
  flush(n);
  return cut ? pieces : null;
}
