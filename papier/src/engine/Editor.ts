import * as Y from 'yjs';
import {
  LOCAL_ORIGIN, addElements, deletePage, duplicatePage, insertPage, listPages, movePage,
  pageElements, readPage, removeElements, roots, setPageTemplate, type ElementsMap, type PageMap,
} from '../core/model/notebookDoc';
import { newId, nextZ } from '../core/model/ids';
import type { ID, ImageElement, Mat2D, PageBackground, PageData, PageElement, TemplateRef, TextElement } from '../core/model/types';
import type { OpenNotebook } from '../core/storage/notebookStore';
import { multiplyMat, translateMat } from './geometry/geom';
import { PointerRouter, type FingerDrawing } from './input/PointerRouter';
import { layoutPages, type PageLayout } from './layout';
import { BackgroundStore } from './render/backgrounds';
import { Renderer } from './render/Renderer';
import { PageScene, makeItem } from './scene';
import { EraserTool } from './tools/EraserTool';
import { InkTool } from './tools/InkTool';
import { LassoTool } from './tools/LassoTool';
import { TextTool } from './tools/TextTool';
import type { Selection, TextEditRequest, Tool, ToolContext, ToolName, ToolStyles } from './tools/types';
import { canvasMeasure, layoutText, textBlockHeight } from './render/text';
import { Viewport } from './Viewport';

/** Sélection telle que l'interface l'affiche (rectangle en pixels CSS dans la zone de dessin). */
export interface SelectionInfo {
  count: number;
  rect: { x: number; y: number; width: number; height: number };
  dragging: boolean;
}

/** Presse-papiers interne, partagé entre les carnets pendant la session. */
let clipboard: { pageId: ID; elements: PageElement[] } | null = null;

export function hasClipboard() {
  return clipboard !== null;
}

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
  private lasso: LassoTool;
  private sel: Selection | null = null;
  private selectionListeners = new Set<(s: SelectionInfo | null) => void>();
  private pasteCount = 0;
  readonly backgrounds: BackgroundStore;
  private textListeners = new Set<(req: TextEditRequest | null) => void>();
  private toolListeners = new Set<(tool: ToolName) => void>();
  private editing: TextEditRequest | null = null;
  /** Outil à reprendre quand la sélection faite par « entourer puis toucher » est levée. */
  private returnTool: ToolName | null = null;

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

    this.backgrounds = new BackgroundStore((bg) => this.onBackgroundReady(bg));
    this.renderer = new Renderer(this.main, this.wet, {
      viewport: this.viewport,
      layouts: () => this.layout.pages,
      scene: (id) => this.scenes.get(id),
      backgrounds: this.backgrounds,
    });

    const ctx: ToolContext = {
      viewport: this.viewport,
      renderer: this.renderer,
      styles,
      layouts: () => this.layout.pages,
      scene: (id) => this.scenes.get(id),
      beginAction: () => this.nb.undo.stopCapturing(),
      transact: (fn) => this.nb.doc.transact(() => fn(this.nb.doc), LOCAL_ORIGIN),
      selection: () => this.sel,
      setSelection: (sel) => this.setSelection(sel),
      transformSelection: (m, s) => this.transformSelection(m, s),
      undoLast: () => this.nb.undo.undo(),
      selectWithLasso: (sel) => {
        const back = this.tool;
        this.requestTool('lasso');
        this.returnTool = back;
        this.setSelection(sel);
      },
      editText: (req) => this.startTextEdit(req),
    };
    this.lasso = new LassoTool(ctx);
    this.tools = {
      pen: new InkTool(ctx, 'pen'),
      pencil: new InkTool(ctx, 'pencil'),
      highlighter: new InkTool(ctx, 'highlighter'),
      eraser: new EraserTool(ctx),
      lasso: this.lasso,
      text: new TextTool(ctx),
    };
    this.renderer.overlay = (c) => this.lasso.drawOverlay(c);

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
    this.backgrounds.destroy();
    this.selectionListeners.clear();
    this.textListeners.clear();
    this.toolListeners.clear();
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
    if (tool === this.tool) return;
    this.tools[this.tool].cancel();
    this.tools[this.tool].hover?.(null);
    for (const t of Object.values(this.tools)) (t as InkTool).resetGestures?.();
    this.commitTextEdit();
    this.returnTool = null;
    this.tool = tool;
    if (tool !== 'lasso') this.setSelection(null);
  }

  /** L'interface est prévenue quand le moteur change lui-même d'outil. */
  onToolChange(fn: (tool: ToolName) => void): () => void {
    this.toolListeners.add(fn);
    return () => this.toolListeners.delete(fn);
  }

  private requestTool(tool: ToolName) {
    this.setTool(tool);
    for (const fn of this.toolListeners) fn(tool);
  }

  // ── Texte ───────────────────────────────────────────────

  /** Notifié quand une zone de texte entre (ou sort) en édition. */
  onTextEdit(fn: (req: TextEditRequest | null) => void): () => void {
    this.textListeners.add(fn);
    return () => this.textListeners.delete(fn);
  }

  private lastTextCommit = 0;

  private startTextEdit(req: TextEditRequest) {
    // Toucher la page juste pour terminer une saisie ne crée pas de nouvelle zone.
    if (!req.id && performance.now() - this.lastTextCommit < 350) return;
    this.commitTextEdit();
    this.editing = req;
    if (req.id) this.scenes.get(req.pageId)?.setHidden([req.id]);
    this.renderer.invalidate();
    for (const fn of this.textListeners) fn(req);
  }

  /** Position écran (pixels CSS) du coin haut-gauche d'une zone en édition, et échelle. */
  textEditorFrame(req: TextEditRequest) {
    const page = this.layout.pages.find((l) => l.id === req.pageId);
    if (!page) return null;
    const m = req.transform ?? [1, 0, 0, 1, 0, 0];
    const [x, y] = [m[0] * req.x + m[2] * req.y + m[4], m[1] * req.x + m[3] * req.y + m[5]];
    const [sx, sy] = this.viewport.toScreen(page.x + x, page.y + y);
    const scale = Math.hypot(m[0], m[1]);
    return { x: sx, y: sy, zoom: this.viewport.zoom * scale, angle: Math.atan2(m[1], m[0]) };
  }

  /** Valide le texte en cours d'édition (vide = suppression de la zone). */
  commitTextEdit(text?: string) {
    const req = this.editing;
    if (!req) return;
    this.editing = null;
    this.lastTextCommit = performance.now();
    const value = (text ?? req.text).replace(/\s+$/, '');
    const scene = this.scenes.get(req.pageId);
    scene?.setHidden([]);
    const lines = layoutText(value, req.width, canvasMeasure(req.fontSize));
    const height = textBlockHeight(lines.length, req.fontSize);
    if (req.id) {
      const id = req.id;
      const old = scene?.items.get(id)?.el as TextElement | undefined;
      if (!value) this.transact((doc) => removeElements(doc, req.pageId, [id]));
      else if (old && (old.text !== value || old.color !== req.color || old.fontSize !== req.fontSize)) {
        const next: TextElement = { ...old, text: value, color: req.color, fontSize: req.fontSize, height };
        next.bbox = makeItem(next).bbox;
        this.transact((doc) => addElements(doc, req.pageId, [next]));
      }
    } else if (value) {
      const el: TextElement = {
        type: 'text', id: newId(), z: nextZ(), bbox: [0, 0, 0, 0],
        x: req.x, y: req.y, width: req.width, height, text: value, fontSize: req.fontSize, color: req.color,
      };
      el.bbox = makeItem(el).bbox;
      this.transact((doc) => addElements(doc, req.pageId, [el]));
    }
    this.renderer.invalidate();
    for (const fn of this.textListeners) fn(null);
  }

  /** Met à jour le texte en cours d'édition (sans l'enregistrer). */
  updateTextEdit(patch: Partial<Pick<TextEditRequest, 'text' | 'color' | 'fontSize'>>) {
    if (this.editing) Object.assign(this.editing, patch);
  }

  // ── Images et autocollants ─────────────────────────────

  /** Pose une image (déjà enregistrée) au centre de la zone visible de la page courante. */
  insertImage(assetId: ID, naturalWidth: number, naturalHeight: number, opts: { sticker?: boolean; width?: number } = {}) {
    const page = this.layout.pages[this.currentPageIndex()];
    if (!page) return;
    const vis = this.viewport.visibleWorld();
    const cx = Math.min(Math.max((vis[0] + vis[2]) / 2, page.x), page.x + page.width) - page.x;
    const cy = Math.min(Math.max((vis[1] + vis[3]) / 2, page.y), page.y + page.height) - page.y;
    const width = opts.width ?? Math.min(page.width * 0.6, naturalWidth * 0.75);
    const height = (width * naturalHeight) / naturalWidth;
    const el: ImageElement = {
      type: 'image', id: newId(), z: nextZ(), bbox: [0, 0, 0, 0], assetId,
      x: cx - width / 2, y: cy - height / 2, width, height, ...(opts.sticker ? { sticker: true } : {}),
    };
    el.bbox = makeItem(el).bbox;
    this.transact((doc) => addElements(doc, page.id, [el]));
    this.requestTool('lasso');
    this.setSelection({ pageId: page.id, ids: [el.id] });
  }

  get doc(): Y.Doc {
    return this.nb.doc;
  }

  // ── Sélection (lasso) ──────────────────────────────────

  selection(): Selection | null {
    return this.sel;
  }

  onSelection(fn: (s: SelectionInfo | null) => void): () => void {
    this.selectionListeners.add(fn);
    fn(this.selectionInfo());
    return () => this.selectionListeners.delete(fn);
  }

  selectionInfo(): SelectionInfo | null {
    const sel = this.sel;
    const bb = this.lasso.selectionBBox(sel);
    const page = sel && this.layout.pages.find((l) => l.id === sel.pageId);
    if (!sel || !bb || !page) return null;
    const [x0, y0] = this.viewport.toScreen(page.x + bb[0], page.y + bb[1]);
    const [x1, y1] = this.viewport.toScreen(page.x + bb[2], page.y + bb[3]);
    return { count: sel.ids.length, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, dragging: this.lasso.dragging };
  }

  private emitSelection = () => {
    const info = this.selectionInfo();
    for (const fn of this.selectionListeners) fn(info);
  };

  private setSelection(sel: Selection | null) {
    this.sel = sel && sel.ids.length ? sel : null;
    this.renderer.invalidateWet();
    this.emitSelection();
    // Sélection faite au stylo (« entourer puis toucher ») levée : retour à l'outil d'origine.
    if (!this.sel && this.returnTool && this.tool === 'lasso') {
      const back = this.returnTool;
      this.returnTool = null;
      queueMicrotask(() => this.requestTool(back));
    }
  }

  clearSelection() {
    this.setSelection(null);
  }

  /** Sélectionne tout le contenu de la page courante. */
  selectAll() {
    const page = this.layout.pages[this.currentPageIndex()];
    const scene = page && this.scenes.get(page.id);
    if (scene) this.setSelection({ pageId: page.id, ids: scene.sorted().map((i) => i.id) });
  }

  /** Remplace chaque élément sélectionné par une version modifiée, en une étape annulable. */
  private updateSelected(fn: (el: PageElement) => PageElement) {
    const sel = this.sel;
    if (!sel) return;
    this.transact((doc) => {
      const els = pageElements(doc, sel.pageId);
      if (!els) return;
      for (const id of sel.ids) {
        const el = els.get(id);
        if (el) els.set(id, fn(el));
      }
    });
    this.emitSelection();
  }

  private transformSelection(m: Mat2D, widthScale: number) {
    this.updateSelected((el) => {
      // Traits : les points sont transformés, l'épaisseur suit l'agrandissement.
      // Texte et images : la matrice porte déjà l'échelle.
      const next = { ...el, transform: el.transform ? multiplyMat(m, el.transform) : m } as PageElement;
      if (next.type === 'stroke') next.width = el.type === 'stroke' ? el.width * widthScale : next.width;
      next.bbox = makeItem(next).bbox;
      return next;
    });
  }

  recolorSelection(color: string) {
    this.updateSelected((el) => (el.type === 'image' ? el : { ...el, color }));
  }

  deleteSelection() {
    const sel = this.sel;
    if (!sel) return;
    this.transact((doc) => removeElements(doc, sel.pageId, sel.ids));
    this.setSelection(null);
  }

  copySelection() {
    const sel = this.sel;
    const scene = sel && this.scenes.get(sel.pageId);
    if (!sel || !scene) return;
    clipboard = {
      pageId: sel.pageId,
      elements: sel.ids.map((id) => scene.items.get(id)?.el).filter((e): e is PageElement => !!e),
    };
    this.pasteCount = 0;
    this.emitState();
  }

  cutSelection() {
    this.copySelection();
    this.deleteSelection();
    this.pasteCount = -1;
  }

  duplicateSelection() {
    this.copySelection();
    this.paste();
  }

  /** Colle le presse-papiers sur la page courante (décalé s'il s'agit de la page d'origine). */
  paste() {
    if (!clipboard?.elements.length) return;
    const page = this.layout.pages[this.currentPageIndex()];
    if (!page) return;
    this.pasteCount++;
    const offset = clipboard.pageId === page.id ? 16 * Math.max(0, this.pasteCount) : 0;
    const shift = translateMat(offset, offset);
    const fresh = [...clipboard.elements]
      .sort((a, b) => a.z - b.z)
      .map((el) => {
        const next: PageElement = {
          ...el,
          id: newId(),
          z: nextZ(),
          transform: el.transform ? multiplyMat(shift, el.transform) : shift,
        } as PageElement;
        if (next.type === 'stroke') next.points = next.points.slice();
        next.bbox = makeItem(next).bbox;
        return next;
      });
    this.transact((doc) => addElements(doc, page.id, fresh));
    this.setSelection({ pageId: page.id, ids: fresh.map((e) => e.id) });
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

  /** Insère des pages importées (PDF, images) après `afterIndex`. */
  insertPages(pages: Omit<PageData, 'id'>[], afterIndex = this.currentPageIndex()) {
    if (!pages.length) return;
    this.transact((doc) => pages.forEach((p, k) => insertPage(doc, { ...p, id: newId() }, afterIndex + 1 + k)));
    this.scrollToPage(afterIndex + 1);
  }

  /** Miniature d'une page (panneau des pages). */
  renderThumbnail(canvas: HTMLCanvasElement, pageId: ID, cssWidth: number) {
    const scene = this.scenes.get(pageId);
    if (scene) Renderer.renderThumbnail(canvas, scene, cssWidth, Math.min(2, window.devicePixelRatio || 1), this.backgrounds);
  }

  private onBackgroundReady(bg: PageBackground) {
    for (const scene of this.scenes.values()) {
      const { page } = scene;
      const b = page.background;
      const t = page.template.source;
      const usesBg = b?.assetId === bg.assetId && !(b.kind === 'pdf' && bg.kind === 'pdf' && b.pageIndex !== bg.pageIndex);
      const usesTpl = t?.assetId === bg.assetId;
      const usesImage = bg.kind === 'image' && [...scene.items.values()].some((i) => i.el.type === 'image' && i.el.assetId === bg.assetId);
      if (!usesBg && !usesTpl && !usesImage) continue;
      scene.markFull();
      scene.version++;
      for (const fn of this.pageListeners) fn(scene.page.id);
    }
    this.renderer.invalidate();
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

  /** Ajuste le zoom à la largeur de la page courante et la centre. */
  fitWidth() {
    const current = this.currentPageIndex();
    const page = this.layout.pages[current];
    const width = page?.width ?? Math.max(...this.layout.pages.map((p) => p.width), 1);
    this.viewport.zoom = Math.min((this.viewport.width - 32) / width, 1.6);
    // Pages centrées sur x = 0 dans le monde.
    this.viewport.panX = this.viewport.width / 2;
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
    if (this.sel) this.emitSelection();
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
    // Garde le même point au centre de la vue quand la zone change de taille (panneau, rotation).
    if (this.initialised) this.viewport.panX += (Math.max(1, rect.width) - this.viewport.width) / 2;
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
    this.pruneSelection();
  };

  /** Retire de la sélection les éléments disparus (annulation, gomme, autre appareil). */
  private pruneSelection() {
    const sel = this.sel;
    if (!sel) return;
    const scene = this.scenes.get(sel.pageId);
    const ids = scene ? sel.ids.filter((id) => scene.items.has(id)) : [];
    if (ids.length !== sel.ids.length) this.setSelection(ids.length ? { pageId: sel.pageId, ids } : null);
    else this.emitSelection();
  }
}
