/**
 * Types du modèle de données de Papier.
 * Le format est décrit pour les humains dans docs/FORMAT.md : toute évolution
 * de ces types doit être répercutée là-bas et incrémenter SCHEMA_VERSION.
 *
 * Unités : toutes les coordonnées sont en points PDF (1/72 de pouce),
 * origine en haut à gauche de la page, axe Y vers le bas.
 */

export type ID = string;

/** Matrice affine 2D [a, b, c, d, e, f] (même convention que Canvas/DOMMatrix). */
export type Mat2D = [number, number, number, number, number, number];

/** [minX, minY, maxX, maxY] */
export type BBox = [number, number, number, number];

export type InkTool = 'pen' | 'highlighter';
export type Brush = 'fountain' | 'ballpoint' | 'brush';
export type DashStyle = 'solid' | 'dashed' | 'dotted';

export interface StrokeElement {
  type: 'stroke';
  id: ID;
  /** Ordre d'empilement : plus grand = dessiné plus tard. */
  z: number;
  tool: InkTool;
  brush: Brush;
  /** Couleur CSS hexadécimale (#rrggbb). */
  color: string;
  /** Épaisseur nominale en points. */
  width: number;
  opacity: number;
  dash: DashStyle;
  /** true si la pression vient du matériel (stylet), false si simulée (souris, doigt). */
  pressure: boolean;
  /** Points encodés, voir pointCodec.ts : float32 LE [x, y, pression, t] par point. */
  points: Uint8Array;
  /** Transformation appliquée aux points (déplacement/rotation par le lasso). */
  transform?: Mat2D;
  /** Boîte englobante en coordonnées de page, transformation et épaisseur incluses. */
  bbox: BBox;
  /** Horodatage absolu (ms depuis l'époque Unix) du premier point. */
  t0: number;
}

/** Union de tous les éléments posables sur une page (texte, images… aux étapes suivantes). */
export type PageElement = StrokeElement;

export type TemplateKind = 'blank' | 'lined' | 'grid' | 'dots';

export interface TemplateRef {
  kind: TemplateKind;
  /** Espacement des lignes / carreaux / points, en points. */
  spacing: number;
}

export type PageBackground =
  | { kind: 'pdf'; assetId: ID; pageIndex: number }
  | { kind: 'image'; assetId: ID };

/** Propriétés d'une page (hors éléments). */
export interface PageData {
  id: ID;
  width: number;
  height: number;
  template: TemplateRef;
  background?: PageBackground;
}

// ── Bibliothèque ─────────────────────────────────────────

export type CoverPattern = 'plain' | 'stripes' | 'dots' | 'grid' | 'diagonal';

export interface CoverSpec {
  color: string;
  pattern: CoverPattern;
}

export interface FolderRecord {
  id: ID;
  parentId: ID | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type NotebookKind = 'paged' | 'canvas';

export interface NotebookRecord {
  id: ID;
  folderId: ID | null;
  title: string;
  kind: NotebookKind;
  cover: CoverSpec;
  favorite: boolean;
  tags: string[];
  pageCount: number;
  /** Format et modèle utilisés pour les nouvelles pages. */
  paper: { width: number; height: number };
  template: TemplateRef;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
}

export interface AssetRecord {
  /** Empreinte SHA-256 hexadécimale du contenu. */
  id: ID;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}
