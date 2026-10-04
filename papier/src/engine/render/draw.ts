import type { PageData } from '../../core/model/types';
import { itemPath, type RenderItem } from '../scene';
import { DOT_COLOR, LINE_COLOR, MARGIN_COLOR, PAPER_COLOR, templatePrimitives, type Segment } from './templates';

export { PAPER_COLOR };

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
 * Dessine le fond d'une page dans son repère : papier, éventuel fond importé
 * (page de PDF ou image), puis le modèle (lignes, carreaux, points).
 * `scale` = pixels par point, pour garder des traits d'au moins un pixel.
 */
export function drawTemplate(ctx: CanvasRenderingContext2D, page: PageData, scale: number, background?: CanvasImageSource | null) {
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, page.width, page.height);
  if (background) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(background, 0, 0, page.width, page.height);
  }
  const prim = templatePrimitives(page);
  const hair = Math.max(0.5, 1 / scale);
  ctx.save();
  strokeSegments(ctx, prim.lines, LINE_COLOR, hair);
  strokeSegments(ctx, prim.accents, MARGIN_COLOR, hair);
  if (prim.dots.length) {
    ctx.fillStyle = DOT_COLOR;
    const r = Math.max(0.6, 1.2 / scale);
    for (const [x, y] of prim.dots) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.restore();
}

/** Dessine un élément dans le repère de la page. */
export function drawItem(ctx: CanvasRenderingContext2D, item: RenderItem, path: Path2D = itemPath(item)) {
  const el = item.el;
  ctx.save();
  ctx.globalAlpha = el.opacity;
  if (el.tool === 'highlighter') {
    // Le surligneur « multiplie » : il colore le papier sans masquer l'encre ni le texte du PDF.
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.width;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else if (el.dash !== 'solid') {
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.width;
    ctx.lineJoin = 'round';
    if (el.dash === 'dotted') {
      ctx.lineCap = 'round';
      ctx.setLineDash([0.01, el.width * 2.2]);
    } else {
      ctx.lineCap = 'butt';
      ctx.setLineDash([el.width * 4, el.width * 2.5]);
    }
    ctx.stroke(path);
  } else {
    ctx.fillStyle = el.color;
    ctx.fill(path);
  }
  ctx.restore();
}

/**
 * Rendu vectoriel complet d'une page : fond, puis surligneur, puis encre.
 * Le surligneur est dessiné en premier pour passer derrière l'encre.
 */
export function drawPageContent(
  ctx: CanvasRenderingContext2D,
  page: PageData,
  items: RenderItem[],
  scale: number,
  background?: CanvasImageSource | null,
) {
  drawTemplate(ctx, page, scale, background);
  for (const item of items) if (item.el.tool === 'highlighter') drawItem(ctx, item);
  for (const item of items) if (item.el.tool !== 'highlighter') drawItem(ctx, item);
}
