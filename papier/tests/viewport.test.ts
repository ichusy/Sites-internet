import { describe, expect, it } from 'vitest';
import { Viewport } from '../src/engine/Viewport';
import { layoutPages, pageAt } from '../src/engine/layout';
import { defaultTemplate } from '../src/core/model/paper';

describe('vue et mise en page', () => {
  it('garde le point sous le curseur fixe pendant le zoom', () => {
    const vp = new Viewport();
    vp.width = 800;
    vp.height = 600;
    const before = vp.toWorld(300, 200);
    vp.zoomAt(2.5, 300, 200);
    const after = vp.toWorld(300, 200);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('empile les pages et retrouve la page sous un point', () => {
    const t = defaultTemplate('blank');
    const { pages } = layoutPages([
      { id: 'a', width: 100, height: 200, template: t },
      { id: 'b', width: 100, height: 200, template: t },
    ]);
    expect(pages[1].y).toBe(224);
    expect(pageAt(pages, 0, 300)?.id).toBe('b');
    expect(pageAt(pages, 0, 210)).toBeUndefined();
  });
});
