import type { ID, PdfTextItem, TextElement } from '../core/model/types';
import { findRanges, makeSnippet, matchesAll, type Snippet } from '../core/search/match';
import { applyMat } from './geometry/geom';
import type { PageLayout } from './layout';
import { textLines } from './render/draw';
import { LINE_HEIGHT, canvasMeasure } from './render/text';
import type { PageScene } from './scene';

/** Quadrilatère de surlignage (4 coins, repère de la page) : x0, y0, x1, y1, x2, y2, x3, y3. */
export type Quad = [number, number, number, number, number, number, number, number];

export interface PageHits {
  pageId: ID;
  index: number;
  quads: Quad[];
  snippet: Snippet;
  /** Nombre d'occurrences surlignées sur la page. */
  count: number;
}

export type PdfTextLookup = (assetId: ID, pageIndex: number) => PdfTextItem[] | null;

function rectQuad(x0: number, y0: number, x1: number, y1: number): Quad {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/** Texte d'une page de PDF et position de départ de chaque morceau dans ce texte. */
function joinItems(items: PdfTextItem[]) {
  const starts: number[] = [];
  let text = '';
  for (const it of items) {
    starts.push(text.length);
    text += it.s + (it.eol ? '\n' : ' ');
  }
  return { text, starts };
}

/** Occurrences dans une zone de texte tapé : mesure exacte des lignes, transformation appliquée. */
function textQuads(scene: PageScene, terms: string[]): { quads: Quad[]; texts: string[] } {
  const quads: Quad[] = [];
  const texts: string[] = [];
  const items = [...scene.items.values()].filter((i) => i.el.type === 'text').sort((a, b) => a.z - b.z);
  for (const item of items) {
    const el = item.el as TextElement;
    texts.push(el.text);
    const measure = canvasMeasure(el.fontSize);
    const lh = el.fontSize * LINE_HEIGHT;
    textLines(item).forEach((line, i) => {
      for (const [s, e] of findRanges(line, terms)) {
        const x0 = el.x + measure(line.slice(0, s));
        const x1 = el.x + measure(line.slice(0, e));
        const y0 = el.y + i * lh + (lh - el.fontSize * 1.15) / 2;
        const y1 = y0 + el.fontSize * 1.15;
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => applyMat(item.matrix!, x, y));
        quads.push(corners as Quad);
      }
    });
  }
  return { quads, texts };
}

/**
 * Occurrences dans le texte d'une page de PDF. La position dans un morceau est estimée
 * par le rapport des largeurs mesurées (police proportionnelle), pas des nombres de caractères.
 */
function pdfQuads(items: PdfTextItem[], terms: string[]): { quads: Quad[]; text: string } {
  const { text, starts } = joinItems(items);
  const quads: Quad[] = [];
  const measure = canvasMeasure(100);
  for (const [s, e] of findRanges(text, terms)) {
    items.forEach((it, k) => {
      const a = Math.max(s, starts[k]);
      const b = Math.min(e, starts[k] + it.s.length);
      if (b <= a || !it.s.length) return;
      const full = measure(it.s) || 1;
      const x0 = it.x + (it.w * measure(it.s.slice(0, a - starts[k]))) / full;
      const x1 = it.x + (it.w * measure(it.s.slice(0, b - starts[k]))) / full;
      quads.push(rectQuad(x0, it.y, x1, it.y + it.h));
    });
  }
  return { quads, text };
}

/**
 * Recherche dans les pages d'un carnet ouvert : texte tapé et texte des PDF.
 * Une page correspond si elle contient tous les termes ; toutes leurs occurrences sont surlignées.
 */
export function searchPages(
  layouts: PageLayout[],
  scene: (id: ID) => PageScene | undefined,
  terms: string[],
  pdfText: PdfTextLookup,
): PageHits[] {
  if (!terms.length) return [];
  const out: PageHits[] = [];
  for (const l of layouts) {
    const sc = scene(l.id);
    if (!sc) continue;
    const typed = textQuads(sc, terms);
    const bg = sc.page.background;
    const pdfItems = bg?.kind === 'pdf' ? pdfText(bg.assetId, bg.pageIndex) : null;
    const pdf = pdfItems ? pdfQuads(pdfItems, terms) : { quads: [], text: '' };
    const typedText = typed.texts.join('\n');
    if (!matchesAll(`${typedText}\n${pdf.text}`, terms)) continue;
    const quads = [...typed.quads, ...pdf.quads];
    const tr = findRanges(typedText, terms)[0];
    const snippet = tr ? makeSnippet(typedText, tr) : makeSnippet(pdf.text, findRanges(pdf.text, terms)[0] ?? [0, 0]);
    out.push({ pageId: l.id, index: l.index, quads, snippet, count: quads.length });
  }
  return out;
}
