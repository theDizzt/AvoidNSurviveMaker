import type { Point, PolyPoint, Rect, Shape } from './types';

/**
 * Every shape is converted into one closed polygon ring [x0,y0,x1,y1,...] that is used for
 * BOTH collision and drawing, so what you see is exactly what you hit.
 * Curves are subdivided finely enough that the deviation is a fraction of a pixel.
 */
export interface FlatShape {
  poly: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Max chord length (px) when subdividing curves */
const CURVE_STEP = 3;

function bounds(poly: Float64Array): FlatShape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]);
    maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]);
    maxY = Math.max(maxY, poly[i + 1]);
  }
  return { poly, minX, minY, maxX, maxY };
}

/** Cubic Hermite / Catmull-Rom tangent at vertex i of a closed ring. Corner vertices get no tangent. */
function tangent(pts: readonly PolyPoint[], i: number): Point {
  const n = pts.length;
  if (!pts[i].smooth) return { x: 0, y: 0 };
  const prev = pts[(i - 1 + n) % n];
  const next = pts[(i + 1) % n];
  return { x: (next.x - prev.x) / 2, y: (next.y - prev.y) / 2 };
}

/** Outline of a polygon / freeform shape as a list of points (closed ring, last→first implied) */
export function polyOutline(pts: readonly PolyPoint[]): number[] {
  const out: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push(a.x, a.y);
    if (!a.smooth && !b.smooth) continue;
    const ta = tangent(pts, i);
    const tb = tangent(pts, (i + 1) % n);
    const len = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(ta.x, ta.y) * 0.5 + Math.hypot(tb.x, tb.y) * 0.5;
    const steps = Math.min(64, Math.max(4, Math.ceil(len / CURVE_STEP)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push(
        h00 * a.x + h10 * ta.x + h01 * b.x + h11 * tb.x,
        h00 * a.y + h10 * ta.y + h01 * b.y + h11 * tb.y,
      );
    }
  }
  return out;
}

export function flattenShape(s: Shape): FlatShape {
  switch (s.type) {
    case 'rect':
      return bounds(new Float64Array([s.x, s.y, s.x + s.w, s.y, s.x + s.w, s.y + s.h, s.x, s.y + s.h]));
    case 'ellipse': {
      const circumference = Math.PI * (3 * (s.rx + s.ry) - Math.sqrt((3 * s.rx + s.ry) * (s.rx + 3 * s.ry)));
      const n = Math.min(512, Math.max(24, Math.ceil(circumference / CURVE_STEP)));
      const poly = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        poly[i * 2] = s.cx + Math.cos(a) * s.rx;
        poly[i * 2 + 1] = s.cy + Math.sin(a) * s.ry;
      }
      return bounds(poly);
    }
    case 'poly':
      return bounds(new Float64Array(polyOutline(s.points)));
  }
}

export function shapeBounds(s: Shape): Rect {
  switch (s.type) {
    case 'rect':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'ellipse':
      return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    case 'poly': {
      const f = flattenShape(s);
      return { x: f.minX, y: f.minY, w: f.maxX - f.minX, h: f.maxY - f.minY };
    }
  }
}

/** Anchor point used for motion: the center of the shape's bounding box at rest */
export function shapeCenter(s: Shape): Point {
  if (s.type === 'ellipse') return { x: s.cx, y: s.cy };
  const b = shapeBounds(s);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case 'rect':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'ellipse':
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case 'poly':
      return { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
  }
}
