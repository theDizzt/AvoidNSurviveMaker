import { pointInPoly, segmentPolyCrossings } from './geometry';

/** How far (map units) past an edge to look for a neighbouring shape that covers it */
const PROBE = 0.75;

/**
 * The outer edge of several overlapping or touching closed rings drawn as one shape: every edge
 * piece that another ring covers (a shared seam, an overlap) is left out. Returns line segments
 * [x0, y0, x1, y1, ...].
 */
export function unionOutline(rings: readonly Float64Array[]): number[] {
  const out: number[] = [];
  const boxes = rings.map(bounds);
  const cuts: number[] = [];
  rings.forEach((ring, a) => {
    // Which side is outside: the ring's winding decides
    let area = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
    const side = area >= 0 ? 1 : -1;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const px = ring[j], py = ring[j + 1], qx = ring[i], qy = ring[i + 1];
      const dx = qx - px, dy = qy - py;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const nx = (side * dy) / len, ny = (-side * dx) / len;
      const minX = Math.min(px, qx) - PROBE, maxX = Math.max(px, qx) + PROBE;
      const minY = Math.min(py, qy) - PROBE, maxY = Math.max(py, qy) + PROBE;
      const near: number[] = [];
      for (let b = 0; b < rings.length; b++) {
        const bb = boxes[b];
        if (b !== a && maxX >= bb[0] && minX <= bb[2] && maxY >= bb[1] && minY <= bb[3]) near.push(b);
      }
      if (!near.length) {
        out.push(px, py, qx, qy);
        continue;
      }
      cuts.length = 0;
      for (const b of near) segmentPolyCrossings(px, py, qx, qy, rings[b], cuts);
      cuts.push(0, 1);
      cuts.sort((u, v) => u - v);
      for (let k = 1; k < cuts.length; k++) {
        const u0 = Math.max(0, cuts[k - 1]), u1 = Math.min(1, cuts[k]);
        if (u1 - u0 < 1e-9) continue;
        const m = (u0 + u1) / 2;
        const mx = px + dx * m, my = py + dy * m;
        // Covered by a neighbour: a seam or an overlap, inside the sheet
        if (near.some((b) => pointInPoly(mx + nx * PROBE, my + ny * PROBE, rings[b]))) continue;
        // Running along an earlier ring's edge (both inside it here): that ring draws it
        if (near.some((b) => b < a && pointInPoly(mx - nx * PROBE, my - ny * PROBE, rings[b]))) continue;
        out.push(px + dx * u0, py + dy * u0, px + dx * u1, py + dy * u1);
      }
    }
  });
  return out;
}

function bounds(ring: Float64Array): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]);
    maxX = Math.max(maxX, ring[i]);
    minY = Math.min(minY, ring[i + 1]);
    maxY = Math.max(maxY, ring[i + 1]);
  }
  return [minX, minY, maxX, maxY];
}
