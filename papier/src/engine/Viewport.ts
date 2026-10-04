import type { BBox } from '../core/model/types';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;

/**
 * Passage monde (points) ↔ écran (pixels CSS) :
 *   écran = monde × zoom + pan
 */
export class Viewport {
  zoom = 1;
  panX = 0;
  panY = 0;
  /** Taille de la zone d'affichage en pixels CSS. */
  width = 1;
  height = 1;
  dpr = 1;

  toScreen(x: number, y: number): [number, number] {
    return [x * this.zoom + this.panX, y * this.zoom + this.panY];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  /** Rectangle visible en coordonnées monde. */
  visibleWorld(): BBox {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.width, this.height);
    return [x0, y0, x1, y1];
  }

  /** Zoom autour d'un point écran qui reste fixe. */
  zoomAt(factor: number, sx: number, sy: number) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = next;
    this.panX = sx - wx * next;
    this.panY = sy - wy * next;
  }

  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
  }

  /** Garde le contenu atteignable : centré s'il est plus étroit que l'écran, jamais perdu hors champ. */
  clamp(content: BBox) {
    const [minX, minY, maxX, maxY] = content;
    const cw = (maxX - minX) * this.zoom;
    if (cw <= this.width) {
      this.panX = this.width / 2 - ((minX + maxX) / 2) * this.zoom;
    } else {
      const margin = this.width * 0.25;
      this.panX = Math.min(margin - minX * this.zoom, Math.max(this.width - margin - maxX * this.zoom, this.panX));
    }
    const margin = this.height * 0.5;
    this.panY = Math.min(margin - minY * this.zoom, Math.max(this.height - margin - maxY * this.zoom, this.panY));
  }
}
