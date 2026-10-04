import { describe, expect, it } from 'vitest';
import { convexHull, isClosedLoop, isScribble, recognizeShape } from '../src/engine/geometry/recognize';

/** Générateur pseudo-aléatoire déterministe pour simuler le tremblement de la main. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
}

function flat(points: [number, number][], jitter = 0, seed = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(points.length * 4);
  points.forEach(([x, y], i) => {
    out[i * 4] = x + r() * jitter;
    out[i * 4 + 1] = y + r() * jitter;
    out[i * 4 + 2] = 0.5;
  });
  return out;
}

function polyline(corners: [number, number][], perEdge = 20, close = true): [number, number][] {
  const pts: [number, number][] = [];
  const n = close ? corners.length : corners.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % corners.length];
    for (let k = 0; k < perEdge; k++) pts.push([ax + ((bx - ax) * k) / perEdge, ay + ((by - ay) * k) / perEdge]);
  }
  if (close) pts.push([corners[0][0] + 3, corners[0][1] + 2]);
  else pts.push(corners[corners.length - 1]);
  return pts;
}

function circle(cx: number, cy: number, rx: number, ry: number, turns = 1.02, n = 90): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 2 * turns;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as [number, number];
  });
}

describe('reconnaissance de formes', () => {
  it('ligne légèrement tremblée → ligne, aimantée à l’horizontale', () => {
    const pts = Array.from({ length: 40 }, (_, i) => [10 + i * 5, 50 + i * 0.15] as [number, number]);
    const s = recognizeShape(flat(pts, 1.5))!;
    expect(s.kind).toBe('line');
    expect(Math.abs(s.vertices[1][1] - s.vertices[0][1])).toBeLessThan(0.01);
  });

  it('cercle tremblé → ellipse régularisée en cercle', () => {
    const s = recognizeShape(flat(circle(100, 100, 50, 47), 3))!;
    expect(s.kind).toBe('ellipse');
    const cx = s.vertices.reduce((a, v) => a + v[0], 0) / s.vertices.length;
    const cy = s.vertices.reduce((a, v) => a + v[1], 0) / s.vertices.length;
    expect(Math.hypot(cx - 100, cy - 100)).toBeLessThan(4);
    const r = s.vertices.map(([x, y]) => Math.hypot(x - cx, y - cy));
    expect(Math.max(...r) - Math.min(...r)).toBeLessThan(1);
  });

  it('ellipse allongée → ellipse', () => {
    expect(recognizeShape(flat(circle(100, 100, 90, 35), 2))?.kind).toBe('ellipse');
  });

  it('rectangle dessiné à la main → rectangle droit', () => {
    const s = recognizeShape(flat(polyline([[0, 0], [160, 3], [158, 100], [2, 98]]), 2))!;
    expect(s.kind).toBe('rect');
    const ys = s.vertices.map((v) => Math.round(v[1]));
    expect(new Set(ys).size).toBe(2); // côtés horizontaux après aimantation
  });

  it('triangle → triangle', () => {
    expect(recognizeShape(flat(polyline([[0, 100], [60, 0], [120, 100]]), 2))?.kind).toBe('triangle');
  });

  it('ligne ondulée ouverte → rien', () => {
    const pts = Array.from({ length: 60 }, (_, i) => [i * 4, 50 + Math.sin(i / 4) * 20] as [number, number]);
    expect(recognizeShape(flat(pts))).toBeNull();
  });

  it('écriture cursive → rien', () => {
    const pts = Array.from({ length: 120 }, (_, i) => [i * 2 + Math.sin(i / 3) * 8, 50 + Math.cos(i / 2.5) * 14] as [number, number]);
    expect(recognizeShape(flat(pts, 1))).toBeNull();
  });
});

describe('gestes', () => {
  it('détecte un gribouillis', () => {
    const pts: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i <= 10; i++) pts.push([k % 2 ? 100 - i * 10 : i * 10, k * 4 + i * 0.3]);
    }
    expect(isScribble(flat(pts, 1))).toBe(true);
  });

  it('un mot écrit n’est pas un gribouillis', () => {
    const pts = Array.from({ length: 80 }, (_, i) => [i * 3, 50 + Math.sin(i / 3) * 10] as [number, number]);
    expect(isScribble(flat(pts))).toBe(false);
  });

  it('enveloppe convexe d’un carré avec point intérieur', () => {
    const hull = convexHull(flat([[0, 0], [10, 0], [5, 5], [10, 10], [0, 10]]));
    expect(hull.length / 2).toBe(4);
  });

  it('boucle fermée vs trait ouvert', () => {
    expect(isClosedLoop(flat(circle(50, 50, 40, 30, 1)))).toBe(true);
    expect(isClosedLoop(flat(Array.from({ length: 30 }, (_, i) => [i * 5, 10] as [number, number])))).toBe(false);
  });
});
