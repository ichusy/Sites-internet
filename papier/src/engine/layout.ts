import type { BBox, ID, PageData } from '../core/model/types';

export const PAGE_GAP = 24;

export interface PageLayout {
  id: ID;
  index: number;
  /** Coin haut-gauche de la page dans le monde (origine pour une page infinie). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Tableau blanc sans bords : contient tous les points du monde. */
  infinite?: boolean;
}

/**
 * Empile les pages verticalement, centrées sur x = 0.
 * Une page infinie (tableau blanc) occupe seule le monde, origine en (0, 0) ; `bounds` vaut alors null.
 */
export function layoutPages(pages: PageData[]): { pages: PageLayout[]; bounds: BBox | null } {
  const infinite = pages.find((p) => p.infinite);
  if (infinite) {
    return { pages: [{ id: infinite.id, index: 0, x: 0, y: 0, width: infinite.width, height: infinite.height, infinite: true }], bounds: null };
  }
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

export function containsPoint(l: PageLayout, x: number, y: number): boolean {
  return !!l.infinite || (x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height);
}

/** La page recoupe-t-elle le rectangle [x0, y0, x1, y1] (coordonnées monde) ? */
export function intersectsRect(l: PageLayout, x0: number, y0: number, x1: number, y1: number): boolean {
  return !!l.infinite || !(l.x > x1 || l.x + l.width < x0 || l.y > y1 || l.y + l.height < y0);
}

export function pageAt(layouts: PageLayout[], x: number, y: number): PageLayout | undefined {
  return layouts.find((l) => containsPoint(l, x, y));
}
