import type { CoverPattern, TemplateKind, TemplateRef } from './types';

/** 1 mm en points PDF. */
export const MM = 72 / 25.4;

export interface PaperFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PAPER_FORMATS: PaperFormat[] = [
  { id: 'a4', label: 'A4 portrait', width: 595.28, height: 841.89 },
  { id: 'a4l', label: 'A4 paysage', width: 841.89, height: 595.28 },
  { id: 'a5', label: 'A5 portrait', width: 419.53, height: 595.28 },
  { id: 'letter', label: 'Lettre US', width: 612, height: 792 },
];

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  blank: 'Blanc',
  lined: 'Ligné',
  grid: 'Quadrillé',
  dots: 'Pointillé',
};

export function defaultTemplate(kind: TemplateKind): TemplateRef {
  switch (kind) {
    case 'lined':
      return { kind, spacing: 8 * MM };
    case 'grid':
    case 'dots':
      return { kind, spacing: 5 * MM };
    default:
      return { kind: 'blank', spacing: 0 };
  }
}

export const COVER_COLORS = [
  '#2f4858', '#33658a', '#5b8e7d', '#8cb369',
  '#c97b63', '#bc4b51', '#7d5ba6', '#3a3a3a',
  '#d9b44a', '#e8e1d5',
];

export const COVER_PATTERNS: { id: CoverPattern; label: string }[] = [
  { id: 'plain', label: 'Uni' },
  { id: 'stripes', label: 'Rayures' },
  { id: 'dots', label: 'Pois' },
  { id: 'grid', label: 'Carreaux' },
  { id: 'diagonal', label: 'Diagonales' },
];
