import type { TextElement } from '../../core/model/types';
import { applyMat, invertMat } from '../geometry/geom';
import { pageAt } from '../layout';
import type { Tool, ToolContext, ToolInput } from './types';
import { topItemAt } from './boxHit';
import { stickyEditRequest } from './StickyTool';

/** Largeur par défaut d'une nouvelle zone de texte (points). */
const DEFAULT_WIDTH = 320;

/**
 * Outil texte : toucher une zone existante pour la modifier, ou un endroit vide
 * pour en créer une (glisser horizontalement pour choisir sa largeur).
 */
export class TextTool implements Tool {
  private start: ToolInput | null = null;

  constructor(private ctx: ToolContext) {}

  down(i: ToolInput) {
    this.start = i;
  }

  move() {}

  cancel() {
    this.start = null;
  }

  up(i: ToolInput) {
    const s = this.start;
    this.start = null;
    if (!s) return;
    const page = pageAt(this.ctx.layouts(), s.x, s.y);
    if (!page) return;
    const lx = s.x - page.x;
    const ly = s.y - page.y;

    const scene = this.ctx.scene(page.id);
    const sticky = scene && topItemAt(scene, lx, ly, (it) => it.el.type === 'sticky');
    if (sticky?.el.type === 'sticky') {
      this.ctx.editText(stickyEditRequest(page.id, sticky.el));
      return;
    }

    const existing = this.hit(page.id, lx, ly);
    if (existing) {
      this.ctx.editText({
        pageId: page.id,
        id: existing.id,
        x: existing.x,
        y: existing.y,
        width: existing.width,
        fontSize: existing.fontSize,
        color: existing.color,
        text: existing.text,
        transform: existing.transform,
      });
      return;
    }

    const { size, color } = this.ctx.styles.text;
    const dragged = Math.abs(i.x - s.x);
    const x = Math.min(lx, i.x - page.x);
    const width = dragged * this.ctx.viewport.zoom > 20 ? dragged : Math.min(DEFAULT_WIDTH, Math.max(120, page.width - lx - 24));
    this.ctx.editText({ pageId: page.id, id: null, x: dragged * this.ctx.viewport.zoom > 20 ? x : lx, y: ly - size * 0.6, width, fontSize: size, color, text: '' });
  }

  /** Zone de texte sous le point (en tenant compte de sa transformation). */
  private hit(pageId: string, x: number, y: number): TextElement | null {
    const scene = this.ctx.scene(pageId);
    if (!scene) return null;
    const hits = scene.query([x - 2, y - 2, x + 2, y + 2]).sort((a, b) => b.z - a.z);
    for (const item of hits) {
      if (item.el.type !== 'text') continue;
      const [u, v] = applyMat(invertMat(item.matrix!), x, y);
      const el = item.el;
      if (u >= el.x - 4 && u <= el.x + el.width + 4 && v >= el.y - 4 && v <= el.y + el.height + 4) return el;
    }
    return null;
  }
}
