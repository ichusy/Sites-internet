import type { BBox, ConnectorElement, ID, ImageElement, PageData, StickyElement, StrokeElement, TextElement } from '../../core/model/types';
import { arrowHead, connectorCurve } from '../geometry/connector';
import { isCenterline, isHighlight, itemPath, resolveEnd, type ItemLookup, type RenderItem } from '../scene';
import { pencilPattern } from './pencil';
import {
  DOT_COLOR, LABEL_COLOR, LINE_COLOR, MARGIN_COLOR, PAPER_COLOR, STRUCTURE_COLOR, templatePrimitives, type Segment,
} from './templates';
import { BASELINE, LINE_HEIGHT, TEXT_FONT, canvasMeasure, layoutText } from './text';

export { PAPER_COLOR };

/** Marge intérieure d'un post-it (points). */
export const STICKY_PAD = 12;
export const STICKY_TEXT_COLOR = '#1f2430';
export const BOARD_COLOR = '#fbfbf8';
const BOARD_DOT = '#c4cad6';

export type { ItemLookup };

/** Ressources asynchrones (images, fonds de page) fournies par le moteur. */
export interface RenderResources {
  image(assetId: ID): CanvasImageSource | null;
  pageBackground(page: PageData, scale: number): CanvasImageSource | null;
  templateImage(page: PageData, scale: number): CanvasImageSource | null;
}

function strokeSegments(ctx: CanvasRenderingContext2D, segs: Segment[], color: string, width: number) {
  if (!segs.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

/**
 * Dessine le fond d'une page dans son repère : papier, modèle importé, fond importé
 * (page de PDF ou image), puis les lignes du modèle.
 * `scale` = pixels par point, pour garder des traits d'au moins un pixel.
 */
export function drawTemplate(ctx: CanvasRenderingContext2D, page: PageData, scale: number, res?: RenderResources | null) {
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const tpl = res?.templateImage(page, scale);
  if (tpl) ctx.drawImage(tpl, 0, 0, page.width, page.height);
  const bg = res?.pageBackground(page, scale);
  if (bg) ctx.drawImage(bg, 0, 0, page.width, page.height);

  const prim = templatePrimitives(page);
  const hair = Math.max(0.5, 1 / scale);
  ctx.save();
  strokeSegments(ctx, prim.lines, LINE_COLOR, hair);
  strokeSegments(ctx, prim.accents, MARGIN_COLOR, hair);
  strokeSegments(ctx, prim.structure, STRUCTURE_COLOR, Math.max(0.8, 1 / scale));
  if (prim.dots.length) {
    ctx.fillStyle = DOT_COLOR;
    const r = Math.max(0.6, 1.2 / scale);
    for (const [x, y] of prim.dots) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  if (prim.labels.length) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.textBaseline = 'alphabetic';
    for (const l of prim.labels) {
      ctx.font = `${l.size}px ${TEXT_FONT}`;
      ctx.fillText(l.text, l.x, l.y);
    }
  }
  ctx.restore();
}

function drawStroke(ctx: CanvasRenderingContext2D, el: StrokeElement, path: Path2D) {
  // Multiplie l'opacité courante : un élément « fantôme » (relecture audio) reste estompé.
  ctx.globalAlpha *= el.opacity;
  if (el.tool === 'highlighter') {
    // Le surligneur « multiplie » : il colore le papier sans masquer l'encre ni le texte du PDF.
    ctx.globalCompositeOperation = 'multiply';
  }
  if (isCenterline(el)) {
    ctx.strokeStyle = el.tool === 'pencil' ? pencilPattern(ctx, el.color) : el.color;
    ctx.lineWidth = el.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = el.tool === 'highlighter' && !el.shape ? 'butt' : 'round';
    if (el.dash === 'dotted') {
      ctx.lineCap = 'round';
      ctx.setLineDash([0.01, el.width * 2.2]);
    } else if (el.dash === 'dashed') {
      ctx.lineCap = 'butt';
      ctx.setLineDash([el.width * 4, el.width * 2.5]);
    }
    ctx.stroke(path);
  } else {
    ctx.fillStyle = el.tool === 'pencil' ? pencilPattern(ctx, el.color) : el.color;
    ctx.fill(path);
  }
}

/** Lignes d'une zone de texte ou d'un post-it, mises en cache sur l'élément de rendu. */
export function textLines(item: RenderItem): string[] {
  const el = item.el as TextElement | StickyElement;
  const width = el.type === 'sticky' ? el.width - STICKY_PAD * 2 : el.width;
  item.lines ??= layoutText(el.text, width, canvasMeasure(el.fontSize));
  return item.lines;
}

function drawSticky(ctx: CanvasRenderingContext2D, item: RenderItem) {
  const el = item.el as StickyElement;
  ctx.transform(...item.matrix!);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.16)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = el.color;
  ctx.fillRect(el.x, el.y, el.width, el.height);
  ctx.restore();
  // Léger dégradé en bas, comme un papier qui se décolle.
  ctx.fillStyle = 'rgba(0,0,0,0.04)';
  ctx.fillRect(el.x, el.y + el.height * 0.82, el.width, el.height * 0.18);
  ctx.fillStyle = STICKY_TEXT_COLOR;
  ctx.font = `${el.fontSize}px ${TEXT_FONT}`;
  ctx.textBaseline = 'alphabetic';
  const lh = el.fontSize * LINE_HEIGHT;
  textLines(item).forEach((line, i) => ctx.fillText(line, el.x + STICKY_PAD, el.y + STICKY_PAD + i * lh + el.fontSize * BASELINE));
}

function drawConnector(ctx: CanvasRenderingContext2D, item: RenderItem, lookup?: ItemLookup | null) {
  const el = item.el as ConnectorElement;
  const c = connectorCurve(resolveEnd(el.from, lookup), resolveEnd(el.to, lookup));
  ctx.strokeStyle = el.color;
  ctx.fillStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const head = Math.max(8, el.width * 4);
  if (el.dash === 'dashed') ctx.setLineDash([el.width * 4, el.width * 3]);
  else if (el.dash === 'dotted') ctx.setLineDash([0.01, el.width * 2.5]);
  ctx.beginPath();
  ctx.moveTo(...c.p0);
  ctx.bezierCurveTo(...c.c1, ...c.c2, ...c.p1);
  ctx.stroke();
  ctx.setLineDash([]);
  const heads = el.arrow === 'both' ? [arrowHead(c.p1, c.c2, head), arrowHead(c.p0, c.c1, head)] : el.arrow === 'end' ? [arrowHead(c.p1, c.c2, head)] : [];
  for (const [a, b, d] of heads) {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineTo(...d);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Fond d'un tableau blanc infini sur le rectangle visible (repère de la page) :
 * papier uni et points dont l'espacement double quand on dézoome (jamais moins de 12 px).
 */
export function drawBoardBackground(ctx: CanvasRenderingContext2D, page: PageData, rect: BBox, scale: number) {
  const [x0, y0, x1, y1] = rect;
  ctx.fillStyle = BOARD_COLOR;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  let step = page.template.spacing > 0 ? page.template.spacing : 20;
  while (step * scale < 12) step *= 2;
  ctx.fillStyle = BOARD_DOT;
  const r = Math.max(1, 1.6 / scale) * Math.min(2, step / 20);
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
}

function drawText(ctx: CanvasRenderingContext2D, item: RenderItem) {
  const el = item.el as TextElement;
  ctx.transform(...item.matrix!);
  ctx.fillStyle = el.color;
  ctx.font = `${el.fontSize}px ${TEXT_FONT}`;
  ctx.textBaseline = 'alphabetic';
  const lh = el.fontSize * LINE_HEIGHT;
  textLines(item).forEach((line, i) => ctx.fillText(line, el.x, el.y + i * lh + el.fontSize * BASELINE));
}

function drawImage(ctx: CanvasRenderingContext2D, item: RenderItem, res?: RenderResources | null) {
  const el = item.el as ImageElement;
  ctx.transform(...item.matrix!);
  const img = res?.image(el.assetId);
  if (img) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, el.x, el.y, el.width, el.height);
  } else {
    // Emplacement pendant le chargement.
    ctx.fillStyle = 'rgba(120,130,150,0.12)';
    ctx.fillRect(el.x, el.y, el.width, el.height);
  }
}

/** Dessine un élément dans le repère de la page. */
export function drawItem(
  ctx: CanvasRenderingContext2D,
  item: RenderItem,
  res?: RenderResources | null,
  path?: Path2D,
  lookup?: ItemLookup | null,
) {
  const el = item.el;
  ctx.save();
  if (el.type === 'stroke') drawStroke(ctx, el, path ?? itemPath(item));
  else if (el.type === 'text') drawText(ctx, item);
  else if (el.type === 'sticky') drawSticky(ctx, item);
  else if (el.type === 'connector') drawConnector(ctx, item, lookup);
  else drawImage(ctx, item, res);
  ctx.restore();
}

/**
 * Rendu vectoriel complet d'une page : fond, puis surligneurs, puis le reste dans l'ordre z.
 * Le surligneur est dessiné en premier pour passer derrière l'encre.
 */
export function drawPageContent(
  ctx: CanvasRenderingContext2D,
  page: PageData,
  items: RenderItem[],
  scale: number,
  res?: RenderResources | null,
  lookup?: ItemLookup | null,
  ghost?: ((item: RenderItem) => boolean) | null,
) {
  drawTemplate(ctx, page, scale, res);
  drawItems(ctx, items, res, lookup, ghost);
}

/** Opacité des éléments pas encore écrits pendant la relecture synchronisée avec l'audio. */
export const GHOST_ALPHA = 0.16;

/**
 * Surligneurs d'abord (derrière l'encre), puis le reste dans l'ordre z.
 * `ghost` : éléments à estomper (relecture de l'écriture au rythme de l'audio).
 */
export function drawItems(
  ctx: CanvasRenderingContext2D,
  items: RenderItem[],
  res?: RenderResources | null,
  lookup?: ItemLookup | null,
  ghost?: ((item: RenderItem) => boolean) | null,
) {
  const draw = (item: RenderItem) => {
    if (ghost?.(item)) {
      ctx.save();
      ctx.globalAlpha = GHOST_ALPHA;
      drawItem(ctx, item, res, undefined, lookup);
      ctx.restore();
    } else drawItem(ctx, item, res, undefined, lookup);
  };
  for (const item of items) if (isHighlight(item.el)) draw(item);
  for (const item of items) if (!isHighlight(item.el)) draw(item);
}
