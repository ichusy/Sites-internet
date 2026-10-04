import { addElements } from '../../core/model/notebookDoc';
import { newId, nextZ } from '../../core/model/ids';
import { encodePoints, POINT_STRIDE } from '../../core/model/pointCodec';
import type { StrokeElement } from '../../core/model/types';
import { pointsBBox } from '../geometry/geom';
import { centerlinePath, outlinePath } from '../ink/brushes';
import { pageAt, type PageLayout } from '../layout';
import { strokeHalfWidth, type RenderItem } from '../scene';
import type { Tool, ToolContext, ToolInput } from './types';

/** Stylo et surligneur : capture les points, affiche l'encre fraîche, puis valide le trait. */
export class InkTool implements Tool {
  private page: PageLayout | null = null;
  private pts: number[] = [];
  private template: StrokeElement | null = null;
  private tStart = 0;

  constructor(
    private ctx: ToolContext,
    private kind: 'pen' | 'highlighter',
  ) {}

  down(i: ToolInput) {
    this.page = pageAt(this.ctx.layouts(), i.x, i.y) ?? null;
    if (!this.page) return;
    this.pts = [];
    this.tStart = i.t;
    const realPressure = i.pointerType === 'pen';
    const { styles } = this.ctx;
    const base = {
      type: 'stroke' as const,
      id: 'wet',
      z: 0,
      pressure: realPressure,
      points: new Uint8Array(0),
      bbox: [0, 0, 0, 0] as StrokeElement['bbox'],
      t0: Date.now(),
    };
    this.template =
      this.kind === 'pen'
        ? { ...base, tool: 'pen', brush: styles.pen.brush, color: styles.pen.color, width: styles.pen.width, opacity: 1, dash: styles.pen.dash }
        : { ...base, tool: 'highlighter', brush: 'ballpoint', color: styles.highlighter.color, width: styles.highlighter.width, opacity: 1, dash: 'solid' };
    this.push(i);
    this.updateWet([]);
  }

  move(points: ToolInput[], predicted: ToolInput[]) {
    if (!this.page) return;
    for (const p of points) this.push(p);
    this.updateWet(predicted);
  }

  up(i: ToolInput) {
    if (!this.page || !this.template) return;
    this.push(i);
    this.commit();
  }

  cancel() {
    this.page = null;
    this.template = null;
    this.pts = [];
    this.ctx.renderer.wet = null;
    this.ctx.renderer.invalidateWet();
  }

  private local(i: ToolInput, out: number[]) {
    const p = this.template!.pressure ? (i.p > 0 ? i.p : 0.05) : 0.5;
    out.push(i.x - this.page!.x, i.y - this.page!.y, p, i.t - this.tStart);
  }

  private push(i: ToolInput) {
    const n = this.pts.length;
    if (n >= POINT_STRIDE) {
      const minDist = 0.6 / (this.ctx.viewport.zoom * this.ctx.viewport.dpr);
      const dx = i.x - this.page!.x - this.pts[n - 4];
      const dy = i.y - this.page!.y - this.pts[n - 3];
      if (dx * dx + dy * dy < minDist * minDist) return;
    }
    this.local(i, this.pts);
  }

  private updateWet(predicted: ToolInput[]) {
    const tpl = this.template!;
    const all = this.pts.slice();
    for (const p of predicted) this.local(p, all);
    const pts = Float32Array.from(all);
    const item: RenderItem = { id: 'wet', z: 0, el: tpl, pts, bbox: [0, 0, 0, 0] };
    const path =
      tpl.tool === 'highlighter' || tpl.dash !== 'solid'
        ? centerlinePath(pts)
        : outlinePath(pts, tpl.brush, tpl.width, tpl.pressure, false);
    this.ctx.renderer.wet = { pageId: this.page!.id, item, path };
    this.ctx.renderer.invalidateWet();
  }

  private commit() {
    const page = this.page!;
    const pts = Float32Array.from(this.pts);
    const el: StrokeElement = {
      ...this.template!,
      id: newId(),
      z: nextZ(),
      points: encodePoints(pts),
    };
    el.bbox = pointsBBox(pts, strokeHalfWidth(el) + 1);
    this.ctx.beginAction();
    this.ctx.transact((doc) => addElements(doc, page.id, [el]));
    this.cancel();
  }
}
