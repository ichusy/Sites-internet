import type * as Y from 'yjs';
import type { Brush, DashStyle, ID, Mat2D, PageElement } from '../../core/model/types';
import type { PageLayout } from '../layout';
import type { Renderer } from '../render/Renderer';
import type { PageScene } from '../scene';
import type { Viewport } from '../Viewport';

export type ToolName = 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'lasso' | 'text' | 'sticky' | 'connector' | 'listen';

/** Éléments sélectionnés au lasso (toujours sur une seule page). */
export interface Selection {
  pageId: ID;
  ids: ID[];
}

export interface PenStyle {
  brush: Brush;
  color: string;
  width: number;
  dash: DashStyle;
}

export interface PencilStyle {
  color: string;
  width: number;
}

export interface TextStyle {
  color: string;
  /** Taille de police en points. */
  size: number;
}

export interface StickyStyle {
  /** Couleur du papier. */
  color: string;
  size: number;
}

export interface ConnectorStyle {
  color: string;
  width: number;
  arrow: 'end' | 'both' | 'none';
}

/** Gestes optionnels (désactivables dans les réglages de l'outil). */
export interface GestureSettings {
  /** Maintenir la pointe immobile en fin de tracé : ligne, cercle, rectangle… */
  shapeRecognition: boolean;
  /** Gribouiller par-dessus des traits pour les effacer. */
  scribbleErase: boolean;
  /** Entourer avec le stylo puis toucher l'intérieur pour sélectionner. */
  loopSelect: boolean;
}

export interface HighlighterStyle {
  color: string;
  width: number;
}

export interface EraserStyle {
  /** 'stroke' efface le trait entier, 'partial' seulement la partie touchée. */
  mode: 'stroke' | 'partial';
  /** Diamètre en pixels écran. */
  size: number;
}

export interface ToolStyles {
  pen: PenStyle;
  pencil: PencilStyle;
  highlighter: HighlighterStyle;
  eraser: EraserStyle;
  text: TextStyle;
  sticky: StickyStyle;
  connector: ConnectorStyle;
  gestures: GestureSettings;
}

/** Un échantillon de pointeur, en coordonnées monde (x, y) et écran (sx, sy). */
export interface ToolInput {
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Pression 0..1 telle que fournie par le navigateur. */
  p: number;
  /** Horodatage de l'événement (ms, horloge performance). */
  t: number;
  pointerType: string;
}

/** Ce que l'éditeur met à disposition des outils. */
export interface ToolContext {
  viewport: Viewport;
  renderer: Renderer;
  styles: ToolStyles;
  layouts(): PageLayout[];
  scene(id: ID): PageScene | undefined;
  /** Démarre une nouvelle étape d'annulation. */
  beginAction(): void;
  /** Modifie le document (transaction locale, annulable). */
  transact(fn: (doc: Y.Doc) => void): void;
  selection(): Selection | null;
  setSelection(sel: Selection | null): void;
  /** Applique une transformation (et un facteur d'épaisseur) à la sélection, en une étape annulable. */
  transformSelection(m: Mat2D, widthScale: number): void;
  /** Annule la dernière action (geste « entourer puis toucher »). */
  undoLast(): void;
  /** Bascule sur le lasso avec ces éléments sélectionnés, puis revient à l'outil courant. */
  selectWithLasso(sel: Selection): void;
  /** Demande l'édition d'une zone de texte (existante ou nouvelle). */
  editText(req: TextEditRequest): void;
  /** Suit le lien PDF en (x, y) (coordonnées monde) ; vrai si un lien a été trouvé. */
  followLink(x: number, y: number): boolean;
  /** Outil d'écoute : élément touché (l'interface lit l'audio du moment où il a été écrit). */
  listen(el: PageElement): void;
}

/** Zone de texte à éditer, en coordonnées de page. */
export interface TextEditRequest {
  pageId: ID;
  /** null pour une nouvelle zone. */
  id: ID | null;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  text: string;
  /** Transformation de la zone existante (rotation, échelle). */
  transform?: Mat2D;
  /** Texte d'un post-it (zone intérieure) plutôt que zone de texte libre. */
  kind?: 'text' | 'sticky';
  /** Fond de l'éditeur (couleur du post-it). */
  background?: string;
}

export interface Tool {
  down(i: ToolInput): void;
  move(points: ToolInput[], predicted: ToolInput[]): void;
  up(i: ToolInput): void;
  cancel(): void;
  hover?(i: ToolInput | null): void;
}
