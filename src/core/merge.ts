import clip, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping';
import { flattenShape } from './shape';
import type { PolyPoint, Shape } from './types';

/**
 * Shape merging, like PowerPoint's "Merge Shapes":
 * - union:     everything together
 * - combine:   everything, with the overlapping areas cut out (XOR)
 * - fragment:  split into every separate piece the outlines create
 * - intersect: only the area all shapes share
 * - subtract:  the first shape minus all the others
 *
 * Shapes are merged as their flattened outlines (exactly what you see and hit). Each resulting
 * region becomes one freeform polygon. A map polygon is a single ring, so a region with holes is
 * stitched into one ring with a zero-width "keyhole" cut to every hole: with the even-odd /
 * nonzero rules used for collision and drawing, the cut covers no area.
 */
export type MergeOp = 'union' | 'combine' | 'fragment' | 'intersect' | 'subtract';

/** Turning angle (degrees) below which a vertex is treated as part of a curve */
const SMOOTH_TURN = 25;
const MIN_AREA = 1;

function toPolygon(s: Shape): Polygon {
  const { poly } = flattenShape(s);
  const ring: Pair[] = [];
  for (let i = 0; i < poly.length; i += 2) ring.push([poly[i], poly[i + 1]]);
  return [ring];
}

function signedArea(r: readonly Pair[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/** polygon-clipping repeats the first point at the end of every ring */
function openRing(r: readonly Pair[]): Pair[] {
  const out = r.slice();
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function segDist(p: Pair, a: Pair, b: Pair): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

/** Douglas–Peucker on a closed ring */
export function simplifyRing(ring: readonly Pair[], tol: number): Pair[] {
  const n = ring.length;
  if (n <= 4) return ring.slice();
  // Split at vertex 0 and the vertex farthest from it, then simplify both halves
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const b = ring[e % n];
    let best = -1;
    let bestD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(ring[i], ring[s], b);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** Join holes into the outer ring through zero-width cuts (holes are wound opposite to the outer ring) */
export function bridgeHoles(outer: readonly Pair[], holes: readonly Pair[][]): Pair[] {
  let ring = outer.slice();
  const outerSign = Math.sign(signedArea(outer));
  const prepared = holes
    .map((h) => (Math.sign(signedArea(h)) === outerSign ? h.slice().reverse() : h.slice()))
    .map((h) => {
      let mi = 0;
      for (let i = 1; i < h.length; i++) if (h[i][0] > h[mi][0]) mi = i;
      return { h, mi };
    })
    // Rightmost holes first: anything between a hole and the outer ring along its cut is then
    // already part of the ring, so the cut never crosses an edge
    .sort((a, b) => b.h[b.mi][0] - a.h[a.mi][0]);

  for (const { h, mi } of prepared) {
    const m = h[mi];
    let bestX = Infinity;
    let edge = -1;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      if (a[1] > m[1] === b[1] > m[1]) continue;
      const x = a[0] + ((m[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x >= m[0] && x < bestX) {
        bestX = x;
        edge = k;
      }
    }
    if (edge < 0) continue;
    const p: Pair = [bestX, m[1]];
    const loop = [...h.slice(mi), ...h.slice(0, mi), m];
    ring = [...ring.slice(0, edge + 1), p, ...loop, p, ...ring.slice(edge + 1)];
  }
  return ring;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Vertices where the outline turns only slightly came from curves: mark them smooth */
function toPoints(ring: readonly Pair[], smoothable: boolean): PolyPoint[] {
  const n = ring.length;
  const counts = new Map<string, number>();
  for (const [x, y] of ring) counts.set(`${x},${y}`, (counts.get(`${x},${y}`) ?? 0) + 1);
  return ring.map(([x, y], i) => {
    const pt: PolyPoint = { x: round(x), y: round(y) };
    if (!smoothable || counts.get(`${x},${y}`)! > 1) return pt; // keyhole cut ends stay sharp
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const t1 = Math.atan2(y - a[1], x - a[0]);
    const t2 = Math.atan2(b[1] - y, b[0] - x);
    let turn = Math.abs(t2 - t1) * (180 / Math.PI);
    if (turn > 180) turn = 360 - turn;
    if (turn < SMOOTH_TURN) pt.smooth = true;
    return pt;
  });
}

/** One clipping result polygon → one freeform shape within the vertex budget, or null if degenerate */
function polygonToShape(p: Polygon, maxPoints: number, smoothable: boolean): Shape | null {
  const outer = openRing(p[0]);
  if (outer.length < 3 || Math.abs(signedArea(outer)) < MIN_AREA) return null;
  const holes = p.slice(1).map(openRing).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) >= MIN_AREA);
  for (let tol = 0.15; tol < 1e4; tol *= 1.5) {
    const o = simplifyRing(outer, tol);
    const hs = holes.map((h) => simplifyRing(h, tol)).filter((h) => h.length >= 3);
    // Each hole adds 2 vertices for its cut (the cut point and the hole's start, repeated)
    const total = o.length + hs.reduce((s, h) => s + h.length + 2, 0);
    if (total > maxPoints || o.length < 3) continue;
    const ring = hs.length ? bridgeHoles(o, hs) : o;
    return { type: 'poly', points: toPoints(ring, smoothable), free: true };
  }
  return null;
}

function isCurved(s: Shape): boolean {
  return s.type === 'ellipse' || s.type === 'sector' || (s.type === 'poly' && s.points.some((p) => p.smooth));
}

/**
 * Merge shapes (in selection order; `subtract` keeps the first and removes the rest).
 * Returns groups of shapes: one group per result region set — `fragment` returns one entry per
 * piece, the other operations a single entry that may hold several disconnected shapes.
 */
export function mergeShapes(op: MergeOp, shapes: readonly Shape[], maxPoints: number): Shape[][] {
  if (shapes.length < 2) return [];
  const polys = shapes.map(toPolygon);
  const [first, ...rest] = polys;
  let results: MultiPolygon[];
  switch (op) {
    case 'union': results = [clip.union(first, ...rest)]; break;
    case 'combine': results = [clip.xor(first, ...rest)]; break;
    case 'intersect': results = [clip.intersection(first, ...rest)]; break;
    case 'subtract': results = [clip.difference(first, ...rest)]; break;
    case 'fragment': {
      let pieces: MultiPolygon[] = [];
      let covered: MultiPolygon = [];
      for (const s of polys) {
        const next: MultiPolygon[] = [];
        for (const piece of pieces) {
          const inside = clip.intersection(piece, s);
          const outside = clip.difference(piece, s);
          if (inside.length) next.push(inside);
          if (outside.length) next.push(outside);
        }
        const fresh = covered.length ? clip.difference(s, covered) : [s];
        if (fresh.length) next.push(fresh);
        covered = covered.length ? clip.union(covered, s) : [s];
        pieces = next;
      }
      // Every disconnected region is its own piece
      results = pieces.flatMap((mp) => mp.map((p) => [p]));
      break;
    }
  }
  const smoothable = shapes.some(isCurved);
  return results
    .map((mp) => mp.map((p) => polygonToShape(p, maxPoints, smoothable)).filter((s): s is Shape => s !== null))
    .filter((g) => g.length > 0);
}
