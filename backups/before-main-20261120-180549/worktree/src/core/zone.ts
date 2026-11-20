import { pointInPoly, pointInRect, segmentPolyCrossings, segmentRectEntry } from './geometry';
import { flattenShape } from './shape';
import type { MapData, PolyPoint, Rect, Shape, ZoneShape } from './types';

/**
 * START / GOAL areas (#9/#10 rectangles; #63–68 circles, polygons and freeforms).
 *
 * `map.start` / `map.goal` stay the zone's rectangle; a shaped zone also has `startShape` /
 * `goalShape`, laid out inside that rectangle in 0–1 coordinates, so moving or resizing the
 * rectangle moves and stretches the shape with it. Without a shape the zone is the rectangle.
 */

export type ZoneKind = 'start' | 'goal';

export function zoneOf(map: MapData, kind: ZoneKind): { rect: Rect; shape?: ZoneShape } {
  return kind === 'start' ? { rect: map.start, shape: map.startShape } : { rect: map.goal, shape: map.goalShape };
}

/** The zone as a map shape */
export function zoneShape(r: Rect, z: ZoneShape | undefined): Shape {
  if (!z) return { type: 'rect', ...r };
  if (z.type === 'ellipse') return { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
  return {
    type: 'poly',
    points: z.points.map((p) => ({ ...p, x: r.x + p.x * r.w, y: r.y + p.y * r.h })),
    ...(z.free ? { free: true } : {}),
  };
}

/** The zone's outline ring (map units) */
export function zoneRing(r: Rect, z: ZoneShape | undefined): Float64Array {
  return flattenShape(zoneShape(r, z)).poly;
}

/** A shape drawn for a zone: its bounding rectangle, and the shape laid out inside it in 0–1 coordinates */
export function zoneFromShape(s: Shape): { rect: Rect; shape?: ZoneShape } {
  const f = flattenShape(s);
  const rect = { x: f.minX, y: f.minY, w: f.maxX - f.minX, h: f.maxY - f.minY };
  if (s.type === 'rect') return { rect };
  if (s.type === 'ellipse') return { rect, shape: { type: 'ellipse' } };
  if (s.type !== 'poly') return { rect };
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const points: PolyPoint[] = s.points.map((p) => ({
    ...p,
    x: rect.w ? round((p.x - rect.x) / rect.w) : 0,
    y: rect.h ? round((p.y - rect.y) / rect.h) : 0,
  }));
  return { rect, shape: { type: 'poly', points, ...(s.free || s.points.some((p) => p.smooth) ? { free: true } : {}) } };
}

/** A zone ready for hit tests: the rectangle alone, or its shape's ring */
export class ZoneArea {
  private readonly ring: Float64Array | null;

  constructor(private readonly rect: Rect, shape: ZoneShape | undefined) {
    this.ring = shape ? zoneRing(rect, shape) : null;
  }

  contains(x: number, y: number): boolean {
    if (!pointInRect(x, y, this.rect)) return false;
    return !this.ring || pointInPoly(x, y, this.ring);
  }

  /** Earliest fraction u ∈ [0, 1] of segment A→B inside the zone, or −1 */
  entry(ax: number, ay: number, bx: number, by: number): number {
    const r = this.rect;
    const box = segmentRectEntry(ax, ay, bx, by, r.x, r.y, r.w, r.h);
    if (!this.ring || box < 0) return box;
    if (pointInPoly(ax, ay, this.ring)) return 0;
    const out: number[] = [];
    segmentPolyCrossings(ax, ay, bx, by, this.ring, out);
    let best = Infinity;
    for (const u of out) if (u >= 0 && u <= 1 && u < best) best = u;
    return Number.isFinite(best) ? best : -1;
  }
}
