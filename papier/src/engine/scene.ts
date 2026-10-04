import RBush from 'rbush';
import { decodePoints } from '../core/model/pointCodec';
import type { BBox, ID, Mat2D, PageData, PageElement, StrokeElement } from '../core/model/types';
import { applyMat, IDENTITY, pointsBBox, transformPoints } from './geometry/geom';
import { centerlinePath, outlinePath, polylinePath } from './ink/brushes';

/** Élément prêt à dessiner : géométrie en coordonnées de page, chemins mis en cache. */
export interface RenderItem {
  id: ID;
  z: number;
  el: PageElement;
  /**
   * Points [x, y, p, t] en coordonnées de page (transformation appliquée).
   * Texte et images : les 4 coins puis le centre (pour le lasso).
   */
  pts: Float32Array;
  bbox: BBox;
  /** Texte et images : transformation du rectangle local vers la page. */
  matrix?: Mat2D;
  /** Chemin calculé à la demande (traits). */
  path?: Path2D;
  /** Lignes de texte calculées à la demande. */
  lines?: string[];
}

interface TreeEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  item: RenderItem;
}

export function strokeHalfWidth(el: PageElement): number {
  if (el.type !== 'stroke') return 0;
  if (el.tool === 'highlighter' || el.shape || el.dash !== 'solid') return el.width / 2;
  if (el.tool === 'pencil') return el.width * 0.6;
  const factor = el.brush === 'brush' ? 1.2 : el.brush === 'fountain' ? 0.8 : 0.5;
  return el.width * factor;
}

/** Le trait se dessine-t-il comme une ligne médiane (et non comme un contour rempli) ? */
export function isCenterline(el: StrokeElement) {
  return el.tool === 'highlighter' || el.dash !== 'solid' || !!el.shape;
}

export function makeItem(el: PageElement): RenderItem {
  if (el.type === 'stroke') {
    let pts = decodePoints(el.points);
    if (el.transform) pts = transformPoints(pts, el.transform);
    return { id: el.id, z: el.z, el, pts, bbox: pointsBBox(pts, strokeHalfWidth(el) + 1) };
  }
  const m = el.transform ?? IDENTITY;
  const corners: [number, number][] = [
    [el.x, el.y], [el.x + el.width, el.y], [el.x + el.width, el.y + el.height], [el.x, el.y + el.height],
    [el.x + el.width / 2, el.y + el.height / 2],
  ];
  const pts = new Float32Array(corners.length * 4);
  corners.forEach(([x, y], i) => {
    const [tx, ty] = applyMat(m, x, y);
    pts[i * 4] = tx;
    pts[i * 4 + 1] = ty;
    pts[i * 4 + 2] = 0.5;
  });
  return { id: el.id, z: el.z, el, pts, bbox: pointsBBox(pts.subarray(0, 16), 1), matrix: m };
}

export function itemPath(item: RenderItem): Path2D {
  const el = item.el;
  if (el.type !== 'stroke') return new Path2D();
  if (!item.path) {
    item.path = el.shape
      ? polylinePath(item.pts, !!el.closed)
      : isCenterline(el)
        ? centerlinePath(item.pts)
        : outlinePath(item.pts, el, true);
  }
  return item.path;
}

/**
 * État de rendu d'une page, alimenté par les événements Yjs.
 * `dirty` indique au moteur de rendu ce qu'il doit refaire dans son cache :
 *   - 'append' : seulement dessiner `pending` par-dessus (cas courant : un nouveau trait d'encre),
 *   - 'full'   : tout redessiner (suppression, modification, surligneur, changement de modèle).
 */
export class PageScene {
  readonly items = new Map<ID, RenderItem>();
  private tree = new RBush<TreeEntry>();
  private entries = new Map<ID, TreeEntry>();
  private sortedCache: RenderItem[] | null = null;
  private maxZ = -Infinity;
  dirty: 'clean' | 'append' | 'full' = 'full';
  pending: RenderItem[] = [];
  /** Incrémenté à chaque changement (miniatures). */
  version = 0;
  /** Éléments masqués du rendu principal (en cours de déplacement par le lasso). */
  hidden = new Set<ID>();

  constructor(public page: PageData) {}

  load(elements: Iterable<PageElement>) {
    this.items.clear();
    this.entries.clear();
    this.tree.clear();
    const bulk: TreeEntry[] = [];
    for (const el of elements) {
      const item = makeItem(el);
      this.items.set(item.id, item);
      const entry = this.entryFor(item);
      this.entries.set(item.id, entry);
      bulk.push(entry);
    }
    this.tree.load(bulk);
    this.maxZ = -Infinity;
    for (const item of this.items.values()) if (item.z > this.maxZ) this.maxZ = item.z;
    this.markFull();
  }

  upsert(el: PageElement) {
    const existed = this.items.has(el.id);
    if (existed) this.removeInternal(el.id);
    const item = makeItem(el);
    this.items.set(item.id, item);
    const entry = this.entryFor(item);
    this.entries.set(item.id, entry);
    this.tree.insert(entry);
    this.sortedCache = null;
    this.version++;
    // Ajout d'encre au sommet de la pile : simple ajout incrémental dans le cache.
    if (!existed && item.z >= this.maxZ && !isHighlight(item.el) && this.dirty !== 'full') {
      this.pending.push(item);
      this.dirty = 'append';
    } else {
      this.markFull();
    }
    this.maxZ = Math.max(this.maxZ, item.z);
  }

  remove(id: ID) {
    if (!this.items.has(id)) return;
    this.removeInternal(id);
    this.markFull();
    this.version++;
  }

  setPage(page: PageData) {
    this.page = page;
    this.markFull();
    this.version++;
  }

  markFull() {
    this.dirty = 'full';
    this.pending = [];
  }

  /** Éléments triés par z (ordre de dessin). */
  sorted(): RenderItem[] {
    if (!this.sortedCache) this.sortedCache = [...this.items.values()].sort((a, b) => a.z - b.z);
    return this.sortedCache;
  }

  /** Éléments triés, sans ceux masqués. */
  visible(): RenderItem[] {
    const all = this.sorted();
    return this.hidden.size ? all.filter((i) => !this.hidden.has(i.id)) : all;
  }

  setHidden(ids: Iterable<ID>) {
    this.hidden = new Set(ids);
    this.markFull();
  }

  query(b: BBox): RenderItem[] {
    return this.tree.search({ minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] }).map((e) => e.item);
  }

  private entryFor(item: RenderItem): TreeEntry {
    const [minX, minY, maxX, maxY] = item.bbox;
    return { minX, minY, maxX, maxY, item };
  }

  private removeInternal(id: ID) {
    const entry = this.entries.get(id);
    if (entry) this.tree.remove(entry);
    this.entries.delete(id);
    this.items.delete(id);
    this.sortedCache = null;
  }
}

export function isHighlight(el: PageElement) {
  return el.type === 'stroke' && el.tool === 'highlighter';
}
