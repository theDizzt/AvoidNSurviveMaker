import type { Conveyor, Point, PolyPoint } from './types';

/**
 * Conveyor belts (#69) and luggage (#70): the belt's shape from its centerline, positions along
 * the belt, and the motion object that carries a crate (stepped by the simulation).
 */

/** A new belt's width (px) and speed (px/s) */
export const DEFAULT_BELT_WIDTH = 60;
export const DEFAULT_BELT_SPEED = 120;

/** A miter corner reaches at most this many half-widths from its vertex (sharp turns are cut) */
const MITER_LIMIT = 3;

/** The centerline without repeated points (a loop also drops a last point equal to the first) */
export function beltPoints(c: Pick<Conveyor, 'points' | 'loop'>): Point[] {
  const out: Point[] = [];
  for (const p of c.points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push({ x: p.x, y: p.y });
  }
  if (c.loop && out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop();
  return out;
}

/** Whether the belt is a loop (one needs at least 3 distinct points) */
export function isLoop(c: Pick<Conveyor, 'points' | 'loop'>): boolean {
  return c.loop && beltPoints(c).length >= 3;
}

/** Unit normal (left of the direction of travel, y down) of the run from a to b */
function normal(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (a.y - b.y) / len, y: (b.x - a.x) / len };
}

/**
 * The belt's two edges, `width / 2` either side of the centerline, with mitered corners.
 * For an open belt they run from the first point to the last; for a loop they are closed rings.
 */
export function beltSides(c: Conveyor): { left: Point[]; right: Point[]; loop: boolean } {
  const pts = beltPoints(c);
  const loop = isLoop(c);
  const n = pts.length;
  const h = c.width / 2;
  const left: Point[] = [];
  const right: Point[] = [];
  if (n < 2) return { left, right, loop };
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? pts[i - 1] : loop ? pts[n - 1] : null;
    const next = i < n - 1 ? pts[i + 1] : loop ? pts[0] : null;
    const p = pts[i];
    const nIn = prev ? normal(prev, p) : null;
    const nOut = next ? normal(p, next) : null;
    let m: Point;
    if (nIn && nOut) {
      const sx = nIn.x + nOut.x;
      const sy = nIn.y + nOut.y;
      const len = Math.hypot(sx, sy);
      if (len < 1e-9) m = nOut; // a full turn back: no sensible corner
      else {
        const u = { x: sx / len, y: sy / len };
        const k = Math.min(MITER_LIMIT, 1 / Math.max(1e-9, u.x * nOut.x + u.y * nOut.y));
        m = { x: u.x * k, y: u.y * k };
      }
    } else m = (nIn ?? nOut)!;
    left.push({ x: p.x + m.x * h, y: p.y + m.y * h });
    right.push({ x: p.x - m.x * h, y: p.y - m.y * h });
  }
  return { left, right, loop };
}

/**
 * The belt's outline as one polygon ring: an open belt is its left edge out and its right edge
 * back; a loop is its outer edge, then its inner edge the other way round, joined by a seam of no
 * width (so it fills and tests as a ring with a hole, with even-odd and nonzero alike).
 */
export function conveyorOutline(c: Conveyor): PolyPoint[] {
  const { left, right, loop } = beltSides(c);
  if (left.length < 2) return [];
  if (!loop) return [...left, ...right.reverse()];
  const inner = [right[0], ...right.slice(1).reverse(), right[0]];
  return [...left, left[0], ...inner];
}

/** A belt's centerline, measured by distance along it */
export class BeltPath {
  /** x, y per point (a loop repeats its first point at the end) */
  readonly pts: Float64Array;
  /** Distance along the belt at each point */
  readonly at: Float64Array;
  readonly length: number;
  readonly loop: boolean;
  /** +1: toward the last point, −1: toward the first */
  readonly sign: 1 | -1;
  readonly width: number;
  /** px per ms */
  readonly speed: number;

  constructor(c: Conveyor) {
    const pts = beltPoints(c);
    this.loop = isLoop(c);
    if (this.loop) pts.push(pts[0]);
    this.pts = new Float64Array(pts.flatMap((p) => [p.x, p.y]));
    this.at = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) this.at[i] = this.at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    this.length = this.at[pts.length - 1] ?? 0;
    this.sign = c.reverse ? -1 : 1;
    this.width = c.width;
    this.speed = c.speed / 1000;
  }

  /** Distance along the belt of the centerline point nearest (x, y); `dir` gets that run's direction of travel */
  project(x: number, y: number, dir?: Point): number {
    const p = this.pts;
    let best = Infinity;
    let s = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = (ax + dx * u - x) ** 2 + (ay + dy * u - y) ** 2;
      if (d < best) {
        best = d;
        s = this.at[i / 2] + Math.sqrt(len2) * u;
        if (dir) {
          const len = Math.sqrt(len2);
          dir.x = (dx / len) * this.sign;
          dir.y = (dy / len) * this.sign;
        }
      }
    }
    return s;
  }

  /** The centerline point at distance s along the belt (wrapped round a loop, clamped otherwise) */
  pointAt(s: number, out: Point): Point {
    const L = this.length;
    if (this.loop && L > 0) s = ((s % L) + L) % L;
    else s = Math.max(0, Math.min(L, s));
    const p = this.pts;
    const n = this.at.length;
    let i = 0;
    while (i < n - 2 && this.at[i + 1] < s) i++;
    const seg = this.at[i + 1] - this.at[i];
    const u = seg > 0 ? (s - this.at[i]) / seg : 0;
    out.x = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * u;
    out.y = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * u;
    return out;
  }
}

/** Do two closed rings overlap (share any area)? Touching edges don't count. */
export function polysOverlap(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < a.length; i += 2) {
    const ax = a[i], ay = a[i + 1];
    const j = (i + 2) % a.length;
    const bx = a[j], by = a[j + 1];
    for (let k = 0; k < b.length; k += 2) {
      const l = (k + 2) % b.length;
      if (segmentsCross(ax, ay, bx, by, b[k], b[k + 1], b[l], b[l + 1])) return true;
    }
  }
  return insideRing(a[0], a[1], b) || insideRing(b[0], b[1], a);
}

/** Proper crossing of segments AB and CD (endpoints touching or collinear overlaps don't count) */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function insideRing(x: number, y: number, ring: Float64Array): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Where a crate (#70) is: moved by the simulation step by step, so its offset at any time is known
 * only for the latest step (from `t0` to `t1`), which is all the collision checks and drawing ask for.
 * Reset when a run starts; outside a run (the editor) it stays where it was placed.
 */
export class LuggageMover {
  readonly moves = true;
  t0 = 0;
  x0 = 0;
  y0 = 0;
  t1 = 0;
  x1 = 0;
  y1 = 0;

  reset(): void {
    this.t0 = this.t1 = 0;
    this.x0 = this.y0 = this.x1 = this.y1 = 0;
  }

  /** Start a step from `ta` (where it is now) to `tb` (where it will be: set x1 / y1 after) */
  begin(ta: number, tb: number): void {
    this.x0 = this.x1;
    this.y0 = this.y1;
    this.t0 = ta;
    this.t1 = tb;
  }

  offsetAt(t: number, out: Point): Point {
    if (t >= this.t1 || this.t1 <= this.t0) {
      out.x = this.x1;
      out.y = this.y1;
    } else if (t <= this.t0) {
      out.x = this.x0;
      out.y = this.y0;
    } else {
      const f = (t - this.t0) / (this.t1 - this.t0);
      out.x = this.x0 + (this.x1 - this.x0) * f;
      out.y = this.y0 + (this.y1 - this.y0) * f;
    }
    return out;
  }
}
