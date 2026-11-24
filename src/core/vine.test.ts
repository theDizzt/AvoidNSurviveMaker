import { describe, expect, it } from 'vitest';
import { thornRing } from './hazards';
import { flattenShape } from './shape';

/** Index pairs of edges of a closed ring that cross (neighbouring edges excluded) */
function crossings(r: Float64Array): number {
  const n = r.length / 2;
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      const j2 = (j + 1) % n;
      if (j2 === i) continue;
      const d1 = o(r[j * 2], r[j * 2 + 1], r[j2 * 2], r[j2 * 2 + 1], r[i * 2], r[i * 2 + 1]);
      const d2 = o(r[j * 2], r[j * 2 + 1], r[j2 * 2], r[j2 * 2 + 1], r[i2 * 2], r[i2 * 2 + 1]);
      const d3 = o(r[i * 2], r[i * 2 + 1], r[i2 * 2], r[i2 * 2 + 1], r[j * 2], r[j * 2 + 1]);
      const d4 = o(r[i * 2], r[i * 2 + 1], r[i2 * 2], r[i2 * 2 + 1], r[j2 * 2], r[j2 * 2 + 1]);
      // (collinear stretches of stem, within rounding, don't count)
      const eps = 1e-6;
      if (Math.min(Math.abs(d1), Math.abs(d2), Math.abs(d3), Math.abs(d4)) > eps && d1 * d2 < 0 && d3 * d4 < 0) count++;
    }
  }
  return count;
}

describe('thorn vines (#83 / #84)', () => {
  it('never overlap themselves, whatever the size, shape or seed', () => {
    const shapes = [
      flattenShape({ type: 'rect', x: 0, y: 0, w: 30, h: 180 }).poly,
      flattenShape({ type: 'rect', x: 0, y: 0, w: 60, h: 400 }).poly,
      flattenShape({ type: 'rect', x: 0, y: 0, w: 500, h: 34 }).poly,
      flattenShape({ type: 'poly', points: [{ x: 0, y: 30 }, { x: 360, y: 0 }, { x: 370, y: 40 }, { x: 10, y: 70 }] }).poly,
      flattenShape({ type: 'ellipse', cx: 0, cy: 0, rx: 40, ry: 160 }).poly,
    ];
    for (const ring of shapes) {
      for (let seed = 0; seed < 60; seed++) expect(crossings(thornRing(ring, seed * 37 + 11)), `seed ${seed}`).toBe(0);
    }
  });

  it('bristles with thorns about as long as the stem is thick', () => {
    const ring = flattenShape({ type: 'rect', x: 0, y: 0, w: 30, h: 240 }).poly;
    const out = thornRing(ring, 5);
    let minX = Infinity, maxX = -Infinity;
    for (let k = 0; k < out.length; k += 2) {
      minX = Math.min(minX, out[k]);
      maxX = Math.max(maxX, out[k]);
    }
    // Thorns reach well past the 30 px stem on both sides
    expect(minX).toBeLessThan(-12);
    expect(maxX).toBeGreaterThan(42);
  });
});
