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
import { containsPoint, intersectsRect, layoutPages, type PageLayout } from './layout';
import { applyMat } from './geometry/geom';
import { MIN_ZOOM } from './Viewport';
import { STICKY_PAD } from './render/draw';
import type { StickyElement } from '../core/model/types';
import { BackgroundStore } from './render/backgrounds';
import { Renderer } from './render/Renderer';
import { PageScene, makeItem } from './scene';
import { EraserTool } from './tools/EraserTool';
import { InkTool } from './tools/InkTool';
import { LassoTool } from './tools/LassoTool';
import { TextTool } from './tools/TextTool';
import { StickyTool } from './tools/StickyTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { ListenTool } from './tools/ListenTool';
import { elementTime } from '../core/audio/timeline';
import type { Selection, TextEditRequest, Tool, ToolContext, ToolName, ToolStyles } from './tools/types';
import { canvasMeasure, layoutText, textBlockHeight } from './render/text';
import { parseQuery } from '../core/search/match';
import type { PdfLink, PdfTextItem } from '../core/model/types';
import { searchPages, type PageHits } from './search';

/** Données issues de l'analyse des PDF, fournies par l'interface. */
export interface PdfDataProvider {
  text(assetId: ID, pageIndex: number): PdfTextItem[] | null;
  links(assetId: ID, pageIndex: number): PdfLink[];
}
import { Viewport } from './Viewport';

/** Autre personne connectée au carnet (synchronisation) : curseur et trait en cours. */
export interface Peer {
  id: number;
  name: string;
  color: string;
  cursor?: { pageId: ID; x: number; y: number } | null;
  ink?: { pageId: ID; color: string; width: number; pts: number[] } | null;
}

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
  private pdfData: PdfDataProvider = { text: () => null, links: () => [] };
  private searchTerms: string[] = [];
  private searchHits: PageHits[] = [];
  private activeHit = -1;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchListeners = new Set<(hits: PageHits[], active: number) => void>();
  private linkListeners = new Set<(url: string) => void>();
  private listenListeners = new Set<(el: PageElement) => void>();
  /** Relecture : instant (ms Unix) jusqu'auquel l'écriture est affichée, et nombre d'éléments visibles. */
  private replayAt: number | null = null;
  private replayShown = -1;

  tool: ToolName = 'pen';
  fingerDrawing: FingerDrawing = 'auto';
  /** Carnet partagé en lecture seule : aucune modification n'est écrite. */
  readOnly = false;
  private peers: Peer[] = [];

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
      transact: (fn) => {
        if (!this.readOnly) this.nb.doc.transact(() => fn(this.nb.doc), LOCAL_ORIGIN);
      },
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
      followLink: (x, y) => this.followLink(x, y),
      listen: (el) => {
        for (const fn of this.listenListeners) fn(el);
      },
    };
    this.lasso = new LassoTool(ctx);
    this.tools = {
      pen: new InkTool(ctx, 'pen'),
      pencil: new InkTool(ctx, 'pencil'),
      highlighter: new InkTool(ctx, 'highlighter'),
      eraser: new EraserTool(ctx),
      lasso: this.lasso,
      text: new TextTool(ctx),
      sticky: new StickyTool(ctx),
      connector: new ConnectorTool(ctx),
      listen: new ListenTool(ctx),
    };
    this.renderer.overlay = (c) => {
      this.drawSearchOverlay(c);
      if (this.tool === 'lasso') this.drawLinkOverlay(c);
      if (this.tool === 'connector') (this.tools.connector as ConnectorTool).drawOverlay(c);
      this.lasso.drawOverlay(c);
      this.drawPeers(c);
    };

    this.router = new PointerRouter(this.wet, {
      viewport: this.viewport,
      tool: () => this.tools[this.tool],
      fingerDrawing: () => this.fingerDrawing,
      viewportChanged: () => this.onViewportChanged(),
      setGesture: (active) => (this.renderer.gestureActive = active),
      undo: () => this.undo(),
      redo: () => this.redo(),
      tap: (sx, sy) => {
        const [x, y] = this.viewport.toWorld(sx, sy);
        this.followLink(x, y);
      },
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
    this.searchListeners.clear();
    this.linkListeners.clear();
    this.listenListeners.clear();
    clearTimeout(this.searchTimer);
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
    // Le post-it reste affiché (l'éditeur recouvre sa zone de texte) ; une zone de texte est masquée.
    if (req.id && req.kind !== 'sticky') this.scenes.get(req.pageId)?.setHidden([req.id]);
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
    if (req.kind === 'sticky' && req.id) {
      // Post-it : il reste en place même vide ; sa hauteur suit le texte.
      const id = req.id;
      const old = scene?.items.get(id)?.el;
      if (old?.type === 'sticky' && old.text !== value) {
        const lines = layoutText(value, old.width - STICKY_PAD * 2, canvasMeasure(old.fontSize));
        const height = Math.max(old.width, textBlockHeight(lines.length, old.fontSize) + STICKY_PAD * 2);
        const next: StickyElement = { ...old, text: value, height };
        next.bbox = makeItem(next).bbox;
        this.transact((doc) => {
          addElements(doc, req.pageId, [next]);
          const els = pageElements(doc, req.pageId);
          this.syncConnectors(req.pageId, new Map([[id, next]]), (c) => els?.set(c.id, c));
        });
      }
      this.renderer.invalidate();
      for (const fn of this.textListeners) fn(null);
      return;
    }
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
    const midX = (vis[0] + vis[2]) / 2;
    const midY = (vis[1] + vis[3]) / 2;
    const cx = (page.infinite ? midX : Math.min(Math.max(midX, page.x), page.x + page.width)) - page.x;
    const cy = (page.infinite ? midY : Math.min(Math.max(midY, page.y), page.y + page.height)) - page.y;
    const width = opts.width ?? Math.min(page.infinite ? 360 : page.width * 0.6, naturalWidth * 0.75);
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
      const changed = new Map<ID, PageElement>();
      for (const id of sel.ids) {
        const el = els.get(id);
        if (!el) continue;
        const next = fn(el);
        els.set(id, next);
        changed.set(id, next);
      }
      this.syncConnectors(sel.pageId, changed, (c) => els.set(c.id, c));
    });
    this.emitSelection();
  }

  /**
   * Met à jour la position mémorisée des extrémités des connecteurs accrochés aux éléments
   * modifiés (le tracé exact suit déjà les éléments ; ceci garde le tri spatial juste).
   */
  private syncConnectors(pageId: ID, changed: Map<ID, PageElement>, write: (c: PageElement) => void) {
    const scene = this.scenes.get(pageId);
    if (!scene) return;
    const centerOf = (el: PageElement): [number, number] => {
      const b = makeItem(el).bbox;
      return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    };
    for (const item of scene.items.values()) {
      const el = item.el;
      if (el.type !== 'connector' || changed.has(el.id)) continue;
      const from = el.from.id && changed.get(el.from.id);
      const to = el.to.id && changed.get(el.to.id);
      if (!from && !to) continue;
      const next = { ...el, from: { ...el.from }, to: { ...el.to } };
      if (from) [next.from.x, next.from.y] = centerOf(from);
      if (to) [next.to.x, next.to.y] = centerOf(to);
      next.bbox = makeItem(next).bbox;
      write(next);
    }
  }

  private transformSelection(m: Mat2D, widthScale: number) {
    this.updateSelected((el) => {
      // Traits : les points sont transformés, l'épaisseur suit l'agrandissement.
      // Texte et images : la matrice porte déjà l'échelle.
      if (el.type === 'connector') {
        // Connecteur : ses extrémités libres suivent ; les extrémités accrochées restent accrochées.
        const move = (e: typeof el.from) => {
          const [x, y] = applyMat(m, e.x, e.y);
          return { ...e, x, y };
        };
        const next = { ...el, from: move(el.from), to: move(el.to), width: el.width * widthScale };
        next.bbox = makeItem(next).bbox;
        return next;
      }
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
    // Supprimer un élément supprime aussi les connecteurs qui y sont accrochés.
    const gone = new Set(sel.ids);
    const scene = this.scenes.get(sel.pageId);
    for (const item of scene?.items.values() ?? []) {
      const el = item.el;
      if (el.type === 'connector' && ((el.from.id && gone.has(el.from.id)) || (el.to.id && gone.has(el.to.id)))) gone.add(el.id);
    }
    this.transact((doc) => removeElements(doc, sel.pageId, gone));
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
    if (this.readOnly) return;
    const { meta } = roots(this.nb.doc);
    if (meta.get('title') !== title) meta.set('title', title);
  }

  // ── Audio : écoute et relecture de l'écriture ──────────

  /** Élément touché avec l'outil d'écoute. */
  onListen(fn: (el: PageElement) => void): () => void {
    this.listenListeners.add(fn);
    return () => this.listenListeners.delete(fn);
  }

  /** Éléments sélectionnés (pour « écouter depuis la sélection »). */
  selectedElements(): PageElement[] {
    const sel = this.sel;
    const scene = sel && this.scenes.get(sel.pageId);
    return sel && scene ? sel.ids.map((id) => scene.items.get(id)?.el).filter((e): e is PageElement => !!e) : [];
  }

  /**
   * Relecture synchronisée : seuls les éléments écrits avant `t` (ms Unix) sont affichés
   * normalement, les suivants sont estompés. `null` rétablit l'affichage normal.
   */
  setReplay(t: number | null) {
    if (t === null) {
      if (this.replayAt === null) return;
      this.replayAt = null;
      this.replayShown = -1;
      this.renderer.ghost = null;
      for (const scene of this.scenes.values()) scene.markFull();
      this.renderer.invalidate();
      return;
    }
    this.replayAt = t;
    // On ne redessine que si l'ensemble des éléments affichés a changé.
    let shown = 0;
    for (const scene of this.scenes.values()) {
      for (const item of scene.items.values()) {
        const et = elementTime(item.el);
        if (et === null || et <= t) shown++;
      }
    }
    if (shown === this.replayShown && this.renderer.ghost) return;
    this.replayShown = shown;
    this.renderer.ghost = (item) => {
      const et = elementTime(item.el);
      return et !== null && this.replayAt !== null && et > this.replayAt;
    };
    this.renderer.invalidate();
  }

  /** Fait apparaître un élément à l'écran (centré s'il est hors de la vue). */
  revealElement(el: PageElement) {
    for (const l of this.layout.pages) {
      if (!this.scenes.get(l.id)?.items.has(el.id)) continue;
      const b = el.bbox;
      const [vx0, vy0, vx1, vy1] = this.viewport.visibleWorld();
      const x0 = l.x + b[0], y0 = l.y + b[1], x1 = l.x + b[2], y1 = l.y + b[3];
      if (x0 >= vx0 && x1 <= vx1 && y0 >= vy0 && y1 <= vy1) return;
      if (l.infinite) this.centerOn((x0 + x1) / 2, (y0 + y1) / 2);
      else {
        this.viewport.panY = this.viewport.height / 3 - ((y0 + y1) / 2) * this.viewport.zoom;
        this.onViewportChanged();
      }
      return;
    }
  }

  /** Dernier élément écrit avant l'instant `t` (ms Unix), pour suivre la lecture. */
  latestElementBefore(t: number, since: number): PageElement | null {
    let best: PageElement | null = null;
    let bestT = since;
    for (const scene of this.scenes.values()) {
      for (const item of scene.items.values()) {
        const et = elementTime(item.el);
        if (et !== null && et <= t && et >= bestT) {
          best = item.el;
          bestT = et;
        }
      }
    }
    return best;
  }

  // ── Présence (carnet synchronisé) ───────────────────────

  /** Point de page sous une position écran (pixels CSS dans la zone de dessin). */
  locate(sx: number, sy: number): { pageId: ID; x: number; y: number } | null {
    const [x, y] = this.viewport.toWorld(sx, sy);
    const l = this.layout.pages.find((p) => containsPoint(p, x, y));
    return l ? { pageId: l.id, x: Math.round((x - l.x) * 10) / 10, y: Math.round((y - l.y) * 10) / 10 } : null;
  }

  /** Trait en cours d'écriture (allégé), pour que les autres le voient se former. */
  liveStroke(): Peer['ink'] {
    const wet = this.renderer.wet;
    const el = wet?.item.el;
    if (!wet || el?.type !== 'stroke') return null;
    const src = wet.item.pts;
    const n = src.length / 4;
    const step = Math.max(1, Math.ceil(n / 200));
    const pts: number[] = [];
    for (let i = 0; i < n; i += step) pts.push(Math.round(src[i * 4] * 10) / 10, Math.round(src[i * 4 + 1] * 10) / 10);
    return { pageId: wet.pageId, color: el.color, width: el.width, pts };
  }

  setPeers(peers: Peer[]) {
    this.peers = peers;
    this.renderer.invalidateWet();
  }

  private drawPeers(c: CanvasRenderingContext2D) {
    if (!this.peers.length) return;
    const vp = this.viewport;
    for (const p of this.peers) {
      const ink = p.ink;
      const l = ink && this.layout.pages.find((x) => x.id === ink.pageId);
      if (ink && l && ink.pts.length >= 4) {
        this.pageTransform(c, l);
        c.globalAlpha = 0.75;
        c.strokeStyle = ink.color;
        c.lineWidth = Math.max(ink.width, 1 / vp.zoom);
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(ink.pts[0], ink.pts[1]);
        for (let i = 2; i < ink.pts.length; i += 2) c.lineTo(ink.pts[i], ink.pts[i + 1]);
        c.stroke();
        c.globalAlpha = 1;
      }
      const cur = p.cursor;
      const cl = cur && this.layout.pages.find((x) => x.id === cur.pageId);
      if (!cur || !cl) continue;
      const [sx, sy] = vp.toScreen(cl.x + cur.x, cl.y + cur.y);
      const d = vp.dpr;
      c.setTransform(d, 0, 0, d, 0, 0);
      c.fillStyle = p.color;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + 4, sy + 13);
      c.lineTo(sx + 7.5, sy + 8.5);
      c.lineTo(sx + 13, sy + 7);
      c.closePath();
      c.fill();
      c.font = '600 11px system-ui, sans-serif';
      const w = c.measureText(p.name).width + 10;
      c.beginPath();
      c.roundRect(sx + 10, sy + 12, w, 17, 8);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(p.name, sx + 15, sy + 24.5);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ── PDF : liens, sommaire, recherche ────────────────────

  /** Branche le texte et les liens extraits des PDF (chargés par l'interface). */
  setPdfData(provider: PdfDataProvider) {
    this.pdfData = provider;
    if (this.searchTerms.length) this.runSearch();
    this.renderer.invalidateWet();
  }

  /** Adresse web d'un lien touché : l'interface décide comment l'ouvrir. */
  onExternalLink(fn: (url: string) => void): () => void {
    this.linkListeners.add(fn);
    return () => this.linkListeners.delete(fn);
  }

  /** Va à la page du carnet issue de la page `pageIndex` du PDF `assetId`. */
  goToPdfPage(assetId: ID, pageIndex: number, top?: number): boolean {
    const l = this.layout.pages.find((p) => {
      const bg = this.scenes.get(p.id)?.page.background;
      return bg?.kind === 'pdf' && bg.assetId === assetId && bg.pageIndex === pageIndex;
    });
    if (!l) return false;
    this.scrollToPage(l.index, top);
    return true;
  }

  /** Suit le lien PDF situé en (x, y) (coordonnées monde), s'il y en a un. */
  followLink(x: number, y: number): boolean {
    const l = this.layout.pages.find((p) => containsPoint(p, x, y));
    const bg = l && this.scenes.get(l.id)?.page.background;
    if (!l || bg?.kind !== 'pdf') return false;
    const lx = x - l.x, ly = y - l.y;
    const link = this.pdfData.links(bg.assetId, bg.pageIndex).find((k) => lx >= k.rect[0] && lx <= k.rect[2] && ly >= k.rect[1] && ly <= k.rect[3]);
    if (!link) return false;
    if (link.url) for (const fn of this.linkListeners) fn(link.url);
    else if (link.pageIndex !== undefined) this.goToPdfPage(bg.assetId, link.pageIndex, link.top);
    return true;
  }

  onSearchResults(fn: (hits: PageHits[], active: number) => void): () => void {
    this.searchListeners.add(fn);
    return () => this.searchListeners.delete(fn);
  }

  /** Lance (ou efface, si vide) la recherche dans le carnet ; les occurrences sont surlignées. */
  setSearch(query: string) {
    this.searchTerms = parseQuery(query);
    this.activeHit = -1;
    this.runSearch();
  }

  private runSearch() {
    this.searchHits = searchPages(this.layout.pages, (id) => this.scenes.get(id), this.searchTerms, (a, p) => this.pdfData.text(a, p));
    if (this.activeHit >= this.searchHits.length) this.activeHit = this.searchHits.length - 1;
    this.renderer.invalidateWet();
    for (const fn of this.searchListeners) fn(this.searchHits, this.activeHit);
  }

  /** Affiche le résultat n° `i` (page centrée sur sa première occurrence). */
  focusSearchResult(i: number) {
    const hit = this.searchHits[i];
    if (!hit) return;
    this.activeHit = i;
    const l = this.layout.pages.find((p) => p.id === hit.pageId);
    if (l?.infinite && hit.quads.length) {
      const q = hit.quads[0];
      this.centerOn(l.x + (q[0] + q[4]) / 2, l.y + (q[1] + q[5]) / 2);
    } else if (l) {
      const ys = hit.quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
      const top = ys.length ? Math.min(...ys) : 0;
      const visible = this.viewport.height / this.viewport.zoom;
      this.viewport.panY = this.viewport.height / 3 - (l.y + top) * this.viewport.zoom;
      if (!ys.length || top < visible / 3) this.scrollToPage(l.index);
      else this.onViewportChanged();
    }
    this.renderer.invalidateWet();
    for (const fn of this.searchListeners) fn(this.searchHits, this.activeHit);
  }

  private pageTransform(c: CanvasRenderingContext2D, l: PageLayout) {
    const vp = this.viewport;
    const t = vp.zoom * vp.dpr;
    c.setTransform(t, 0, 0, t, (l.x * vp.zoom + vp.panX) * vp.dpr, (l.y * vp.zoom + vp.panY) * vp.dpr);
  }

  private drawSearchOverlay(c: CanvasRenderingContext2D) {
    if (!this.searchHits.length) return;
    const [vx0, vy0, vx1, vy1] = this.viewport.visibleWorld();
    this.searchHits.forEach((hit, i) => {
      const l = this.layout.pages.find((p) => p.id === hit.pageId);
      if (!l || !intersectsRect(l, vx0, vy0, vx1, vy1)) return;
      this.pageTransform(c, l);
      c.fillStyle = i === this.activeHit ? 'rgba(255, 150, 20, 0.55)' : 'rgba(255, 214, 10, 0.45)';
      for (const q of hit.quads) {
        c.beginPath();
        c.moveTo(q[0], q[1]);
        c.lineTo(q[2], q[3]);
        c.lineTo(q[4], q[5]);
        c.lineTo(q[6], q[7]);
        c.closePath();
        c.fill();
      }
    });
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Avec le lasso, les liens des PDF sont matérialisés (toucher = suivre le lien). */
  private drawLinkOverlay(c: CanvasRenderingContext2D) {
    const [, vy0, , vy1] = this.viewport.visibleWorld();
    for (const l of this.layout.pages) {
      if (l.y > vy1 || l.y + l.height < vy0) continue;
      const bg = this.scenes.get(l.id)?.page.background;
      if (bg?.kind !== 'pdf') continue;
      const links = this.pdfData.links(bg.assetId, bg.pageIndex);
      if (!links.length) continue;
      this.pageTransform(c, l);
      c.fillStyle = 'rgba(52, 97, 201, 0.10)';
      c.strokeStyle = 'rgba(52, 97, 201, 0.55)';
      c.lineWidth = 1 / this.viewport.zoom;
      for (const k of links) {
        const [x0, y0, x1, y1] = k.rect;
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        c.beginPath();
        c.moveTo(x0, y1);
        c.lineTo(x1, y1);
        c.stroke();
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
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
    if (this.readOnly) return;
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

  /** Carnet « tableau blanc » (page unique sans bords) ? */
  get infinite(): boolean {
    return !!this.layout.pages[0]?.infinite;
  }

  private clampView() {
    if (this.layout.bounds) this.viewport.clamp(this.layout.bounds);
  }

  /** Centre la vue sur un point du monde. */
  centerOn(x: number, y: number) {
    this.viewport.panX = this.viewport.width / 2 - x * this.viewport.zoom;
    this.viewport.panY = this.viewport.height / 2 - y * this.viewport.zoom;
    this.onViewportChanged();
  }

  /** Tableau blanc : zoom et cadrage pour voir tout le contenu. */
  fitContent() {
    const l = this.layout.pages[0];
    const scene = l && this.scenes.get(l.id);
    const boxes = scene ? [...scene.items.values()].map((i) => i.bbox) : [];
    const vp = this.viewport;
    if (!l || !boxes.length) {
      vp.zoom = 1;
      this.centerOn(0, 0);
      return;
    }
    const [x0, y0, x1, y1] = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    vp.zoom = Math.max(vp.minZoom, Math.min(2, (vp.width - 80) / (x1 - x0 || 1), (vp.height - 80) / (y1 - y0 || 1)));
    this.centerOn(l.x + (x0 + x1) / 2, l.y + (y0 + y1) / 2);
  }

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

  /** Fait défiler jusqu'à la page `index` ; `top` (points) vise une hauteur précise dans la page. */
  scrollToPage(index: number, top?: number) {
    const l = this.layout.pages[index];
    if (!l || l.infinite) return;
    this.viewport.panY = top ? TOP_MARGIN * 3 - (l.y + top) * this.viewport.zoom : TOP_MARGIN - l.y * this.viewport.zoom;
    this.onViewportChanged();
  }

  /** Ajuste le zoom à la largeur de la page courante et la centre (tableau blanc : tout afficher). */
  fitWidth() {
    if (this.infinite) return this.fitContent();
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
    this.clampView();
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
    // Tableau blanc : on peut dézoomer bien plus loin pour avoir une vue d'ensemble.
    this.viewport.minZoom = this.infinite ? 0.08 : MIN_ZOOM;
  }

  private onOrderEvent = () => {
    this.relayout();
    this.clampView();
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
      this.clampView();
      this.emitState();
    }
    this.renderer.invalidate();
    for (const id of changed) for (const fn of this.pageListeners) fn(id);
    this.pruneSelection();
    if (this.searchTerms.length) {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.runSearch(), 300);
    }
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
