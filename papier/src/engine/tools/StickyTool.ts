import { addElements } from '../../core/model/notebookDoc';
import { newId, nextZ } from '../../core/model/ids';
import type { ID, StickyElement } from '../../core/model/types';
import { pageAt } from '../layout';
import { STICKY_PAD, STICKY_TEXT_COLOR } from '../render/draw';
import { makeItem } from '../scene';
import { topItemAt } from './boxHit';
import type { TextEditRequest, Tool, ToolContext, ToolInput } from './types';

/** Demande d'édition du texte d'un post-it (zone intérieure, fond de la couleur du papier). */
export function stickyEditRequest(pageId: ID, el: StickyElement): TextEditRequest {
  return {
    pageId,
    id: el.id,
    kind: 'sticky',
    x: el.x + STICKY_PAD,
    y: el.y + STICKY_PAD,
    width: el.width - STICKY_PAD * 2,
    fontSize: el.fontSize,
    color: STICKY_TEXT_COLOR,
    background: el.color,
    text: el.text,
    transform: el.transform,
  };
}

/** Côté d'un nouveau post-it (points). */
export const STICKY_SIZE = 160;

/** Post-it : toucher un endroit vide pour en poser un, toucher un post-it pour modifier son texte. */
export class StickyTool implements Tool {
  private start: ToolInput | null = null;

  constructor(private ctx: ToolContext) {}

  down(i: ToolInput) {
    this.start = i;
  }

  move() {}

  cancel() {
    this.start = null;
  }

  up() {
    const s = this.start;
    this.start = null;
    if (!s) return;
    const page = pageAt(this.ctx.layouts(), s.x, s.y);
    const scene = page && this.ctx.scene(page.id);
    if (!page || !scene) return;
    const lx = s.x - page.x;
    const ly = s.y - page.y;

    const hit = topItemAt(scene, lx, ly, (it) => it.el.type === 'sticky');
    let el = hit?.el as StickyElement | undefined;
    if (!el) {
      const { color, size } = this.ctx.styles.sticky;
      el = {
        type: 'sticky', id: newId(), z: nextZ(), bbox: [0, 0, 0, 0],
        x: lx - STICKY_SIZE / 2, y: ly - STICKY_SIZE / 2, width: STICKY_SIZE, height: STICKY_SIZE,
        color, text: '', fontSize: size,
      };
      el.bbox = makeItem(el).bbox;
      const created = el;
      this.ctx.beginAction();
      this.ctx.transact((doc) => addElements(doc, page.id, [created]));
    }
    this.ctx.editText(stickyEditRequest(page.id, el));
  }
}
