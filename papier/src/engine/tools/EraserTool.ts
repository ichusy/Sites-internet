import { addElements, removeElements } from '../../core/model/notebookDoc';
import { newId } from '../../core/model/ids';
import { encodePoints } from '../../core/model/pointCodec';
import type { ID, StrokeElement } from '../../core/model/types';
import { splitStroke, strokeHit, type EraserSweep } from '../geometry/erase';
import { pointsBBox } from '../geometry/geom';
import { intersectsRect } from '../layout';
import { strokeHalfWidth } from '../scene';
import type { Tool, ToolContext, ToolInput } from './types';

/** Gomme : par trait entier ou partielle. Tout un geste = une seule étape d'annulation. */
export class EraserTool implements Tool {
  private last: ToolInput | null = null;

  constructor(private ctx: ToolContext) {}

  down(i: ToolInput) {
    this.ctx.beginAction();
    this.last = i;
    this.sweep(i, i);
    this.hover(i);
  }

  move(points: ToolInput[]) {
    if (!this.last) return;
    for (const p of points) {
      this.sweep(this.last, p);
      this.last = p;
    }
    this.hover(this.last);
  }

  up(i: ToolInput) {
    this.last = null;
    this.hover(i);
  }

  cancel() {
    this.last = null;
  }

  hover(i: ToolInput | null) {
    const r = this.ctx.renderer;
    // Au doigt, le curseur n'est visible que pendant l'effacement.
    const show = i && (i.pointerType !== 'touch' || this.last);
    r.cursor = show ? { x: i.sx, y: i.sy, r: this.ctx.styles.eraser.size / 2 } : null;
    r.invalidateWet();
  }

  private sweep(a: ToolInput, b: ToolInput) {
    const { styles, viewport } = this.ctx;
    const r = styles.eraser.size / 2 / viewport.zoom;
    const minX = Math.min(a.x, b.x) - r, maxX = Math.max(a.x, b.x) + r;
    const minY = Math.min(a.y, b.y) - r, maxY = Math.max(a.y, b.y) + r;

    for (const l of this.ctx.layouts()) {
      if (!intersectsRect(l, minX, minY, maxX, maxY)) continue;
      const scene = this.ctx.scene(l.id);
      if (!scene) continue;
      const s: EraserSweep = { ax: a.x - l.x, ay: a.y - l.y, bx: b.x - l.x, by: b.y - l.y, r };
      const candidates = scene.query([minX - l.x, minY - l.y, maxX - l.x, maxY - l.y]);
      const removed: ID[] = [];
      const added: StrokeElement[] = [];

      for (const item of candidates) {
        // La gomme n'agit que sur l'encre et les connecteurs (effacés en entier) ;
        // texte, images et post-its se suppriment au lasso.
        if (item.el.type === 'connector') {
          if (strokeHit(item.pts, strokeHalfWidth(item.el), s)) removed.push(item.id);
          continue;
        }
        if (item.el.type !== 'stroke') continue;
        const hw = strokeHalfWidth(item.el);
        if (styles.eraser.mode === 'stroke') {
          if (strokeHit(item.pts, hw, s)) removed.push(item.id);
          continue;
        }
        const pieces = splitStroke(item.pts, hw, s);
        if (!pieces) continue;
        removed.push(item.id);
        const { transform: _t, closed: _c, ...base } = item.el;
        pieces.forEach((pts, k) => {
          const el: StrokeElement = {
            ...base,
            id: newId(),
            z: item.el.z + (k + 1) * 1e-6,
            points: encodePoints(pts),
            bbox: pointsBBox(pts, hw + 1),
          };
          added.push(el);
        });
      }

      if (removed.length || added.length) {
        this.ctx.transact((doc) => {
          removeElements(doc, l.id, removed);
          addElements(doc, l.id, added);
        });
      }
    }
  }
}
