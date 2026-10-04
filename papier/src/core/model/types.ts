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

export type InkTool = 'pen' | 'pencil' | 'highlighter';
export type Brush = 'fountain' | 'ballpoint' | 'brush';
export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type ShapeKind = 'line' | 'ellipse' | 'rect' | 'triangle' | 'polygon';

interface ElementBase {
  id: ID;
  /** Ordre d'empilement : plus grand = dessiné plus tard. */
  z: number;
  /** Boîte englobante en coordonnées de page, transformation et épaisseur incluses. */
  bbox: BBox;
  /**
   * Transformation (déplacement, échelle, rotation par le lasso).
   * Traits : appliquée aux points. Texte et images : appliquée au rectangle local.
   */
  transform?: Mat2D;
}

export interface StrokeElement extends ElementBase {
  type: 'stroke';
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
  /** Horodatage absolu (ms depuis l'époque Unix) du premier point. */
  t0: number;
  /** Forme reconnue : les points sont alors les sommets, reliés par des segments droits. */
  shape?: ShapeKind;
  /** Forme fermée (le dernier sommet est relié au premier). */
  closed?: boolean;
}

export interface TextElement extends ElementBase {
  type: 'text';
  /** Coin haut-gauche et largeur de la zone (le texte revient à la ligne). */
  x: number;
  y: number;
  width: number;
  /** Hauteur calculée à la saisie (pour la boîte englobante). */
  height: number;
  text: string;
  /** Taille de police en points. */
  fontSize: number;
  color: string;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: ID;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Autocollant (image intégrée à l'application) plutôt que photo importée. */
  sticker?: boolean;
}

/** Post-it : carré coloré contenant du texte (tableau blanc, cartes mentales). */
export interface StickyElement extends ElementBase {
  type: 'sticky';
  x: number;
  y: number;
  width: number;
  /** Hauteur : au moins la largeur, agrandie si le texte déborde. */
  height: number;
  /** Couleur du papier du post-it. */
  color: string;
  text: string;
  fontSize: number;
}

/** Extrémité de connecteur : accrochée à un élément (id) ou libre ; x, y = dernière position connue. */
export interface ConnectorEnd {
  id?: ID;
  x: number;
  y: number;
}

/** Connecteur (flèche courbe) reliant deux éléments ou deux points. */
export interface ConnectorElement extends ElementBase {
  type: 'connector';
  from: ConnectorEnd;
  to: ConnectorEnd;
  color: string;
  width: number;
  arrow: 'end' | 'both' | 'none';
  dash: DashStyle;
}

/** Union de tous les éléments posables sur une page. */
export type PageElement = StrokeElement | TextElement | ImageElement | StickyElement | ConnectorElement;

/** Éléments posés dans un rectangle local (+ matrice) : texte, image, post-it. */
export type BoxElement = TextElement | ImageElement | StickyElement;

export type TemplateKind = 'blank' | 'lined' | 'grid' | 'dots' | 'cornell' | 'planner' | 'custom';

export interface TemplateRef {
  kind: TemplateKind;
  /** Espacement des lignes / carreaux / points, en points. */
  spacing: number;
  /** Modèle importé (kind = 'custom') : image ou page de PDF étirée sur la page. */
  source?: { assetId: ID; kind: 'image' | 'pdf'; pageIndex: number; templateId?: ID; name?: string };
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
  /**
   * Page sans bords (tableau blanc) : origine au centre, coordonnées libres.
   * `width` et `height` sont alors purement indicatifs.
   */
  infinite?: boolean;
}

// ── Audio ────────────────────────────────────────────────

/**
 * Plage d'enregistrement continue (sans pause) : de `start` à `end` (ms, horloge Unix),
 * qui commence à `offset` secondes dans le fichier audio.
 */
export interface RecordingSpan {
  start: number;
  end: number;
  offset: number;
}

/** Phrase transcrite : début et fin en secondes dans le fichier audio. */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  /** Moteur utilisé (ex. « whisper-local ») et modèle. */
  provider: string;
  model?: string;
  /** Code de langue (« fr », « en »…) ou « auto ». */
  language: string;
  createdAt: number;
  segments: TranscriptSegment[];
}

/** Enregistrement audio d'un carnet, synchronisé avec l'écriture par ses plages horaires. */
export interface RecordingData {
  id: ID;
  /** Fichier audio (table `assets`). */
  assetId: ID;
  mime: string;
  title: string;
  /** Début de l'enregistrement (ms, horloge Unix). */
  createdAt: number;
  /** Durée en secondes. */
  duration: number;
  /** Plages horaires enregistrées ; vide pour un fichier importé (pas de synchronisation). */
  spans: RecordingSpan[];
  transcript?: Transcript;
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

/** Carnet reçu par un lien de partage (il appartient à quelqu'un d'autre). */
export interface ShareRef {
  /** Serveur Papier qui héberge le carnet. */
  server: string;
  token: string;
  mode: 'view' | 'edit';
  /** Nom du propriétaire. */
  owner: string;
}

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
  /** Présent si le carnet vient d'un lien de partage (non synchronisé avec la bibliothèque du compte). */
  share?: ShareRef;
}

/** Modèle de page importé par l'utilisateur. */
export interface TemplateRecord {
  id: ID;
  name: string;
  assetId: ID;
  kind: 'image' | 'pdf';
  pageIndex: number;
  /** Format d'origine (points), proposé pour les nouvelles pages. */
  width: number;
  height: number;
  createdAt: number;
}

export interface AssetRecord {
  /** Empreinte SHA-256 hexadécimale du contenu. */
  id: ID;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

// ── Données dérivées (recalculables, non exportées) ─────

/** Morceau de texte d'une page de PDF, positionné dans le repère de la page Papier. */
export interface PdfTextItem {
  s: string;
  /** Coin haut-gauche, largeur et hauteur approximatives (points). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fin de ligne après ce morceau. */
  eol?: boolean;
}

export interface PdfPageTextRecord {
  /** `${assetId}#${pageIndex}` */
  id: string;
  assetId: ID;
  pageIndex: number;
  items: PdfTextItem[];
}

/** Cible d'un lien ou d'une entrée de sommaire : page du PDF (et hauteur), ou adresse web. */
export interface PdfTarget {
  pageIndex?: number;
  /** Position verticale visée dans la page (points depuis le haut). */
  top?: number;
  url?: string;
}

export interface PdfOutlineNode extends PdfTarget {
  title: string;
  children: PdfOutlineNode[];
}

export interface PdfLink extends PdfTarget {
  /** Zone cliquable [minX, minY, maxX, maxY] dans le repère de la page. */
  rect: BBox;
}

export interface PdfMetaRecord {
  assetId: ID;
  /** Nom du fichier d'origine (sans extension). */
  name: string;
  numPages: number;
  outline: PdfOutlineNode[];
  /** Liens par page (indice = numéro de page du PDF à partir de 0). */
  links: PdfLink[][];
  version: number;
  analyzedAt: number;
}

/** Texte tapé de chaque page d'un carnet, pour la recherche dans la bibliothèque. */
export interface NotebookIndexRecord {
  notebookId: ID;
  updatedAt: number;
  pages: { pageId: ID; texts: string[]; pdf?: { assetId: ID; pageIndex: number } }[];
  /** Transcriptions des enregistrements (une chaîne par phrase). */
  audio?: { recordingId: ID; title: string; texts: string[] }[];
}
