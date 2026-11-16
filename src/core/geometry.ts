import type { Rect } from './types';

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Fraction t ∈ [0,1] along segment (x0,y0)→(x1,y1) where it first touches rect (rx,ry,rw,rh).
 * Returns -1 if it never touches, 0 if the start point is already inside. (Liang–Barsky clipping)
 */
export function segmentRectEntry(
  x0: number, y0: number, x1: number, y1: number,
  rx: number, ry: number, rw: number, rh: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tEnter = 0;
  let tExit = 1;
  for (let i = 0; i < 4; i++) {
    let p: number;
    let q: number;
    switch (i) {
      case 0: p = -dx; q = x0 - rx; break;
      case 1: p = dx; q = rx + rw - x0; break;
      case 2: p = -dy; q = y0 - ry; break;
      default: p = dy; q = ry + rh - y0; break;
    }
    if (p === 0) {
      if (q < 0) return -1;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tExit) return -1;
      if (t > tEnter) tEnter = t;
    } else {
      if (t < tEnter) return -1;
      if (t < tExit) tExit = t;
    }
  }
  return tEnter;
}

/**
 * Point-in-polygon (even–odd rule). `poly` is a flat closed ring [x0,y0,x1,y1,...].
 */
export function pointInPoly(px: number, py: number, poly: Float64Array): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Push every fraction u ∈ (0,1] where segment A→B crosses an edge of the closed ring `poly`.
 * Parallel/collinear edges are skipped; containment checks between crossings cover them.
 */
export function segmentPolyCrossings(
  ax: number, ay: number, bx: number, by: number, poly: Float64Array, out: number[],
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const px = poly[j];
    const py = poly[j + 1];
    const ex = poly[i] - px;
    const ey = poly[i + 1] - py;
    const denom = dx * ey - dy * ex;
    if (denom === 0) continue;
    const wx = px - ax;
    const wy = py - ay;
    const u = (wx * ey - wy * ex) / denom;
    if (u <= 0 || u > 1) continue;
    const v = (wx * dy - wy * dx) / denom;
    if (v >= 0 && v <= 1) out.push(u);
  }
}
