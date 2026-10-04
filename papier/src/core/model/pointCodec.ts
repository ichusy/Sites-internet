/**
 * Encodage des points d'un trait.
 *
 * Chaque point = 4 flottants 32 bits little-endian : x, y, pression (0..1), t (ms depuis t0).
 * Soit 16 octets par point. En mémoire, on manipule un Float32Array « à plat » de pas 4.
 */

export const POINT_STRIDE = 4;
const BYTES_PER_POINT = POINT_STRIDE * 4;

export interface InkPoint {
  x: number;
  y: number;
  p: number;
  t: number;
}

export function encodePoints(points: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(points.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < points.length; i++) view.setFloat32(i * 4, points[i], true);
  return bytes;
}

export function decodePoints(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.byteLength / 4);
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function pointCount(bytes: Uint8Array): number {
  return Math.floor(bytes.byteLength / BYTES_PER_POINT);
}

export function flatten(points: InkPoint[]): Float32Array {
  const out = new Float32Array(points.length * POINT_STRIDE);
  points.forEach((pt, i) => {
    out[i * 4] = pt.x;
    out[i * 4 + 1] = pt.y;
    out[i * 4 + 2] = pt.p;
    out[i * 4 + 3] = pt.t;
  });
  return out;
}
