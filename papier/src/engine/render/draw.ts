import type { ID, ImageElement, PageData, StrokeElement, TextElement } from '../../core/model/types';
import { isCenterline, isHighlight, itemPath, type RenderItem } from '../scene';
import { pencilPattern } from './pencil';
import {
  DOT_COLOR, LABEL_COLOR, LINE_COLOR, MARGIN_COLOR, PAPER_COLOR, STRUCTURE_COLOR, templatePrimitives, type Segment,
} from './templates';
import { BASELINE, LINE_HEIGHT, TEXT_FONT, canvasMeasure, layoutText } from './text';

export { PAPER_COLOR };

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
  ctx.globalAlpha = el.opacity;
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

/** Lignes d'une zone de texte, mises en cache sur l'élément de rendu. */
export function textLines(item: RenderItem): string[] {
  const el = item.el as TextElement;
  item.lines ??= layoutText(el.text, el.width, canvasMeasure(el.fontSize));
  return item.lines;
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
export function drawItem(ctx: CanvasRenderingContext2D, item: RenderItem, res?: RenderResources | null, path?: Path2D) {
  const el = item.el;
  ctx.save();
  if (el.type === 'stroke') drawStroke(ctx, el, path ?? itemPath(item));
  else if (el.type === 'text') drawText(ctx, item);
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
) {
  drawTemplate(ctx, page, scale, res);
  for (const item of items) if (isHighlight(item.el)) drawItem(ctx, item, res);
  for (const item of items) if (!isHighlight(item.el)) drawItem(ctx, item, res);
}
