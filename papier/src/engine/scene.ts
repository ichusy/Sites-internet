import RBush from 'rbush';
import { decodePoints } from '../core/model/pointCodec';
import type { BBox, ID, PageData, PageElement, StrokeElement } from '../core/model/types';
import { pointsBBox, transformPoints } from './geometry/geom';
import { centerlinePath, outlinePath } from './ink/brushes';

/** Élément prêt à dessiner : points décodés en coordonnées de page, contour mis en cache. */
export interface RenderItem {
  id: ID;
  z: number;
  el: StrokeElement;
  /** Points [x, y, p, t] en coordonnées de page (transformation appliquée). */
  pts: Float32Array;
  bbox: BBox;
  /** Chemin calculé à la demande. */
  path?: Path2D;
}

interface TreeEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  item: RenderItem;
}

export function strokeHalfWidth(el: StrokeElement): number {
  const factor = el.brush === 'brush' ? 1.2 : el.brush === 'fountain' ? 0.8 : 0.5;
  return el.tool === 'highlighter' ? el.width / 2 : el.width * factor;
}

export function makeItem(el: PageElement): RenderItem {
  let pts = decodePoints(el.points);
  if (el.transform) pts = transformPoints(pts, el.transform);
  return { id: el.id, z: el.z, el, pts, bbox: pointsBBox(pts, strokeHalfWidth(el) + 1) };
}

export function itemPath(item: RenderItem): Path2D {
  if (!item.path) {
    const el = item.el;
    item.path =
      el.tool === 'highlighter' || el.dash !== 'solid'
        ? centerlinePath(item.pts)
        : outlinePath(item.pts, el.brush, el.width, el.pressure, true);
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
    if (!existed && item.z >= this.maxZ && item.el.tool !== 'highlighter' && this.dirty !== 'full') {
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
