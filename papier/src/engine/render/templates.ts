import type { PageData } from '../../core/model/types';

export const PAPER_COLOR = '#ffffff';
export const LINE_COLOR = '#c9d4e5';
export const MARGIN_COLOR = '#f0b4b4';
export const DOT_COLOR = '#9aa8bd';
export const STRUCTURE_COLOR = '#93a6c6';
export const LABEL_COLOR = '#7f8ea8';

/** Segment de ligne d'un modèle de page : [x1, y1, x2, y2]. */
export type Segment = [number, number, number, number];

/** Libellé imprimé sur le modèle ; `y` est la ligne de base. */
export interface TemplateLabel {
  x: number;
  y: number;
  text: string;
  size: number;
}

export interface TemplatePrimitives {
  lines: Segment[];
  /** Lignes d'accent (marge rouge du papier ligné). */
  accents: Segment[];
  /** Traits de structure (colonnes Cornell, cases du semainier). */
  structure: Segment[];
  /** Centres des points du papier pointillé. */
  dots: [number, number][];
  labels: TemplateLabel[];
}

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Notes'];

function hLines(out: Segment[], x0: number, x1: number, y0: number, y1: number, step: number) {
  for (let y = y0 + step; y < y1 - step / 3; y += step) out.push([x0, y, x1, y]);
}

function box(out: Segment[], x0: number, y0: number, x1: number, y1: number) {
  out.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
}

/**
 * Géométrie d'un modèle de page, indépendante du support de rendu
 * (utilisée par l'écran et par l'export PDF).
 */
export function templatePrimitives(page: PageData): TemplatePrimitives {
  const out: TemplatePrimitives = { lines: [], accents: [], structure: [], dots: [], labels: [] };
  const { kind, spacing } = page.template;
  if (kind === 'blank' || kind === 'custom' || spacing <= 0) return out;
  const { width: w, height: h } = page;
  const label = (x: number, y: number, text: string, size = 8) => out.labels.push({ x, y, text, size });

  switch (kind) {
    case 'lined':
      for (let y = spacing * 3; y < h - spacing / 2; y += spacing) out.lines.push([0, y, w, y]);
      out.accents.push([spacing * 2.5, 0, spacing * 2.5, h]);
      break;
    case 'grid':
      for (let x = spacing; x < w; x += spacing) out.lines.push([x, 0, x, h]);
      for (let y = spacing; y < h; y += spacing) out.lines.push([0, y, w, y]);
      break;
    case 'dots':
      for (let y = spacing; y < h; y += spacing) for (let x = spacing; x < w; x += spacing) out.dots.push([x, y]);
      break;
    case 'cornell': {
      // Bandeau titre, colonne « mots-clés » (≈ 30 %), zone de notes, résumé en bas (≈ 20 %).
      const top = Math.max(spacing * 2.5, h * 0.085);
      const cue = w * 0.3;
      const summary = h * 0.8;
      out.structure.push([0, top, w, top], [cue, top, cue, summary], [0, summary, w, summary]);
      hLines(out.lines, 0, w, top, summary, spacing);
      hLines(out.lines, 0, w, summary + spacing * 0.6, h, spacing);
      label(18, top * 0.45, 'Sujet :', 9);
      label(w * 0.62, top * 0.45, 'Date :', 9);
      label(10, top + 11, 'Mots-clés / questions');
      label(cue + 10, top + 11, 'Notes');
      label(10, summary + 11, 'Résumé');
      break;
    }
    case 'planner': {
      // Semainier : bandeau + 2 × 4 cases (7 jours et une case de notes).
      const m = 24;
      const top = Math.max(spacing * 2.5, h * 0.08);
      label(m, top * 0.55, 'Semaine du', 10);
      const cols = 2;
      const rows = 4;
      const cw = (w - m * 2) / cols;
      const ch = (h - top - m) / rows;
      DAYS.forEach((day, i) => {
        const x0 = m + (i % cols) * cw;
        const y0 = top + Math.floor(i / cols) * ch;
        box(out.structure, x0, y0, x0 + cw, y0 + ch);
        label(x0 + 8, y0 + 13, day, 9);
        hLines(out.lines, x0 + 8, x0 + cw - 8, y0 + spacing * 0.9, y0 + ch, spacing);
      });
      break;
    }
  }
  return out;
}
