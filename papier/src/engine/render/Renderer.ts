import type { ID } from '../../core/model/types';
import type { PageLayout } from '../layout';
import type { PageScene, RenderItem } from '../scene';
import type { Viewport } from '../Viewport';
import type { BackgroundStore } from './backgrounds';
import { drawItem, drawPageContent } from './draw';

/** Taille maximale (en pixels) du cache bitmap d'une page ; au-delà, rendu vectoriel direct. */
const MAX_CACHE_PIXELS = 6_000_000;
/** Nombre maximal de pages gardées en cache hors écran. */
const MAX_CACHES = 6;
/** Délai après le dernier mouvement avant de recalculer les caches à la bonne résolution. */
const SETTLE_MS = 160;

export interface RenderSource {
  viewport: Viewport;
  layouts(): PageLayout[];
  scene(id: ID): PageScene | undefined;
  backgrounds: BackgroundStore;
}

/** Trait en cours, dessiné sur le calque « encre fraîche ». */
export interface WetStroke {
  pageId: ID;
  item: RenderItem;
  path: Path2D;
}

interface PageCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scale: number;
  lastUsed: number;
}

/**
 * Rendu en deux calques :
 *  - `main` : bureau + pages. Chaque page est rastérisée dans un cache bitmap ;
 *    un nouveau trait y est simplement ajouté, sans tout redessiner.
 *  - `wet`  : uniquement le trait en cours et le curseur de gomme, redessiné à chaque événement.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private wetCtx: CanvasRenderingContext2D;
  private caches = new Map<ID, PageCache>();
  private frameReq = 0;
  private wetReq = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastViewportChange = 0;
  gestureActive = false;
  wet: WetStroke | null = null;
  /** Curseur de gomme en pixels CSS. */
  cursor: { x: number; y: number; r: number } | null = null;
  /** Dessin supplémentaire sur le calque d'encre fraîche (lasso, sélection), en pixels physiques. */
  overlay: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  deskColor = '#e9e6e0';

  constructor(
    private main: HTMLCanvasElement,
    private wetCanvas: HTMLCanvasElement,
    private src: RenderSource,
  ) {
    this.ctx = main.getContext('2d', { alpha: false })!;
    this.wetCtx = (wetCanvas.getContext('2d', { desynchronized: true }) ?? wetCanvas.getContext('2d'))!;
  }

  resize() {
    const { width, height, dpr } = this.src.viewport;
    for (const c of [this.main, this.wetCanvas]) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    this.invalidate();
    this.invalidateWet();
  }

  /** À appeler après chaque déplacement/zoom de la vue. */
  viewportChanged() {
    this.lastViewportChange = performance.now();
    this.invalidate();
    this.invalidateWet();
  }

  invalidate() {
    if (!this.frameReq) this.frameReq = requestAnimationFrame(() => this.frame());
  }

  invalidateWet() {
    if (!this.wetReq) this.wetReq = requestAnimationFrame(() => this.wetFrame());
  }

  dropCache(id: ID) {
    this.caches.delete(id);
  }

  destroy() {
    cancelAnimationFrame(this.frameReq);
    cancelAnimationFrame(this.wetReq);
    clearTimeout(this.settleTimer);
    this.caches.clear();
  }

  private settling(now: number) {
    return this.gestureActive || now - this.lastViewportChange < SETTLE_MS;
  }

  private frame() {
    this.frameReq = 0;
    const now = performance.now();
    const vp = this.src.viewport;
    const { ctx } = this;
    const dpr = vp.dpr;
    const target = vp.zoom * dpr;
    const [vx0, vy0, vx1, vy1] = vp.visibleWorld();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deskColor;
    ctx.fillRect(0, 0, this.main.width, this.main.height);

    let rescaleBudget = 1;
    let needsSettle = false;
    const visible = new Set<ID>();

    for (const l of this.src.layouts()) {
      if (l.x > vx1 || l.x + l.width < vx0 || l.y > vy1 || l.y + l.height < vy0) continue;
      const scene = this.src.scene(l.id);
      if (!scene) continue;
      visible.add(l.id);
      const sx = (l.x * vp.zoom + vp.panX) * dpr;
      const sy = (l.y * vp.zoom + vp.panY) * dpr;
      const sw = l.width * target;
      const sh = l.height * target;

      // Ombre portée légère.
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(sx + dpr, sy + 2 * dpr, sw, sh);

      const maxScale = Math.sqrt(MAX_CACHE_PIXELS / (l.width * l.height));
      if (target > maxScale * 1.05) {
        // Zoom très fort : rendu vectoriel direct de la seule partie visible.
        this.caches.delete(l.id);
        scene.dirty = 'clean';
        scene.pending = [];
        const items = scene
          .query([vx0 - l.x, vy0 - l.y, vx1 - l.x, vy1 - l.y])
          .filter((i) => !scene.hidden.has(i.id))
          .sort((a, b) => a.z - b.z);
        const bg = this.background(scene, target);
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, sw, sh);
        ctx.clip();
        ctx.setTransform(target, 0, 0, target, sx, sy);
        drawPageContent(ctx, scene.page, items, target, bg);
        ctx.restore();
        continue;
      }

      const desired = Math.min(target, maxScale);
      let cache = this.caches.get(l.id);
      if (!cache || scene.dirty === 'full') {
        cache = this.buildCache(scene, cache?.scale && scene.dirty === 'full' && this.settling(now) ? cache.scale : desired);
        this.caches.set(l.id, cache);
      } else if (scene.dirty === 'append') {
        cache.ctx.setTransform(cache.scale, 0, 0, cache.scale, 0, 0);
        for (const item of scene.pending) if (!scene.hidden.has(item.id)) drawItem(cache.ctx, item);
        scene.pending = [];
        scene.dirty = 'clean';
      }
      if (Math.abs(cache.scale - desired) / desired > 0.15) {
        if (!this.settling(now) && rescaleBudget > 0) {
          rescaleBudget--;
          cache = this.buildCache(scene, desired);
          this.caches.set(l.id, cache);
        } else {
          needsSettle = true;
        }
      }
      cache.lastUsed = now;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cache.canvas, sx, sy, sw, sh);
    }

    this.evict(visible);
    if (needsSettle) {
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.invalidate(), this.settling(now) ? SETTLE_MS : 0);
    }
  }

  private buildCache(scene: PageScene, scale: number): PageCache {
    const { page } = scene;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(page.width * scale));
    canvas.height = Math.max(1, Math.ceil(page.height * scale));
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawPageContent(ctx, page, scene.visible(), scale, this.background(scene, scale));
    scene.dirty = 'clean';
    scene.pending = [];
    return { canvas, ctx, scale, lastUsed: performance.now() };
  }

  private background(scene: PageScene, scale: number) {
    const { page } = scene;
    return page.background ? this.src.backgrounds.get(page.background, page.width, page.height, scale) : null;
  }

  private evict(visible: Set<ID>) {
    if (this.caches.size <= MAX_CACHES) return;
    const offscreen = [...this.caches.entries()]
      .filter(([id]) => !visible.has(id))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.caches.size > MAX_CACHES && offscreen.length) this.caches.delete(offscreen.shift()![0]);
  }

  private wetFrame() {
    this.wetReq = 0;
    const vp = this.src.viewport;
    const ctx = this.wetCtx;
    const dpr = vp.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.wetCanvas.width, this.wetCanvas.height);
    if (this.wet) {
      const l = this.src.layouts().find((p) => p.id === this.wet!.pageId);
      if (l) {
        const target = vp.zoom * dpr;
        const sx = (l.x * vp.zoom + vp.panX) * dpr;
        const sy = (l.y * vp.zoom + vp.panY) * dpr;
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, l.width * target, l.height * target);
        ctx.clip();
        ctx.setTransform(target, 0, 0, target, sx, sy);
        drawItem(ctx, this.wet.item, this.wet.path);
        ctx.restore();
      }
    }
    if (this.overlay) {
      ctx.save();
      this.overlay(ctx);
      ctx.restore();
    }
    if (this.cursor) {
      ctx.save();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(60,60,60,0.8)';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(this.cursor.x * dpr, this.cursor.y * dpr, this.cursor.r * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Miniature d'une page dans un canvas fourni. */
  static renderThumbnail(canvas: HTMLCanvasElement, scene: PageScene, cssWidth: number, dpr: number, backgrounds: BackgroundStore) {
    const scale = (cssWidth * dpr) / scene.page.width;
    canvas.width = Math.round(scene.page.width * scale);
    canvas.height = Math.round(scene.page.height * scale);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${(scene.page.height / scene.page.width) * cssWidth}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const { page } = scene;
    const bg = page.background ? backgrounds.get(page.background, page.width, page.height, scale) : null;
    drawPageContent(ctx, page, scene.sorted(), scale, bg);
  }
}
