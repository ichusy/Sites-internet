import type { BoxElement } from '../../core/model/types';
import { POINT_STRIDE } from '../../core/model/pointCodec';
import { applyMat, distPointSeg, invertMat } from '../geometry/geom';
import { isBox, strokeHalfWidth, type PageScene, type RenderItem } from '../scene';

/** Le point (repère de la page) est-il dans le rectangle (transformé) de l'élément, à `tol` près ? */
export function insideBox(item: RenderItem, x: number, y: number, tol = 0): boolean {
  const el = item.el as BoxElement;
  const [u, v] = applyMat(invertMat(item.matrix!), x, y);
  return u >= el.x - tol && u <= el.x + el.width + tol && v >= el.y - tol && v <= el.y + el.height + tol;
}

/** Élément le plus haut sous le point : boîtes (texte, image, post-it) ou traits (boîte englobante). */
export function topItemAt(scene: PageScene, x: number, y: number, accept: (item: RenderItem) => boolean = () => true): RenderItem | null {
  const hits = scene.query([x - 1, y - 1, x + 1, y + 1]).sort((a, b) => b.z - a.z);
  for (const item of hits) {
    if (!accept(item)) continue;
    if (isBox(item.el) ? insideBox(item, x, y, 2) : item.el.type === 'stroke') return item;
  }
  return null;
}

export function centerOfItem(item: RenderItem): [number, number] {
  const b = item.bbox;
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}


/**
 * Élément le plus haut touché en (x, y) (repère de la page) : intérieur d'une boîte, ou
 * distance au tracé d'un trait ou d'un connecteur inférieure à `tol` + demi-épaisseur.
 */
export function pickAt(scene: PageScene, x: number, y: number, tol: number): string[] {
  const hits = scene.query([x - tol, y - tol, x + tol, y + tol]).sort((a, b) => b.z - a.z);
  for (const item of hits) {
    if (isBox(item.el)) {
      if (insideBox(item, x, y, tol)) return [item.id];
      continue;
    }
    const pts = item.pts;
    const thr = tol + strokeHalfWidth(item.el);
    const n = pts.length / POINT_STRIDE;
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const j = k * POINT_STRIDE;
      const e = Math.min(k + 1, n - 1) * POINT_STRIDE;
      if (distPointSeg(x, y, pts[j], pts[j + 1], pts[e], pts[e + 1]) <= thr) return [item.id];
    }
  }
  return [];
}
