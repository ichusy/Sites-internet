/** Motif de grain du crayon, un par couleur (mis en cache). */
const patterns = new Map<string, CanvasPattern>();
let grain: HTMLCanvasElement | null = null;

/** Texture de bruit en niveaux d'alpha, générée une fois (déterministe). */
function grainCanvas(): HTMLCanvasElement {
  if (grain) return grain;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = rand();
    // Majorité de pixels denses, quelques trous : aspect mine de graphite sur papier.
    img.data[i * 4 + 3] = v < 0.18 ? 40 + v * 300 : 150 + v * 105;
  }
  ctx.putImageData(img, 0, 0);
  return (grain = c);
}

export function pencilPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  let p = patterns.get(color);
  if (p) return p;
  const tinted = document.createElement('canvas');
  const g = grainCanvas();
  tinted.width = g.width;
  tinted.height = g.height;
  const t = tinted.getContext('2d')!;
  t.drawImage(g, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, g.width, g.height);
  const pattern = ctx.createPattern(tinted, 'repeat');
  if (!pattern) return color;
  // Grain fin : 1 pixel de texture ≈ 0,25 pt.
  pattern.setTransform(new DOMMatrix().scale(0.25));
  patterns.set(color, pattern);
  return pattern;
}
