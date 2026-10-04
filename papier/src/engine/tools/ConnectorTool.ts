import { addElements } from '../../core/model/notebookDoc';
import { newId, nextZ } from '../../core/model/ids';
import type { ConnectorElement, ConnectorEnd } from '../../core/model/types';
import { pageAt, type PageLayout } from '../layout';
import { drawItem } from '../render/draw';
import { makeItem, type RenderItem } from '../scene';
import { centerOfItem, topItemAt } from './boxHit';
import type { Tool, ToolContext, ToolInput } from './types';

/**
 * Connecteur : glisser d'un élément (post-it, texte, image, dessin) vers un autre pour les relier.
 * Partir ou arriver dans le vide crée une extrémité libre.
 */
export class ConnectorTool implements Tool {
  private page: PageLayout | null = null;
  private from: ConnectorEnd | null = null;
  private to: ConnectorEnd | null = null;
  private target: RenderItem | null = null;

  constructor(private ctx: ToolContext) {}

  private endAt(x: number, y: number): { end: ConnectorEnd; item: RenderItem | null } {
    const scene = this.ctx.scene(this.page!.id);
    const item = scene ? topItemAt(scene, x, y, (it) => it.el.type !== 'connector' && !(it.el.type === 'stroke' && it.el.tool === 'highlighter')) : null;
    if (!item) return { end: { x, y }, item: null };
    const [cx, cy] = centerOfItem(item);
    return { end: { id: item.id, x: cx, y: cy }, item };
  }

  down(i: ToolInput) {
    this.page = pageAt(this.ctx.layouts(), i.x, i.y) ?? null;
    if (!this.page) return;
    this.from = this.endAt(i.x - this.page.x, i.y - this.page.y).end;
    this.to = null;
  }

  move(points: ToolInput[]) {
    if (!this.page || !this.from) return;
    const p = points[points.length - 1];
    const { end, item } = this.endAt(p.x - this.page.x, p.y - this.page.y);
    // Pendant le tracé, l'extrémité suit le pointeur ; la cible éventuelle est mise en évidence.
    this.target = item && item.id !== this.from.id ? item : null;
    this.to = this.target ? end : { x: p.x - this.page.x, y: p.y - this.page.y };
    this.ctx.renderer.invalidateWet();
  }

  up() {
    const page = this.page;
    const from = this.from;
    const to = this.target ? this.to : this.to && { x: this.to.x, y: this.to.y };
    this.cancel();
    if (!page || !from || !to) return;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if ((from.id && from.id === to.id) || (!from.id && !to.id && len * this.ctx.viewport.zoom < 12)) return;
    const { color, width, arrow } = this.ctx.styles.connector;
    const el: ConnectorElement = {
      type: 'connector', id: newId(), z: nextZ(), bbox: [0, 0, 0, 0],
      from, to, color, width, arrow, dash: 'solid',
    };
    el.bbox = makeItem(el).bbox;
    this.ctx.beginAction();
    this.ctx.transact((doc) => addElements(doc, page.id, [el]));
  }

  cancel() {
    this.page = null;
    this.from = null;
    this.to = null;
    this.target = null;
    this.ctx.renderer.invalidateWet();
  }

  /** Aperçu du connecteur en cours et de la cible visée (pixels physiques). */
  drawOverlay(c: CanvasRenderingContext2D) {
    if (!this.page || !this.from || !this.to) return;
    const vp = this.ctx.viewport;
    const t = vp.zoom * vp.dpr;
    const scene = this.ctx.scene(this.page.id);
    c.setTransform(t, 0, 0, t, (this.page.x * vp.zoom + vp.panX) * vp.dpr, (this.page.y * vp.zoom + vp.panY) * vp.dpr);
    if (this.target) {
      const [x0, y0, x1, y1] = this.target.bbox;
      c.strokeStyle = 'rgba(52, 97, 201, 0.8)';
      c.lineWidth = 2 / vp.zoom;
      c.setLineDash([4 / vp.zoom, 3 / vp.zoom]);
      c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      c.setLineDash([]);
    }
    const { color, width, arrow } = this.ctx.styles.connector;
    const el: ConnectorElement = { type: 'connector', id: 'wet', z: 0, bbox: [0, 0, 0, 0], from: this.from, to: this.to, color, width, arrow, dash: 'solid' };
    drawItem(c, makeItem(el), null, undefined, (id) => scene?.items.get(id));
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}
