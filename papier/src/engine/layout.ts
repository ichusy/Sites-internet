import type { BBox, ID, PageData } from '../core/model/types';

export const PAGE_GAP = 24;

export interface PageLayout {
  id: ID;
  index: number;
  /** Coin haut-gauche de la page dans le monde. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Empile les pages verticalement, centrées sur x = 0. */
export function layoutPages(pages: PageData[]): { pages: PageLayout[]; bounds: BBox } {
  let y = 0;
  let maxW = 0;
  const out = pages.map((p, index) => {
    const l: PageLayout = { id: p.id, index, x: -p.width / 2, y, width: p.width, height: p.height };
    y += p.height + PAGE_GAP;
    maxW = Math.max(maxW, p.width);
    return l;
  });
  const bottom = Math.max(0, y - PAGE_GAP);
  return { pages: out, bounds: [-maxW / 2 - PAGE_GAP, -PAGE_GAP, maxW / 2 + PAGE_GAP, bottom + PAGE_GAP] };
}

export function pageAt(layouts: PageLayout[], x: number, y: number): PageLayout | undefined {
  return layouts.find((l) => x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height);
}
