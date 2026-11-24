import { describe, expect, it } from 'vitest';
import { flattenShape } from './shape';
import { unionOutline } from './union-outline';

const rect = (x: number, y: number, w: number, h: number) => flattenShape({ type: 'rect', x, y, w, h }).poly;
const length = (seg: number[]) => {
  let n = 0;
  for (let k = 0; k < seg.length; k += 4) n += Math.hypot(seg[k + 2] - seg[k], seg[k + 3] - seg[k + 1]);
  return n;
};

describe('unionOutline', () => {
  it('leaves out the seam between pieces laid side by side', () => {
    // Two 100×50 rectangles sharing their 50 px edge: one 200×50 outline
    const seg = unionOutline([rect(0, 0, 100, 50), rect(100, 0, 100, 50)]);
    expect(length(seg)).toBeCloseTo(500, 6);
    for (let k = 0; k < seg.length; k += 4) expect(seg[k] === 100 && seg[k + 2] === 100).toBe(false);
  });

  it('traces only the outer edge of overlapping pieces', () => {
    // 100×100 and 100×100 overlapping by 50: a 150×100 outline
    expect(length(unionOutline([rect(0, 0, 100, 100), rect(50, 0, 100, 100)]))).toBeCloseTo(500, 6);
    // A piece inside another adds nothing
    expect(length(unionOutline([rect(0, 0, 100, 100), rect(20, 20, 30, 30)]))).toBeCloseTo(400, 6);
  });

  it('keeps every edge of pieces apart, and works whichever way a ring winds', () => {
    const reversed = (r: Float64Array) => {
      const out = new Float64Array(r.length);
      for (let k = 0; k < r.length; k += 2) {
        out[k] = r[r.length - 2 - k];
        out[k + 1] = r[r.length - 1 - k];
      }
      return out;
    };
    expect(length(unionOutline([rect(0, 0, 50, 50), rect(100, 0, 50, 50)]))).toBeCloseTo(400, 6);
    expect(length(unionOutline([reversed(rect(0, 0, 100, 50)), rect(100, 0, 100, 50)]))).toBeCloseTo(500, 6);
  });
});
