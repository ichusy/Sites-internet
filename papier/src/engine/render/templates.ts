import type { PageData } from '../../core/model/types';

export const PAPER_COLOR = '#ffffff';
export const LINE_COLOR = '#c9d4e5';
export const MARGIN_COLOR = '#f0b4b4';
export const DOT_COLOR = '#9aa8bd';

/** Segment de ligne d'un modèle de page : [x1, y1, x2, y2]. */
export type Segment = [number, number, number, number];

export interface TemplatePrimitives {
  lines: Segment[];
  /** Lignes d'accent (marge rouge du papier ligné). */
  accents: Segment[];
  /** Centres des points du papier pointillé. */
  dots: [number, number][];
}

/**
 * Géométrie d'un modèle de page, indépendante du support de rendu
 * (utilisée par l'écran et par l'export PDF).
 */
export function templatePrimitives(page: PageData): TemplatePrimitives {
  const out: TemplatePrimitives = { lines: [], accents: [], dots: [] };
  const { kind, spacing } = page.template;
  if (kind === 'blank' || spacing <= 0) return out;
  const { width: w, height: h } = page;
  if (kind === 'lined') {
    for (let y = spacing * 3; y < h - spacing / 2; y += spacing) out.lines.push([0, y, w, y]);
    out.accents.push([spacing * 2.5, 0, spacing * 2.5, h]);
  } else if (kind === 'grid') {
    for (let x = spacing; x < w; x += spacing) out.lines.push([x, 0, x, h]);
    for (let y = spacing; y < h; y += spacing) out.lines.push([0, y, w, y]);
  } else if (kind === 'dots') {
    for (let y = spacing; y < h; y += spacing) for (let x = spacing; x < w; x += spacing) out.dots.push([x, y]);
  }
  return out;
}
