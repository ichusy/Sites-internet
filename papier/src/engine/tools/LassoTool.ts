import type { BBox, Mat2D } from '../../core/model/types';
import { distPointSeg, fractionInside, IDENTITY, scaleAboutMat, translateMat, unionBBox } from '../geometry/geom';
import { POINT_STRIDE } from '../../core/model/pointCodec';
import { drawItem } from '../render/draw';
import { pageAt, type PageLayout } from '../layout';
import { strokeHalfWidth, type PageScene } from '../scene';
import type { Selection, Tool, ToolContext, ToolInput } from './types';

/** Rayon de saisie des poignées, en pixels écran. */
const HANDLE_HIT = 16;
const HANDLE_SIZE = 9;
/** Un trait est sélectionné si au moins cette proportion de ses points est dans la boucle. */
const MIN_INSIDE = 0.5;
const ACCENT = '#3461c9';

type Mode =
  | { kind: 'idle' }
  | { kind: 'lasso'; page: PageLayout; pts: number[]; length: number }
  | { kind: 'move'; page: PageLayout; sel: Selection; x0: number; y0: number; m: Mat2D }
  | { kind: 'scale'; page: PageLayout; sel: Selection; ax: number; ay: number; d0: number; s: number; m: Mat2D };

/**
 * Lasso : entourer pour sélectionner (ou toucher un trait), puis glisser la
 * sélection pour la déplacer ou une poignée d'angle pour la redimensionner.
 */
export class LassoTool implements Tool {
  private mode: Mode = { kind: 'idle' };

  constructor(private ctx: ToolContext) {}

  /** Boîte englobante de la sélection, en coordonnées de page. */
  selectionBBox(sel: Selection | null = this.ctx.selection()): BBox | null {
    if (!sel) return null;
    const scene = this.ctx.scene(sel.pageId);
    if (!scene) return null;
    return unionBBox(sel.ids.map((id) => scene.items.get(id)?.bbox).filter((b): b is BBox => !!b));
  }

  /** Vrai pendant un déplacement ou un redimensionnement. */
  get dragging() {
    return this.mode.kind === 'move' || this.mode.kind === 'scale';
  }

  down(i: ToolInput) {
    const sel = this.ctx.selection();
    const bb = this.selectionBBox(sel);
    const page = sel && this.ctx.layouts().find((l) => l.id === sel.pageId);
    if (sel && bb && page) {
      const zoom = this.ctx.viewport.zoom;
      const lx = i.x - page.x;
      const ly = i.y - page.y;
      const corners: [number, number][] = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
      const hit = corners.findIndex(([cx, cy]) => Math.hypot(cx - lx, cy - ly) * zoom < HANDLE_HIT);
      if (hit >= 0) {
        const [ax, ay] = corners[(hit + 2) % 4];
        const d0 = Math.max(1e-3, Math.hypot(lx - ax, ly - ay));
        this.mode = { kind: 'scale', page, sel, ax, ay, d0, s: 1, m: IDENTITY };
        this.startDrag(sel);
        return;
      }
      const pad = 8 / zoom;
      if (lx >= bb[0] - pad && lx <= bb[2] + pad && ly >= bb[1] - pad && ly <= bb[3] + pad) {
        this.mode = { kind: 'move', page, sel, x0: lx, y0: ly, m: IDENTITY };
        this.startDrag(sel);
        return;
      }
    }
    this.ctx.setSelection(null);
    const target = pageAt(this.ctx.layouts(), i.x, i.y);
    this.mode = target ? { kind: 'lasso', page: target, pts: [i.x - target.x, i.y - target.y], length: 0 } : { kind: 'idle' };
    this.ctx.renderer.invalidateWet();
  }

  move(points: ToolInput[]) {
    const m = this.mode;
    if (m.kind === 'idle') return;
    const last = points[points.length - 1];
    const lx = last.x - m.page.x;
    const ly = last.y - m.page.y;
    if (m.kind === 'lasso') {
      for (const p of points) {
        const x = p.x - m.page.x, y = p.y - m.page.y;
        m.length += Math.hypot(x - m.pts[m.pts.length - 2], y - m.pts[m.pts.length - 1]);
        m.pts.push(x, y);
      }
    } else if (m.kind === 'move') {
      m.m = translateMat(lx - m.x0, ly - m.y0);
    } else {
      m.s = Math.max(0.05, Math.min(20, Math.hypot(lx - m.ax, ly - m.ay) / m.d0));
      m.m = scaleAboutMat(m.s, m.ax, m.ay);
    }
    this.ctx.renderer.invalidateWet();
  }

  up() {
    const m = this.mode;
    this.mode = { kind: 'idle' };
    if (m.kind === 'lasso') {
      this.finishLasso(m.page, m.pts, m.length);
    } else if (m.kind === 'move' || m.kind === 'scale') {
      const s = m.kind === 'scale' ? m.s : 1;
      const moved = m.m.some((v, k) => Math.abs(v - IDENTITY[k]) > 1e-6);
      this.ctx.scene(m.sel.pageId)?.setHidden([]);
      if (moved) this.ctx.transformSelection(m.m, s);
      this.ctx.renderer.invalidate();
    }
    this.ctx.renderer.invalidateWet();
  }

  cancel() {
    const m = this.mode;
    if (m.kind === 'move' || m.kind === 'scale') {
      this.ctx.scene(m.sel.pageId)?.setHidden([]);
      this.ctx.renderer.invalidate();
    }
    this.mode = { kind: 'idle' };
    this.ctx.renderer.invalidateWet();
  }

  private startDrag(sel: Selection) {
    this.ctx.scene(sel.pageId)?.setHidden(sel.ids);
    this.ctx.renderer.invalidate();
    this.ctx.renderer.invalidateWet();
  }

  private finishLasso(page: PageLayout, poly: number[], length: number) {
    const scene = this.ctx.scene(page.id);
    if (!scene) return;
    const zoom = this.ctx.viewport.zoom;
    let ids: string[];
    if (length * zoom < 6) {
      // Simple toucher : sélectionne le trait le plus haut sous le doigt / la pointe.
      ids = this.pickAt(scene, poly[0], poly[1], 8 / zoom);
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < poly.length; k += 2) {
        minX = Math.min(minX, poly[k]);
        maxX = Math.max(maxX, poly[k]);
        minY = Math.min(minY, poly[k + 1]);
        maxY = Math.max(maxY, poly[k + 1]);
      }
      ids = scene
        .query([minX, minY, maxX, maxY])
        .filter((item) => fractionInside(item.pts, poly) >= MIN_INSIDE)
        .sort((a, b) => a.z - b.z)
        .map((item) => item.id);
    }
    this.ctx.setSelection(ids.length ? { pageId: page.id, ids } : null);
  }

  private pickAt(scene: PageScene, x: number, y: number, tol: number): string[] {
    const hits = scene.query([x - tol, y - tol, x + tol, y + tol]).sort((a, b) => b.z - a.z);
    for (const item of hits) {
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

  /** Dessin sur le calque d'encre fraîche (pixels physiques). */
  drawOverlay(c: CanvasRenderingContext2D) {
    const vp = this.ctx.viewport;
    const target = vp.zoom * vp.dpr;
    const m = this.mode;
    const toPage = (page: PageLayout) =>
      c.setTransform(target, 0, 0, target, (page.x * vp.zoom + vp.panX) * vp.dpr, (page.y * vp.zoom + vp.panY) * vp.dpr);

    if (m.kind === 'lasso') {
      toPage(m.page);
      c.beginPath();
      for (let k = 0; k < m.pts.length; k += 2) (k ? c.lineTo : c.moveTo).call(c, m.pts[k], m.pts[k + 1]);
      c.closePath();
      c.fillStyle = 'rgba(52, 97, 201, 0.06)';
      c.fill();
      c.setLineDash([5 / vp.zoom, 4 / vp.zoom]);
      c.lineWidth = 1.5 / vp.zoom;
      c.strokeStyle = ACCENT;
      c.stroke();
      return;
    }

    const sel = this.ctx.selection();
    const page = sel && this.ctx.layouts().find((l) => l.id === sel.pageId);
    const scene = sel && this.ctx.scene(sel.pageId);
    const bb = this.selectionBBox(sel);
    if (!sel || !page || !scene || !bb) return;
    const dragM = m.kind === 'move' || m.kind === 'scale' ? m.m : IDENTITY;

    // Aperçu des éléments déplacés (masqués du calque principal pendant le geste).
    if (dragM !== IDENTITY) {
      toPage(page);
      c.transform(...dragM);
      for (const id of sel.ids) {
        const item = scene.items.get(id);
        if (item) drawItem(c, item);
      }
    }

    // Cadre et poignées, en pixels écran.
    const corners = [
      [bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]],
    ].map(([x, y]) => {
      const tx = dragM[0] * x + dragM[2] * y + dragM[4];
      const ty = dragM[1] * x + dragM[3] * y + dragM[5];
      return [((page.x + tx) * vp.zoom + vp.panX) * vp.dpr, ((page.y + ty) * vp.zoom + vp.panY) * vp.dpr];
    });
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.strokeStyle = ACCENT;
    c.lineWidth = 1.5 * vp.dpr;
    c.setLineDash([6 * vp.dpr, 4 * vp.dpr]);
    c.beginPath();
    corners.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = ACCENT;
    const h = HANDLE_SIZE * vp.dpr;
    for (const [x, y] of corners) c.fillRect(x - h / 2, y - h / 2, h, h);
  }
}
