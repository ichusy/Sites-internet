import { describe, expect, it } from 'vitest';
import { splitStroke, strokeHit } from '../src/engine/geometry/erase';

/** Trait horizontal de x=0 à x=100 (y=0), un point tous les 10. */
function line(): Float32Array {
  const out: number[] = [];
  for (let x = 0; x <= 100; x += 10) out.push(x, 0, 0.5, x);
  return Float32Array.from(out);
}

describe('gomme', () => {
  it('détecte un trait touché et ignore un trait éloigné', () => {
    expect(strokeHit(line(), 1, { ax: 50, ay: -5, bx: 50, by: 5, r: 2 })).toBe(true);
    expect(strokeHit(line(), 1, { ax: 50, ay: 20, bx: 60, by: 20, r: 2 })).toBe(false);
  });

  it('détecte une gomme qui traverse un segment entre deux points', () => {
    expect(strokeHit(line(), 0.5, { ax: 45, ay: -20, bx: 45, by: 20, r: 0.5 })).toBe(true);
  });

  it('coupe le trait en deux morceaux autour de la gomme', () => {
    const pieces = splitStroke(line(), 1, { ax: 50, ay: -5, bx: 50, by: 5, r: 5 })!;
    expect(pieces).toHaveLength(2);
    const lastXOfLeft = pieces[0][pieces[0].length - 4];
    const firstXOfRight = pieces[1][0];
    expect(lastXOfLeft).toBeLessThan(50);
    expect(firstXOfRight).toBeGreaterThan(50);
    expect(pieces[0][0]).toBe(0);
    expect(pieces[1][pieces[1].length - 4]).toBe(100);
  });

  it('efface entièrement un trait couvert par la gomme', () => {
    expect(splitStroke(line(), 1, { ax: 0, ay: 0, bx: 100, by: 0, r: 5 })).toEqual([]);
  });

  it('renvoie null si rien n’est touché', () => {
    expect(splitStroke(line(), 1, { ax: 50, ay: 30, bx: 50, by: 40, r: 2 })).toBeNull();
  });
});
