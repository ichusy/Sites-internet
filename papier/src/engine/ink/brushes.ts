import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { POINT_STRIDE } from '../../core/model/pointCodec';
import type { Brush } from '../../core/model/types';

/** Paramètres de rendu de chaque pointe de stylo. */
function brushOptions(brush: Brush, width: number, realPressure: boolean): StrokeOptions {
  switch (brush) {
    case 'fountain':
      return {
        size: width * 1.6,
        thinning: 0.62,
        smoothing: 0.55,
        streamline: 0.4,
        // Courbe qui renforce les pressions légères (Apple Pencil, stylets Wacom/USI).
        easing: (t) => Math.sin((t * Math.PI) / 2),
        simulatePressure: !realPressure,
        start: { taper: 0, cap: true },
        end: { taper: width * 2.5, cap: true },
      };
    case 'brush':
      return {
        size: width * 2.4,
        thinning: 0.82,
        smoothing: 0.6,
        streamline: 0.45,
        easing: (t) => t * t * (3 - 2 * t),
        simulatePressure: !realPressure,
        start: { taper: width * 3, cap: true },
        end: { taper: width * 4, cap: true },
      };
    case 'ballpoint':
    default:
      return {
        size: width,
        thinning: realPressure ? 0.18 : 0,
        smoothing: 0.5,
        streamline: 0.4,
        simulatePressure: false,
        start: { cap: true },
        end: { cap: true },
      };
  }
}

function toInput(pts: Float32Array): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i += POINT_STRIDE) out.push([pts[i], pts[i + 1], pts[i + 2]]);
  return out;
}

/** Contour rempli (épaisseur variable) d'un trait de stylo. */
export function outlinePath(pts: Float32Array, brush: Brush, width: number, realPressure: boolean, complete: boolean): Path2D {
  const outline = getStroke(toInput(pts), { ...brushOptions(brush, width, realPressure), last: complete });
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  // Lissage du contour par courbes quadratiques passant par les milieux.
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/** Ligne médiane lissée (surligneur, traits pointillés). */
export function centerlinePath(pts: Float32Array): Path2D {
  const path = new Path2D();
  const n = pts.length / POINT_STRIDE;
  if (n === 0) return path;
  path.moveTo(pts[0], pts[1]);
  if (n === 1) {
    path.lineTo(pts[0] + 0.01, pts[1]);
    return path;
  }
  for (let i = 1; i < n - 1; i++) {
    const j = i * POINT_STRIDE;
    const k = j + POINT_STRIDE;
    path.quadraticCurveTo(pts[j], pts[j + 1], (pts[j] + pts[k]) / 2, (pts[j + 1] + pts[k + 1]) / 2);
  }
  const last = (n - 1) * POINT_STRIDE;
  path.lineTo(pts[last], pts[last + 1]);
  return path;
}
