import type { PageData } from '../../core/model/types';
import { itemPath, type RenderItem } from '../scene';

export const PAPER_COLOR = '#ffffff';
const LINE_COLOR = '#c9d4e5';
const MARGIN_COLOR = '#f0b4b4';
const DOT_COLOR = '#9aa8bd';

/**
 * Dessine le fond d'une page (papier + modèle) dans le repère de la page.
 * `scale` = pixels par point, pour garder des traits d'au moins un pixel.
 */
export function drawTemplate(ctx: CanvasRenderingContext2D, page: PageData, scale: number) {
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, page.width, page.height);
  const { kind, spacing } = page.template;
  if (kind === 'blank' || spacing <= 0) return;
  const hair = Math.max(0.5, 1 / scale);
  ctx.save();
  if (kind === 'lined') {
    const top = spacing * 3;
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let y = top; y < page.height - spacing / 2; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = MARGIN_COLOR;
    ctx.beginPath();
    const mx = spacing * 2.5;
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, page.height);
    ctx.stroke();
  } else if (kind === 'grid') {
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let x = spacing; x < page.width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, page.height);
    }
    for (let y = spacing; y < page.height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
  } else if (kind === 'dots') {
    ctx.fillStyle = DOT_COLOR;
    const r = Math.max(0.6, 1.2 / scale);
    for (let y = spacing; y < page.height; y += spacing) {
      for (let x = spacing; x < page.width; x += spacing) {
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }
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
 * Rendu vectoriel complet d'une page : modèle, puis surligneur, puis encre.
 * Le surligneur est dessiné en premier pour passer derrière l'encre.
 */
export function drawPageContent(
  ctx: CanvasRenderingContext2D,
  page: PageData,
  items: RenderItem[],
  scale: number,
) {
  drawTemplate(ctx, page, scale);
  for (const item of items) if (item.el.tool === 'highlighter') drawItem(ctx, item);
  for (const item of items) if (item.el.tool !== 'highlighter') drawItem(ctx, item);
}
