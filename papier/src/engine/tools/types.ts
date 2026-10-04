import type * as Y from 'yjs';
import type { Brush, DashStyle, ID } from '../../core/model/types';
import type { PageLayout } from '../layout';
import type { Renderer } from '../render/Renderer';
import type { PageScene } from '../scene';
import type { Viewport } from '../Viewport';

export type ToolName = 'pen' | 'highlighter' | 'eraser';

export interface PenStyle {
  brush: Brush;
  color: string;
  width: number;
  dash: DashStyle;
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
  highlighter: HighlighterStyle;
  eraser: EraserStyle;
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
}

export interface Tool {
  down(i: ToolInput): void;
  move(points: ToolInput[], predicted: ToolInput[]): void;
  up(i: ToolInput): void;
  cancel(): void;
  hover?(i: ToolInput | null): void;
}
