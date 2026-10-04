import type { BoxElement } from '../../core/model/types';
import { applyMat, invertMat } from '../geometry/geom';
import { isBox, type PageScene, type RenderItem } from '../scene';

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

