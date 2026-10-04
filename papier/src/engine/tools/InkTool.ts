import { addElements, removeElements } from '../../core/model/notebookDoc';
import { newId, nextZ } from '../../core/model/ids';
import { encodePoints, POINT_STRIDE } from '../../core/model/pointCodec';
import type { ID, StrokeElement } from '../../core/model/types';
import { fractionInside, pointInPolygon, pointsBBox } from '../geometry/geom';
import { convexHull, isClosedLoop, isScribble, recognizeShape, type RecognizedShape } from '../geometry/recognize';
import { centerlinePath, outlinePath, polylinePath } from '../ink/brushes';
import { pageAt, type PageLayout } from '../layout';
import { isCenterline, strokeHalfWidth, type RenderItem } from '../scene';
import type { Tool, ToolContext, ToolInput } from './types';

/** Durée d'immobilité (ms) en fin de tracé pour déclencher la reconnaissance de forme. */
const HOLD_MS = 450;
/** Tolérance de mouvement (pixels écran) pendant le maintien. */
const HOLD_TOLERANCE = 4;
/** Délai (ms) pour toucher l'intérieur d'une boucle et la transformer en sélection. */
const LOOP_TAP_MS = 2500;

type InkKind = 'pen' | 'pencil' | 'highlighter';

interface PendingLoop {
  pageId: ID;
  poly: number[];
  ids: ID[];
  time: number;
}

/**
 * Stylo, crayon et surligneur : capture les points, affiche l'encre fraîche, puis valide le trait.
 * Gestes : maintien → forme nette ; gribouillis → efface ; boucle puis toucher → sélection.
 */
export class InkTool implements Tool {
  private page: PageLayout | null = null;
  private pts: number[] = [];
  private template: StrokeElement | null = null;
  private tStart = 0;
  private shape: RecognizedShape | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private anchor = { sx: 0, sy: 0 };
  private loop: PendingLoop | null = null;
  /** Appui dans une boucle récente : toucher (→ sélection) ou début d'un trait ? */
  private maybeTap: ToolInput | null = null;

  constructor(
    private ctx: ToolContext,
    private kind: InkKind,
  ) {}

  down(i: ToolInput) {
    const loop = this.loop;
    this.loop = null;
    if (loop && performance.now() - loop.time < LOOP_TAP_MS && this.ctx.styles.gestures.loopSelect) {
      const page = this.ctx.layouts().find((l) => l.id === loop.pageId);
      if (page && pointInPolygon(i.x - page.x, i.y - page.y, loop.poly)) {
        this.maybeTap = i;
        this.loop = loop;
        return;
      }
    }
    this.start(i);
  }

  private start(i: ToolInput) {
    this.page = pageAt(this.ctx.layouts(), i.x, i.y) ?? null;
    if (!this.page) return;
    this.pts = [];
    this.shape = null;
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
      opacity: 1,
    };
    const tpl: StrokeElement =
      this.kind === 'pen'
        ? { ...base, tool: 'pen', brush: styles.pen.brush, color: styles.pen.color, width: styles.pen.width, dash: styles.pen.dash }
        : this.kind === 'pencil'
          ? { ...base, tool: 'pencil', brush: 'ballpoint', color: styles.pencil.color, width: styles.pencil.width, dash: 'solid', opacity: 0.92 }
          : { ...base, tool: 'highlighter', brush: 'ballpoint', color: styles.highlighter.color, width: styles.highlighter.width, dash: 'solid' };
    this.template = tpl;
    this.push(i);
    this.armHold(i);
    this.updateWet([]);
  }

  move(points: ToolInput[], predicted: ToolInput[]) {
    if (this.maybeTap) {
      const last = points[points.length - 1];
      if (Math.hypot(last.sx - this.maybeTap.sx, last.sy - this.maybeTap.sy) < 6) return;
      // Ce n'était pas un toucher : on écrit normalement depuis le point d'appui.
      const first = this.maybeTap;
      this.maybeTap = null;
      this.loop = null;
      this.start(first);
    }
    if (!this.page || this.shape) return;
    for (const p of points) this.push(p);
    const last = points[points.length - 1];
    if (Math.hypot(last.sx - this.anchor.sx, last.sy - this.anchor.sy) > HOLD_TOLERANCE) this.armHold(last);
    this.updateWet(predicted);
  }

  up(i: ToolInput) {
    clearTimeout(this.holdTimer);
    if (this.maybeTap) {
      const loop = this.loop!;
      this.maybeTap = null;
      this.loop = null;
      // Toucher dans la boucle : la boucle disparaît, ce qu'elle entoure est sélectionné.
      this.ctx.undoLast();
      this.ctx.selectWithLasso({ pageId: loop.pageId, ids: loop.ids });
      return;
    }
    if (!this.page || !this.template) return;
    if (!this.shape) this.push(i);
    this.commit();
  }

  cancel() {
    clearTimeout(this.holdTimer);
    this.page = null;
    this.template = null;
    this.shape = null;
    this.pts = [];
    this.maybeTap = null;
    this.ctx.renderer.wet = null;
    this.ctx.renderer.invalidateWet();
  }

  /** Oublie la boucle en attente (changement d'outil, autre action). */
  resetGestures() {
    this.loop = null;
  }

  private armHold(i: ToolInput) {
    this.anchor = { sx: i.sx, sy: i.sy };
    clearTimeout(this.holdTimer);
    if (!this.ctx.styles.gestures.shapeRecognition) return;
    this.holdTimer = setTimeout(() => this.onHold(), HOLD_MS);
  }

  private onHold() {
    if (!this.page || this.shape || this.pts.length < 3 * POINT_STRIDE) return;
    const shape = recognizeShape(Float32Array.from(this.pts));
    if (!shape) return;
    this.shape = shape;
    this.updateWet([]);
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

  /** Élément « trait » correspondant à la forme reconnue (sommets reliés par des segments). */
  private shapeElement(shape: RecognizedShape): { el: StrokeElement; pts: Float32Array } {
    const pts = new Float32Array(shape.vertices.length * POINT_STRIDE);
    shape.vertices.forEach(([x, y], k) => {
      pts[k * 4] = x;
      pts[k * 4 + 1] = y;
      pts[k * 4 + 2] = 0.5;
    });
    const el: StrokeElement = { ...this.template!, shape: shape.kind, closed: shape.closed, dash: this.template!.dash };
    return { el, pts };
  }

  private updateWet(predicted: ToolInput[]) {
    const tpl = this.template!;
    let el = tpl;
    let pts: Float32Array;
    let path: Path2D;
    if (this.shape) {
      ({ el, pts } = this.shapeElement(this.shape));
      path = polylinePath(pts, this.shape.closed);
    } else {
      const all = this.pts.slice();
      for (const p of predicted) this.local(p, all);
      pts = Float32Array.from(all);
      path = isCenterline(tpl) ? centerlinePath(pts) : outlinePath(pts, tpl, false);
    }
    const item: RenderItem = { id: 'wet', z: 0, el, pts, bbox: [0, 0, 0, 0] };
    this.ctx.renderer.wet = { pageId: this.page!.id, item, path };
    this.ctx.renderer.invalidateWet();
  }

  private commit() {
    const page = this.page!;
    const { gestures } = this.ctx.styles;
    let pts: Float32Array = Float32Array.from(this.pts);
    let base = this.template!;

    if (this.shape) {
      ({ el: base, pts } = this.shapeElement(this.shape));
    } else if (gestures.scribbleErase && this.kind !== 'highlighter' && isScribble(pts)) {
      // Gribouillis : efface les traits qu'il recouvre, sans laisser d'encre.
      const targets = this.scribbleTargets(page.id, pts);
      if (targets.length) {
        this.ctx.beginAction();
        this.ctx.transact((doc) => removeElements(doc, page.id, targets));
        this.cancel();
        return;
      }
    }

    const el: StrokeElement = { ...base, id: newId(), z: nextZ(), points: encodePoints(pts) };
    el.bbox = pointsBBox(pts, strokeHalfWidth(el) + 1);
    this.ctx.beginAction();
    this.ctx.transact((doc) => addElements(doc, page.id, [el]));

    if (!this.shape && gestures.loopSelect && this.kind !== 'highlighter' && isClosedLoop(pts)) {
      const poly: number[] = [];
      for (let k = 0; k < pts.length; k += POINT_STRIDE) poly.push(pts[k], pts[k + 1]);
      const ids = this.enclosed(page.id, poly, el.id);
      if (ids.length) this.loop = { pageId: page.id, poly, ids, time: performance.now() };
    }
    this.cancel();
  }

  private scribbleTargets(pageId: ID, pts: Float32Array): ID[] {
    const scene = this.ctx.scene(pageId);
    if (!scene) return [];
    const hull = convexHull(pts);
    const bb = pointsBBox(pts, 2);
    return scene
      .query(bb)
      .filter((item) => item.el.type === 'stroke' && fractionInside(item.pts, hull) >= 0.6)
      .map((item) => item.id);
  }

  private enclosed(pageId: ID, poly: number[], exclude: ID): ID[] {
    const scene = this.ctx.scene(pageId);
    if (!scene) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < poly.length; k += 2) {
      minX = Math.min(minX, poly[k]);
      maxX = Math.max(maxX, poly[k]);
      minY = Math.min(minY, poly[k + 1]);
      maxY = Math.max(maxY, poly[k + 1]);
    }
    return scene
      .query([minX, minY, maxX, maxY])
      .filter((item) => item.id !== exclude && fractionInside(item.pts, poly) >= 0.5)
      .sort((a, b) => a.z - b.z)
      .map((item) => item.id);
  }
}
