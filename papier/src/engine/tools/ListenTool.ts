import { pageAt } from '../layout';
import { pickAt } from './boxHit';
import type { Tool, ToolContext, ToolInput } from './types';

/**
 * Écoute : toucher un trait, un texte ou une image pour réentendre l'audio enregistré
 * au moment où il a été écrit. Ne modifie jamais la page.
 */
export class ListenTool implements Tool {
  private start: ToolInput | null = null;
  private moved = false;

  constructor(private ctx: ToolContext) {}

  down(i: ToolInput) {
    this.start = i;
    this.moved = false;
  }

  move(points: ToolInput[]) {
    const s = this.start;
    const last = points[points.length - 1];
    if (s && last && Math.hypot(last.sx - s.sx, last.sy - s.sy) > 8) this.moved = true;
  }

  up() {
    const s = this.start;
    this.start = null;
    if (!s || this.moved) return;
    const page = pageAt(this.ctx.layouts(), s.x, s.y);
    const scene = page && this.ctx.scene(page.id);
    if (!page || !scene) return;
    const [id] = pickAt(scene, s.x - page.x, s.y - page.y, 10 / this.ctx.viewport.zoom);
    const el = id ? scene.items.get(id)?.el : undefined;
    if (el) this.ctx.listen(el);
    else this.ctx.followLink(s.x, s.y);
  }

  cancel() {
    this.start = null;
  }
}
