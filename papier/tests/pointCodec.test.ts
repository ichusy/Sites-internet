import { describe, expect, it } from 'vitest';
import { decodePoints, encodePoints, pointCount } from '../src/core/model/pointCodec';

describe('pointCodec', () => {
  it('encode et décode sans perte (float32)', () => {
    const pts = [1.5, 2.25, 0.5, 0, 10, 20, 0.75, 16.5];
    const bytes = encodePoints(pts);
    expect(bytes.byteLength).toBe(32);
    expect(pointCount(bytes)).toBe(2);
    expect(Array.from(decodePoints(bytes))).toEqual(pts);
  });

  it('écrit en little-endian', () => {
    const bytes = encodePoints([1, 0, 0, 0]);
    // 1.0f = 0x3F800000 → octets LE : 00 00 80 3F
    expect(Array.from(bytes.slice(0, 4))).toEqual([0, 0, 0x80, 0x3f]);
  });
});
