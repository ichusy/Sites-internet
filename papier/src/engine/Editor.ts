import * as Y from 'yjs';
import {
  LOCAL_ORIGIN, deletePage, duplicatePage, insertPage, listPages, movePage,
  readPage, roots, setPageTemplate, type ElementsMap, type PageMap,
} from '../core/model/notebookDoc';
import { newId } from '../core/model/ids';
import type { ID, PageElement, TemplateRef } from '../core/model/types';
import type { OpenNotebook } from '../core/storage/notebookStore';
import { PointerRouter, type FingerDrawing } from './input/PointerRouter';
import { layoutPages, type PageLayout } from './layout';
import { Renderer } from './render/Renderer';
import { PageScene } from './scene';
import { EraserTool } from './tools/EraserTool';
import { InkTool } from './tools/InkTool';
import type { Tool, ToolContext, ToolName, ToolStyles } from './tools/types';
import { Viewport } from './Viewport';

export interface EditorState {
  canUndo: boolean;
  canRedo: boolean;
  pageCount: number;
  currentPage: number;
  zoom: number;
}

const TOP_MARGIN = 16;

/**
 * Façade du moteur : relie le document Yjs, les scènes de rendu, la vue, la saisie et les outils.
 * Indépendante du framework d'interface.
 */
export class Editor {
  readonly viewport = new Viewport();
  readonly renderer: Renderer;
  private router: PointerRouter;
  private scenes = new Map<ID, PageScene>();
  private layout: ReturnType<typeof layoutPages> = { pages: [], bounds: [0, 0, 0, 0] };
  private tools: Record<ToolName, Tool>;
  private resizeObserver: ResizeObserver;
  private stateListeners = new Set<(s: EditorState) => void>();
  private pageListeners = new Set<(pageId: ID) => void>();
  private main: HTMLCanvasElement;
  private wet: HTMLCanvasElement;
  private saveViewTimer: ReturnType<typeof setTimeout> | undefined;
  private initialised = false;

  tool: ToolName = 'pen';
  fingerDrawing: FingerDrawing = 'auto';

  constructor(
    private container: HTMLElement,
    private nb: OpenNotebook,
    readonly styles: ToolStyles,
  ) {
    this.main = document.createElement('canvas');
    this.wet = document.createElement('canvas');
    this.main.className = 'ink-main';
    this.wet.className = 'ink-wet';
    container.append(this.main, this.wet);

    this.renderer = new Renderer(this.main, this.wet, {
      viewport: this.viewport,
      layouts: () => this.layout.pages,
      scene: (id) => this.scenes.get(id),
    });

    const ctx: ToolContext = {
      viewport: this.viewport,
      renderer: this.renderer,
      styles,
      layouts: () => this.layout.pages,
      scene: (id) => this.scenes.get(id),
      beginAction: () => this.nb.undo.stopCapturing(),
      transact: (fn) => this.nb.doc.transact(() => fn(this.nb.doc), LOCAL_ORIGIN),
    };
    this.tools = {
      pen: new InkTool(ctx, 'pen'),
      highlighter: new InkTool(ctx, 'highlighter'),
      eraser: new EraserTool(ctx),
    };

    this.router = new PointerRouter(this.wet, {
      viewport: this.viewport,
      tool: () => this.tools[this.tool],
      fingerDrawing: () => this.fingerDrawing,
      viewportChanged: () => this.onViewportChanged(),
      setGesture: (active) => (this.renderer.gestureActive = active),
      undo: () => this.undo(),
      redo: () => this.redo(),
    });

    this.loadScenes();
    const { pages, pageOrder } = roots(nb.doc);
    pages.observeDeep(this.onPagesEvents);
    pageOrder.observe(this.onOrderEvent);
    nb.undo.on('stack-item-added', this.emitState);
    nb.undo.on('stack-item-popped', this.emitState);
    nb.undo.on('stack-cleared', this.emitState);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  destroy() {
    const { pages, pageOrder } = roots(this.nb.doc);
    pages.unobserveDeep(this.onPagesEvents);
    pageOrder.unobserve(this.onOrderEvent);
    this.nb.undo.off('stack-item-added', this.emitState);
    this.nb.undo.off('stack-item-popped', this.emitState);
    this.nb.undo.off('stack-cleared', this.emitState);
    this.resizeObserver.disconnect();
    this.router.destroy();
    this.renderer.destroy();
    clearTimeout(this.saveViewTimer);
    this.main.remove();
    this.wet.remove();
    this.stateListeners.clear();
    this.pageListeners.clear();
  }

  // ── Abonnements pour l'interface ───────────────────────

  onState(fn: (s: EditorState) => void): () => void {
    this.stateListeners.add(fn);
    fn(this.state());
    return () => this.stateListeners.delete(fn);
  }

  /** Notifié quand le contenu d'une page change (miniatures). */
  onPageChange(fn: (pageId: ID) => void): () => void {
    this.pageListeners.add(fn);
    return () => this.pageListeners.delete(fn);
  }

  state(): EditorState {
    return {
      canUndo: this.nb.undo.canUndo(),
      canRedo: this.nb.undo.canRedo(),
      pageCount: this.layout.pages.length,
      currentPage: this.currentPageIndex(),
      zoom: this.viewport.zoom,
    };
  }

  private emitState = () => {
    const s = this.state();
    for (const fn of this.stateListeners) fn(s);
  };

  // ── Outils et commandes ────────────────────────────────

  setTool(tool: ToolName) {
    this.tools[this.tool].cancel();
    this.tools[this.tool].hover?.(null);
    this.tool = tool;
  }

  undo() {
    this.tools[this.tool].cancel();
    this.nb.undo.undo();
  }

  redo() {
    this.tools[this.tool].cancel();
    this.nb.undo.redo();
  }

  /** Titre enregistré dans le document (hors historique d'annulation). */
  setTitle(title: string) {
    const { meta } = roots(this.nb.doc);
    if (meta.get('title') !== title) meta.set('title', title);
  }

  setDeskColor(color: string) {
    this.renderer.deskColor = color;
    this.renderer.invalidate();
  }

  pages(): PageLayout[] {
    return this.layout.pages;
  }

  scene(id: ID): PageScene | undefined {
    return this.scenes.get(id);
  }

  private transact(fn: (doc: Y.Doc) => void) {
    this.nb.undo.stopCapturing();
    this.nb.doc.transact(() => fn(this.nb.doc), LOCAL_ORIGIN);
    this.nb.undo.stopCapturing();
  }

  /** Ajoute une page après `afterIndex` (par défaut la page courante), avec le même format et modèle. */
  addPage(afterIndex = this.currentPageIndex(), template?: TemplateRef) {
    const ref = this.layout.pages[afterIndex] ?? this.layout.pages[this.layout.pages.length - 1];
    const refPage = ref ? this.scenes.get(ref.id)?.page : undefined;
    if (!refPage) return;
    this.transact((doc) =>
      insertPage(doc, { id: newId(), width: refPage.width, height: refPage.height, template: template ?? refPage.template }, afterIndex + 1),
    );
    this.scrollToPage(afterIndex + 1);
  }

  deletePage(pageId: ID) {
    if (this.layout.pages.length <= 1) return;
    this.transact((doc) => deletePage(doc, pageId));
  }

  duplicatePage(pageId: ID) {
    this.transact((doc) => duplicatePage(doc, pageId));
  }

  movePage(from: number, to: number) {
    this.transact((doc) => movePage(doc, from, to));
  }

  setTemplate(pageId: ID, template: TemplateRef) {
    this.transact((doc) => setPageTemplate(doc, pageId, template));
  }

  // ── Vue ─────────────────────────────────────────────────

  currentPageIndex(): number {
    const pages = this.layout.pages;
    if (!pages.length) return 0;
    const [, cy] = this.viewport.toWorld(this.viewport.width / 2, this.viewport.height / 3);
    let best = 0;
    let bestDist = Infinity;
    for (const l of pages) {
      const d = cy < l.y ? l.y - cy : cy > l.y + l.height ? cy - l.y - l.height : 0;
      if (d < bestDist) {
        bestDist = d;
        best = l.index;
      }
    }
    return best;
  }

  scrollToPage(index: number) {
    const l = this.layout.pages[index];
    if (!l) return;
    this.viewport.panY = TOP_MARGIN - l.y * this.viewport.zoom;
    this.onViewportChanged();
  }

  fitWidth() {
    const current = this.currentPageIndex();
    const maxW = Math.max(...this.layout.pages.map((p) => p.width), 1);
    this.viewport.zoom = Math.min((this.viewport.width - 32) / maxW, 1.6);
    this.scrollToPage(current);
  }

  zoomBy(factor: number) {
    this.viewport.zoomAt(factor, this.viewport.width / 2, this.viewport.height / 2);
    this.onViewportChanged();
  }

  private onViewportChanged() {
    this.viewport.clamp(this.layout.bounds);
    this.renderer.viewportChanged();
    this.emitState();
    clearTimeout(this.saveViewTimer);
    this.saveViewTimer = setTimeout(() => this.saveView(), 400);
  }

  private viewKey() {
    return `papier-view-${this.nb.id}`;
  }

  private saveView() {
    try {
      const { zoom, panX, panY } = this.viewport;
      localStorage.setItem(this.viewKey(), JSON.stringify({ zoom, panX, panY }));
    } catch {
      /* stockage indisponible : sans conséquence */
    }
  }

  private restoreView(): boolean {
    try {
      const raw = localStorage.getItem(this.viewKey());
      if (!raw) return false;
      const v = JSON.parse(raw);
      if (typeof v.zoom !== 'number') return false;
      Object.assign(this.viewport, { zoom: v.zoom, panX: v.panX, panY: v.panY });
      return true;
    } catch {
      return false;
    }
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.viewport.width = Math.max(1, rect.width);
    this.viewport.height = Math.max(1, rect.height);
    this.viewport.dpr = window.devicePixelRatio || 1;
    this.router.updateRect();
    this.renderer.resize();
    if (!this.initialised && rect.width > 0) {
      this.initialised = true;
      if (!this.restoreView()) {
        this.fitWidth();
        return;
      }
    }
    this.onViewportChanged();
  }

  // ── Synchronisation document → scènes ──────────────────

  private loadScenes() {
    const { pages } = roots(this.nb.doc);
    this.scenes.clear();
    pages.forEach((map, id) => this.scenes.set(id, this.buildScene(map)));
    this.relayout();
  }

  private buildScene(map: PageMap): PageScene {
    const scene = new PageScene(readPage(map));
    const els = map.get('elements') as ElementsMap;
    scene.load(els.values());
    return scene;
  }

  private relayout() {
    this.layout = layoutPages(listPages(this.nb.doc));
  }

  private onOrderEvent = () => {
    this.relayout();
    this.viewport.clamp(this.layout.bounds);
    this.renderer.invalidate();
    this.emitState();
  };

  private onPagesEvents = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const { pages } = roots(this.nb.doc);
    const changed = new Set<ID>();
    let relayout = false;

    for (const ev of events) {
      const target = ev.target;
      if (target === pages) {
        for (const [key, change] of ev.changes.keys) {
          if (change.action === 'delete') {
            this.scenes.delete(key);
            this.renderer.dropCache(key);
          } else {
            const map = pages.get(key);
            if (map) this.scenes.set(key, this.buildScene(map));
            changed.add(key);
          }
        }
        relayout = true;
      } else if (target instanceof Y.Map && target.parent === pages) {
        const id = target.get('id') as ID;
        this.scenes.get(id)?.setPage(readPage(target as PageMap));
        changed.add(id);
        relayout = true;
      } else if (target instanceof Y.Map && target.parent?.parent === pages) {
        const id = (target.parent as PageMap).get('id') as ID;
        const scene = this.scenes.get(id);
        if (!scene) continue;
        for (const [key, change] of ev.changes.keys) {
          if (change.action === 'delete') scene.remove(key);
          else scene.upsert(target.get(key) as PageElement);
        }
        changed.add(id);
      }
    }

    if (relayout) {
      this.relayout();
      this.viewport.clamp(this.layout.bounds);
      this.emitState();
    }
    this.renderer.invalidate();
    for (const id of changed) for (const fn of this.pageListeners) fn(id);
  };
}
