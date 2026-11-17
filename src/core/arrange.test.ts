import { describe, expect, it } from 'vitest';
import { alignOffset, distributeOffsets, reorder, shapeCentroid, turnObjects } from './arrange';
import { pointInPoly } from './geometry';
import { bridgeHoles, mergeShapes } from './merge';
import { flattenShape, shapeBounds } from './shape';
import type { MapObject, Shape } from './types';
import { validateMap, createEmptyMap, LIMITS } from './validate';

const rect = (x: number, y: number, w: number, h: number): Shape => ({ type: 'rect', x, y, w, h });
const inside = (s: Shape, x: number, y: number) => pointInPoly(x, y, flattenShape(s).poly);

describe('turnObjects', () => {
  it('rotates a rect 90° about its center', () => {
    const [o] = turnObjects([{ role: 'wall', shape: rect(0, 0, 100, 20) }], 'cw');
    expect(o.shape).toEqual({ type: 'rect', x: 40, y: -40, w: 20, h: 100 });
  });

  it('turns the pivot with the shape and shifts the route with the center', () => {
    const o: MapObject = {
      role: 'wall',
      shape: rect(0, 0, 100, 20),
      rotation: { pivot: { x: 0, y: 10 }, speed: 90, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 },
    };
    const [a, b] = turnObjects([o, { role: 'wall', shape: rect(200, 0, 100, 20) }], 'flipH');
    expect(a.shape).toEqual(rect(200, 0, 100, 20));
    expect(a.rotation!.pivot).toEqual({ x: 300, y: 10 });
    expect(b.shape).toEqual(rect(0, 0, 100, 20));
  });

  it('flips polygons and keeps curve flags', () => {
    const [o] = turnObjects([{ role: 'path', shape: { type: 'poly', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }] } }], 'flipV');
    expect(o.shape).toEqual({ type: 'poly', points: [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 0, y: 0 }] });
    const [c] = turnObjects([{ role: 'path', shape: { type: 'poly', free: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0, smooth: true }, { x: 0, y: 20 }] } }], 'cw');
    expect(c.shape.type === 'poly' && c.shape.free && c.shape.points[1].smooth).toBe(true);
  });
});

describe('align / distribute / reorder', () => {
  it('aligns', () => {
    expect(alignOffset({ x: 10, y: 10, w: 20, h: 20 }, { x: 0, y: 0, w: 100, h: 100 }, 'right')).toEqual({ x: 70, y: 0 });
    expect(alignOffset({ x: 10, y: 10, w: 20, h: 20 }, { x: 0, y: 0, w: 100, h: 100 }, 'middle')).toEqual({ x: 0, y: 30 });
  });

  it('distributes with equal gaps between the outermost units', () => {
    const d = distributeOffsets([{ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, { x: 90, y: 0, w: 10, h: 10 }], 'x');
    expect(d.map((p) => p.x)).toEqual([0, 30, 0]);
  });

  it('reorders', () => {
    expect(reorder(4, [1], 'front')).toEqual([0, 2, 3, 1]);
    expect(reorder(4, [2], 'back')).toEqual([2, 0, 1, 3]);
    expect(reorder(4, [1], 'forward')).toEqual([0, 2, 1, 3]);
    expect(reorder(4, [1, 2], 'backward')).toEqual([1, 2, 0, 3]);
    expect(reorder(3, [2], 'forward')).toEqual([0, 1, 2]);
  });

  it('finds the area centroid of a polygon', () => {
    const c = shapeCentroid({ type: 'poly', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }] });
    expect(c.x).toBeCloseTo(10);
    expect(c.y).toBeCloseTo(10);
  });
});

describe('mergeShapes', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);

  it('union makes one freeform shape', () => {
    const [[s]] = mergeShapes('union', [a, b], LIMITS.maxPolyPoints);
    expect(s.type === 'poly' && s.free).toBe(true);
    expect(shapeBounds(s)).toEqual({ x: 0, y: 0, w: 150, h: 150 });
    expect(inside(s, 75, 75)).toBe(true);
    expect(inside(s, 125, 25)).toBe(false);
  });

  it('intersect, subtract, combine', () => {
    const [[i]] = mergeShapes('intersect', [a, b], 256);
    expect(shapeBounds(i)).toEqual({ x: 50, y: 50, w: 50, h: 50 });
    const [[d]] = mergeShapes('subtract', [a, b], 256);
    expect(inside(d, 25, 25)).toBe(true);
    expect(inside(d, 75, 75)).toBe(false);
    const [x] = mergeShapes('combine', [a, b], 256);
    expect(x.some((s) => inside(s, 75, 75))).toBe(false);
    expect(x.some((s) => inside(s, 25, 25)) && x.some((s) => inside(s, 125, 125))).toBe(true);
  });

  it('fragment splits into every piece', () => {
    const pieces = mergeShapes('fragment', [a, b], 256);
    expect(pieces.length).toBe(3);
  });

  it('subtracting an inner shape leaves a hole that is not solid', () => {
    const [[ring]] = mergeShapes('subtract', [rect(0, 0, 100, 100), rect(30, 30, 40, 40)], 256);
    expect(inside(ring, 10, 50)).toBe(true);
    expect(inside(ring, 50, 50)).toBe(false);
    expect(inside(ring, 90, 50)).toBe(true);
    expect(inside(ring, 85, 50)).toBe(true); // on the keyhole cut line
  });

  it('keeps curves within the vertex limit and survives validation', () => {
    const groups = mergeShapes('union', [{ type: 'ellipse', cx: 100, cy: 100, rx: 90, ry: 90 }, rect(100, 80, 200, 40)], 64);
    const s = groups[0][0];
    expect(s.type === 'poly' && s.points.length <= 64).toBe(true);
    expect(s.type === 'poly' && s.points.some((p) => p.smooth)).toBe(true);
    const map = validateMap({ ...createEmptyMap(), objects: [{ role: 'wall', shape: s, group: 3 }] });
    expect(map.objects[0].shape).toEqual(s);
    expect(map.objects[0].group).toBe(3);
  });

  it('bridges several holes', () => {
    const outer: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const h1: [number, number][] = [[10, 10], [20, 10], [20, 20], [10, 20]];
    const h2: [number, number][] = [[60, 10], [70, 10], [70, 20], [60, 20]];
    const ring = bridgeHoles(outer, [h1, h2]);
    const poly = new Float64Array(ring.flat());
    expect(pointInPoly(15, 15, poly)).toBe(false);
    expect(pointInPoly(65, 15, poly)).toBe(false);
    expect(pointInPoly(40, 15, poly)).toBe(true);
  });
});
