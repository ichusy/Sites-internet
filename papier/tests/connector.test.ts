import { describe, expect, it } from 'vitest';
import { arrowHead, bezierPoint, connectorCurve } from '../src/engine/geometry/connector';

describe('connecteurs', () => {
  it('relie deux boîtes côte à côte par leurs côtés en vis-à-vis', () => {
    const c = connectorCurve({ x: 0, y: 0, box: [0, 0, 100, 100] }, { x: 0, y: 0, box: [300, 20, 400, 120] });
    expect(c.p0[0]).toBeGreaterThan(100); // sort par la droite de la 1re boîte
    expect(c.p0[1]).toBe(50);
    expect(c.p1[0]).toBeLessThan(300); // arrive par la gauche de la 2de
    expect(c.p1[1]).toBe(70);
    // Tangentes horizontales : points de contrôle à la même hauteur que les extrémités.
    expect(c.c1[1]).toBe(c.p0[1]);
    expect(c.c2[1]).toBe(c.p1[1]);
  });

  it('relie deux boîtes empilées par le bas et le haut', () => {
    const c = connectorCurve({ x: 0, y: 0, box: [0, 0, 100, 100] }, { x: 0, y: 0, box: [10, 300, 110, 400] });
    expect(c.p0[1]).toBeGreaterThan(100);
    expect(c.p1[1]).toBeLessThan(300);
    expect(c.c1[0]).toBe(c.p0[0]);
  });

  it('accepte des extrémités libres et passe par elles', () => {
    const c = connectorCurve({ x: 10, y: 10 }, { x: 210, y: 60 });
    expect(bezierPoint(c, 0)).toEqual([10, 10]);
    expect(bezierPoint(c, 1)).toEqual([210, 60]);
  });

  it('dessine une pointe de flèche symétrique pointant vers la cible', () => {
    const [tip, l, r] = arrowHead([100, 0], [0, 0], 10);
    expect(tip).toEqual([100, 0]);
    expect(l[0]).toBeCloseTo(90);
    expect(r[0]).toBeCloseTo(90);
    expect(l[1]).toBeCloseTo(-r[1]);
  });
});
