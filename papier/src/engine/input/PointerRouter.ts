import type { Viewport } from '../Viewport';
import type { Tool, ToolInput } from '../tools/types';

export type FingerDrawing = 'auto' | 'always' | 'never';

export interface RouterHost {
  viewport: Viewport;
  tool(): Tool;
  fingerDrawing(): FingerDrawing;
  viewportChanged(): void;
  setGesture(active: boolean): void;
  undo(): void;
  redo(): void;
  /** Toucher simple du doigt (ou Ctrl/⌘ + clic) : suivi des liens. */
  tap?(sx: number, sy: number): void;
}

interface TouchGesture {
  startTime: number;
  maxTouches: number;
  moved: number;
  lastCx: number;
  lastCy: number;
  lastDist: number;
}

/** Durée max d'un toucher à plusieurs doigts reconnu comme « tap » (annuler / rétablir). */
const TAP_MS = 300;
/** Un trait au doigt plus court que ce délai est annulé si un 2e doigt se pose (début de pincement). */
const FINGER_STROKE_GRACE_MS = 250;

/**
 * Aiguillage des pointeurs :
 *  - stylet → outil actif ; dès qu'un stylet est vu, le doigt ne dessine plus (rejet de la paume) ;
 *  - doigt  → défilement (1 doigt), pincement-zoom (2 doigts), tap 2 doigts = annuler, 3 doigts = rétablir ;
 *  - souris → bouton gauche = outil, bouton du milieu ou Espace + glisser = défilement, molette = défilement,
 *             Ctrl/⌘ + molette ou pincement du trackpad = zoom.
 */
export class PointerRouter {
  private touches = new Map<number, { x: number; y: number }>();
  private drawing: { id: number; type: string; startedAt: number } | null = null;
  private gesture: TouchGesture | null = null;
  private mousePan: { id: number; x: number; y: number } | null = null;
  private rect: DOMRect;
  private spaceDown = false;
  private safariScale = 1;
  penSeen = false;

  constructor(
    private el: HTMLElement,
    private host: RouterHost,
  ) {
    this.rect = el.getBoundingClientRect();
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.prevent);
    el.addEventListener('gesturestart', this.onSafariGestureStart as EventListener);
    el.addEventListener('gesturechange', this.onSafariGesture as EventListener);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  destroy() {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.prevent);
    el.removeEventListener('gesturestart', this.onSafariGestureStart as EventListener);
    el.removeEventListener('gesturechange', this.onSafariGesture as EventListener);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  updateRect() {
    this.rect = this.el.getBoundingClientRect();
  }

  get isDrawing() {
    return this.drawing !== null;
  }

  private prevent = (e: Event) => e.preventDefault();

  private input(e: PointerEvent): ToolInput {
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const [x, y] = this.host.viewport.toWorld(sx, sy);
    return { x, y, sx, sy, p: e.pressure, t: e.timeStamp, pointerType: e.pointerType };
  }

  private canFingerDraw() {
    const mode = this.host.fingerDrawing();
    return mode === 'always' || (mode === 'auto' && !this.penSeen);
  }

  private capture(e: PointerEvent) {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* événement synthétique : pas de capture possible */
    }
  }

  private startDraw(e: PointerEvent) {
    this.capture(e);
    this.drawing = { id: e.pointerId, type: e.pointerType, startedAt: e.timeStamp };
    this.host.tool().down(this.input(e));
  }

  private onDown = (e: PointerEvent) => {
    this.updateRect();
    if (e.pointerType === 'touch') {
      // Paume posée pendant que le stylet écrit : ignorée.
      if (this.drawing?.type === 'pen') return;
      this.capture(e);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 1 && this.canFingerDraw()) {
        this.startDraw(e);
        return;
      }
      if (this.drawing?.type === 'touch') {
        // Un 2e doigt arrive : c'était le début d'un pincement, pas un trait.
        const tool = this.host.tool();
        if (e.timeStamp - this.drawing.startedAt < FINGER_STROKE_GRACE_MS) tool.cancel();
        else tool.up(this.input(e));
        this.drawing = null;
      }
      this.beginGesture(e.timeStamp);
      return;
    }

    if (e.pointerType === 'pen') {
      this.penSeen = true;
      if (this.drawing?.type === 'touch') {
        this.host.tool().cancel();
        this.drawing = null;
      }
      this.endGesture(false);
      this.startDraw(e);
      return;
    }

    // Souris
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.capture(e);
      this.mousePan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.host.setGesture(true);
    } else if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      this.host.tap?.(e.clientX - this.rect.left, e.clientY - this.rect.top);
    } else if (e.button === 0) {
      this.startDraw(e);
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.drawing && e.pointerId === this.drawing.id) {
      const coalesced = e.getCoalescedEvents?.() ?? [];
      const predicted = e.getPredictedEvents?.() ?? [];
      const points = (coalesced.length ? coalesced : [e]).map((c) => this.input(c));
      this.host.tool().move(points, predicted.map((c) => this.input(c)));
      return;
    }
    const touch = this.touches.get(e.pointerId);
    if (touch) {
      touch.x = e.clientX;
      touch.y = e.clientY;
      this.applyGesture();
      return;
    }
    if (this.mousePan && e.pointerId === this.mousePan.id) {
      this.host.viewport.panBy(e.clientX - this.mousePan.x, e.clientY - this.mousePan.y);
      this.mousePan.x = e.clientX;
      this.mousePan.y = e.clientY;
      this.host.viewportChanged();
      return;
    }
    if (e.pointerType !== 'touch') this.host.tool().hover?.(this.input(e));
  };

  private onUp = (e: PointerEvent) => this.release(e, false);
  private onCancel = (e: PointerEvent) => this.release(e, true);

  private onLeave = (e: PointerEvent) => {
    if (!this.drawing && e.pointerType !== 'touch') this.host.tool().hover?.(null);
  };

  private release(e: PointerEvent, cancelled: boolean) {
    if (this.drawing && e.pointerId === this.drawing.id) {
      const tool = this.host.tool();
      if (cancelled) tool.cancel();
      else tool.up(this.input(e));
      this.drawing = null;
    }
    if (this.touches.delete(e.pointerId)) {
      if (this.touches.size === 0) this.endGesture(!cancelled);
      else if (this.gesture) this.resetBaseline();
    }
    if (this.mousePan && e.pointerId === this.mousePan.id) {
      this.mousePan = null;
      this.host.setGesture(false);
      this.host.viewportChanged();
    }
  }

  // ── Gestes tactiles ────────────────────────────────────

  private centroid() {
    let cx = 0, cy = 0;
    const pts = [...this.touches.values()].slice(0, 2);
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    const dist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, dist };
  }

  private beginGesture(time: number) {
    if (!this.gesture) {
      this.gesture = { startTime: time, maxTouches: 0, moved: 0, lastCx: 0, lastCy: 0, lastDist: 0 };
      this.host.setGesture(true);
    }
    this.resetBaseline();
  }

  private resetBaseline() {
    const g = this.gesture!;
    g.maxTouches = Math.max(g.maxTouches, this.touches.size);
    const { cx, cy, dist } = this.centroid();
    g.lastCx = cx;
    g.lastCy = cy;
    g.lastDist = dist;
  }

  private applyGesture() {
    const g = this.gesture;
    if (!g) return;
    const { cx, cy, dist } = this.centroid();
    const vp = this.host.viewport;
    const dx = cx - g.lastCx;
    const dy = cy - g.lastCy;
    g.moved += Math.hypot(dx, dy) + (g.lastDist && dist ? Math.abs(dist - g.lastDist) : 0);
    vp.panBy(dx, dy);
    if (g.lastDist > 0 && dist > 0) {
      vp.zoomAt(dist / g.lastDist, cx - this.rect.left, cy - this.rect.top);
    }
    g.lastCx = cx;
    g.lastCy = cy;
    g.lastDist = dist;
    this.host.viewportChanged();
  }

  private endGesture(allowTap: boolean) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    this.touches.clear();
    this.host.setGesture(false);
    this.host.viewportChanged();
    if (allowTap && performance.now() - g.startTime < TAP_MS && g.moved < 12) {
      if (g.maxTouches === 2) this.host.undo();
      else if (g.maxTouches === 3) this.host.redo();
      else if (g.maxTouches === 1) this.host.tap?.(g.lastCx - this.rect.left, g.lastCy - this.rect.top);
    }
  }

  // ── Molette, trackpad, clavier ─────────────────────────

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const vp = this.host.viewport;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.height : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl + molette, ou pincement sur trackpad (Chrome/Firefox le signalent avec ctrlKey).
      // Molette classique : grands pas (~100) ; pincement trackpad : petits pas continus.
      const k = Math.abs(dy) >= 50 ? 0.002 : 0.01;
      const factor = Math.max(0.5, Math.min(2, Math.exp(-dy * k)));
      vp.zoomAt(factor, e.clientX - this.rect.left, e.clientY - this.rect.top);
    } else if (e.shiftKey && dx === 0) {
      vp.panBy(-dy, 0);
    } else {
      vp.panBy(-dx, -dy);
    }
    this.host.viewportChanged();
  };

  /** Safari macOS : pincement du trackpad via les événements propriétaires « gesture* ». */
  private onSafariGestureStart = (e: Event & { scale?: number }) => {
    e.preventDefault();
    this.safariScale = e.scale ?? 1;
  };

  private onSafariGesture = (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
    e.preventDefault();
    if (this.touches.size > 0 || e.scale === undefined) return; // iPad : déjà géré par les pointeurs
    const factor = e.scale / this.safariScale;
    this.safariScale = e.scale;
    const vp = this.host.viewport;
    vp.zoomAt(factor, (e.clientX ?? this.rect.left + vp.width / 2) - this.rect.left, (e.clientY ?? this.rect.top + vp.height / 2) - this.rect.top);
    this.host.viewportChanged();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== ' ') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    this.spaceDown = e.type === 'keydown';
    this.el.style.cursor = this.spaceDown ? 'grab' : '';
    if (e.type === 'keydown') e.preventDefault();
  };
}
