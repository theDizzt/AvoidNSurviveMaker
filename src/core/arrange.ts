import { flattenShape, shapeBounds, shapeCenter, translateShape } from './shape';
import type { MapObject, Point, Rect, Shape } from './types';

/**
 * Editing operations on whole objects: moving, 90° rotation, flipping, alignment, z-order.
 * Pure functions; the editor applies the results to the map.
 */

/** Move an object; its route markers and pivot travel with it */
export function translateObject(o: MapObject, dx: number, dy: number): MapObject {
  const out: MapObject = { ...structuredClone(o), shape: translateShape(o.shape, dx, dy) };
  if (out.motion) out.motion.points = out.motion.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (out.rotation) out.rotation.pivot = { x: out.rotation.pivot.x + dx, y: out.rotation.pivot.y + dy };
  return out;
}

export function unionRect(rects: readonly Rect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function objectsBounds(objs: readonly MapObject[]): Rect {
  return unionRect(objs.map((o) => shapeBounds(o.shape)));
}

/** Quarter turns (+1 = 90° clockwise on screen) and mirror flips, all about a center point */
export type Turn = 'cw' | 'ccw' | 'flipH' | 'flipV';

function turnPoint(p: Point, c: Point, t: Turn): Point {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  switch (t) {
    case 'cw': return { x: c.x - dy, y: c.y + dx }; // y points down, so this is clockwise on screen
    case 'ccw': return { x: c.x + dy, y: c.y - dx };
    case 'flipH': return { x: c.x - dx, y: p.y };
    case 'flipV': return { x: p.x, y: c.y - dy };
  }
}

function turnShape(s: Shape, c: Point, t: Turn): Shape {
  const quarter = t === 'cw' || t === 'ccw';
  switch (s.type) {
    case 'rect': {
      const a = turnPoint({ x: s.x, y: s.y }, c, t);
      const b = turnPoint({ x: s.x + s.w, y: s.y + s.h }, c, t);
      return { type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    }
    case 'ellipse': {
      const m = turnPoint({ x: s.cx, y: s.cy }, c, t);
      return { type: 'ellipse', cx: m.x, cy: m.y, rx: quarter ? s.ry : s.rx, ry: quarter ? s.rx : s.ry };
    }
    case 'poly':
      return { ...s, points: s.points.map((p) => ({ ...p, ...turnPoint(p, c, t) })) };
    case 'sector': {
      const apex = turnPoint({ x: s.cx, y: s.cy }, c, t);
      const start = t === 'cw' ? s.start + 90 : t === 'ccw' ? s.start - 90 : t === 'flipH' ? 180 - s.start - s.sweep : -s.start - s.sweep;
      return { ...s, cx: apex.x, cy: apex.y, start: ((start % 360) + 360) % 360 };
    }
  }
}

/**
 * Rotate / flip objects as one unit about the center of their combined bounds.
 * The rotation pivot turns with the shape. A route keeps its own shape and simply follows the
 * object's new center (rotating a moving platform shouldn't swing its route around).
 */
export function turnObjects(objs: readonly MapObject[], t: Turn): MapObject[] {
  const b = objectsBounds(objs);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return objs.map((o) => {
    const out = structuredClone(o);
    const before = shapeCenter(o.shape);
    out.shape = turnShape(o.shape, c, t);
    const after = shapeCenter(out.shape);
    if (out.rotation) out.rotation.pivot = turnPoint(out.rotation.pivot, c, t);
    // Directions turn too: a spike's thrust, a laser's beam
    const turnAngle = (a: number) => {
      const r = t === 'cw' ? a + 90 : t === 'ccw' ? a - 90 : t === 'flipH' ? 180 - a : -a;
      return ((r % 360) + 360) % 360;
    };
    if (out.spike) out.spike.angle = turnAngle(out.spike.angle);
    if (out.laser) out.laser.angle = turnAngle(out.laser.angle);
    if (out.motion) {
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      out.motion.points = out.motion.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    return out;
  });
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Offset that aligns `r` within `to` */
export function alignOffset(r: Rect, to: Rect, mode: AlignMode): Point {
  switch (mode) {
    case 'left': return { x: to.x - r.x, y: 0 };
    case 'center': return { x: to.x + to.w / 2 - (r.x + r.w / 2), y: 0 };
    case 'right': return { x: to.x + to.w - (r.x + r.w), y: 0 };
    case 'top': return { x: 0, y: to.y - r.y };
    case 'middle': return { x: 0, y: to.y + to.h / 2 - (r.y + r.h / 2) };
    case 'bottom': return { x: 0, y: to.y + to.h - (r.y + r.h) };
  }
}

/**
 * Offsets that spread units evenly (equal gaps) between the outermost two, or across `span`
 * when given (distribute relative to the map).
 */
export function distributeOffsets(rects: readonly Rect[], axis: 'x' | 'y', span?: Rect): Point[] {
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const order = rects.map((_, i) => i).sort((a, b) => pos(rects[a]) + size(rects[a]) / 2 - (pos(rects[b]) + size(rects[b]) / 2));
  const out: Point[] = rects.map(() => ({ x: 0, y: 0 }));
  if (rects.length === 0) return out;
  const start = span ? pos(span) : pos(rects[order[0]]);
  const end = span ? pos(span) + size(span) : Math.max(...rects.map((r) => pos(r) + size(r)));
  const total = rects.reduce((s, r) => s + size(r), 0);
  const parts = span ? rects.length + 1 : rects.length - 1;
  const gap = parts > 0 ? (end - start - total) / parts : 0;
  let cursor = span ? start + gap : start;
  for (const i of order) {
    const d = cursor - pos(rects[i]);
    out[i] = axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d };
    cursor += size(rects[i]) + gap;
  }
  return out;
}

export type ZOrder = 'front' | 'forward' | 'backward' | 'back';

/**
 * New drawing order after moving the `picked` indices. Returns `order` where order[k] is the old
 * index of the object that ends up at position k.
 */
export function reorder(count: number, picked: readonly number[], op: ZOrder): number[] {
  const set = new Set(picked);
  const order = Array.from({ length: count }, (_, i) => i);
  if (op === 'front') return [...order.filter((i) => !set.has(i)), ...order.filter((i) => set.has(i))];
  if (op === 'back') return [...order.filter((i) => set.has(i)), ...order.filter((i) => !set.has(i))];
  if (op === 'forward') {
    for (let k = count - 2; k >= 0; k--) {
      if (set.has(order[k]) && !set.has(order[k + 1])) [order[k], order[k + 1]] = [order[k + 1], order[k]];
    }
  } else {
    for (let k = 1; k < count; k++) {
      if (set.has(order[k]) && !set.has(order[k - 1])) [order[k], order[k - 1]] = [order[k - 1], order[k]];
    }
  }
  return order;
}

/** Area centroid (center of mass) of a shape's outline; falls back to the bounds center */
export function shapeCentroid(s: Shape): Point {
  if (s.type !== 'poly' && s.type !== 'sector') return shapeCenter(s);
  const { poly } = flattenShape(s);
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const cross = poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
    a += cross;
    cx += (poly[j] + poly[i]) * cross;
    cy += (poly[j + 1] + poly[i + 1]) * cross;
  }
  if (Math.abs(a) < 1e-9) return shapeCenter(s);
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
