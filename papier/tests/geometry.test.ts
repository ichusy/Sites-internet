import { describe, expect, it } from 'vitest';
import type { Mat2D } from '../src/core/model/types';
import { applyMat, fractionInside, invertMat, multiplyMat, pointInPolygon, scaleAboutMat, translateMat } from '../src/engine/geometry/geom';
import { viewportTransform } from '../src/pdf/exportPdf';

const square = [0, 0, 10, 0, 10, 10, 0, 10];

describe('géométrie du lasso', () => {
  it('teste l’appartenance à un polygone', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });

  it('mesure la proportion d’un trait dans la boucle', () => {
    const pts = Float32Array.from([2, 5, 0.5, 0, 8, 5, 0.5, 0, 12, 5, 0.5, 0, 14, 5, 0.5, 0]);
    expect(fractionInside(pts, square)).toBe(0.5);
  });

  it('compose les transformations dans le bon ordre', () => {
    const m = multiplyMat(translateMat(10, 0), scaleAboutMat(2, 0, 0));
    expect(applyMat(m, 1, 1)).toEqual([12, 2]);
    const back = applyMat(invertMat(m), 12, 2);
    expect(back[0]).toBeCloseTo(1);
    expect(back[1]).toBeCloseTo(1);
  });

  it('homothétie : le point d’ancrage reste fixe', () => {
    expect(applyMat(scaleAboutMat(3, 4, 5), 4, 5)).toEqual([4, 5]);
  });
});

describe('transformation de page PDF (comme pdf.js)', () => {
  const apply = (m: Mat2D, x: number, y: number) => applyMat(m, x, y).map((v) => Math.round(v * 1000) / 1000 + 0);

  it('page sans rotation : Y inversé', () => {
    const { m, width, height } = viewportTransform(0, [0, 0, 595, 842]);
    expect([width, height]).toEqual([595, 842]);
    expect(apply(m, 0, 842)).toEqual([0, 0]); // coin haut-gauche
    expect(apply(m, 595, 0)).toEqual([595, 842]); // coin bas-droit
  });

  it('page tournée de 90° : largeur et hauteur échangées', () => {
    const { m, width, height } = viewportTransform(90, [0, 0, 595, 842]);
    expect([width, height]).toEqual([842, 595]);
    expect(m).toEqual([0, 1, 1, 0, 0, 0]);
  });

  it('boîte décalée et rotation 180°/270° : l’inverse ramène au repère PDF', () => {
    for (const rot of [180, 270]) {
      const { m, width, height } = viewportTransform(rot, [36, 18, 631, 860]);
      const inv = invertMat(m);
      const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => apply(inv, x, y));
      const xs = corners.map((c) => c[0]).sort((a, b) => a - b);
      const ys = corners.map((c) => c[1]).sort((a, b) => a - b);
      expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([36, 631, 18, 860]);
    }
  });
});
