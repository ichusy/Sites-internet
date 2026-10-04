/** Police des zones de texte : métriques proches de l'Helvetica utilisée à l'export PDF. */
export const TEXT_FONT = 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif';
export const LINE_HEIGHT = 1.3;
/** Position de la ligne de base dans une ligne, en proportion de la taille de police. */
export const BASELINE = 1.0;

export type Measure = (text: string) => number;

/**
 * Découpe un texte en lignes de largeur maximale `width` (retours à la ligne explicites
 * conservés ; un mot trop long est coupé). Utilisée à l'écran et à l'export PDF.
 */
export function layoutText(text: string, width: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (!line || measure(candidate) <= width) {
        line = candidate;
        // Mot isolé plus large que la zone : coupe caractère par caractère.
        while (measure(line) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut)) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function textBlockHeight(lineCount: number, fontSize: number) {
  return Math.max(1, lineCount) * fontSize * LINE_HEIGHT;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Mesure de largeur via Canvas (navigateur). */
export function canvasMeasure(fontSize: number): Measure {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  const ctx = measureCtx;
  ctx.font = `${fontSize}px ${TEXT_FONT}`;
  return (s) => ctx.measureText(s).width;
}
