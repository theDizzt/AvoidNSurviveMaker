import { describe, expect, it } from 'vitest';
import { tiltObject, turnObjects } from './arrange';
import { compileObject } from './object';
import { bakeTilt, normalizeTilt, tiltedBounds } from './shape';
import { pointInPoly } from './geometry';
import { validateMap, createEmptyMap } from './validate';
import type { MapObject } from './types';

describe('static tilt', () => {
  const bar: MapObject = { role: 'wall', shape: { type: 'rect', x: 0, y: 40, w: 100, h: 20 } };

  it('turns the collision outline about the shape center', () => {
    const o = compileObject({ ...bar, tilt: 90 });
    // Upright now: 20 wide, 100 tall around (50, 50)
    expect(o.minX).toBeCloseTo(40);
    expect(o.maxX).toBeCloseTo(60);
    expect(o.minY).toBeCloseTo(0);
    expect(o.maxY).toBeCloseTo(100);
    expect(pointInPoly(50, 5, o.poly)).toBe(true);
    expect(pointInPoly(5, 50, o.poly)).toBe(false);
    expect(o.box.maxX - o.box.minX).toBeCloseTo(100);
  });

  it('normalizes and validates the angle', () => {
    expect(normalizeTilt(370)).toBe(10);
    expect(normalizeTilt(-190)).toBe(170);
    expect(normalizeTilt(360)).toBe(0);
    const map = createEmptyMap();
    map.objects.push({ ...bar, tilt: 405 }, { ...bar, tilt: 0 });
    const out = validateMap(map);
    expect(out.objects[0].tilt).toBe(45);
    expect(out.objects[1].tilt).toBeUndefined();
  });

  it('turns the pivot and the beam with it, but not the route', () => {
    const o: MapObject = {
      role: 'laser', shape: { type: 'rect', x: 0, y: 0, w: 20, h: 20 }, laser: { color: 0, angle: 0, on: true },
      rotation: { pivot: { x: 20, y: 10 }, speed: 90, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 },
      motion: { type: 'linear', points: [{ x: 100, y: 10 }], speed: 50, repeat: 'loop', easing: 'none', delay: 0, clockwise: true },
    };
    const t = tiltObject(o, 90);
    expect(t.tilt).toBe(90);
    expect(t.laser!.angle).toBe(90);
    expect(t.rotation!.pivot).toEqual({ x: 10, y: 20 });
    expect(t.motion!.points).toEqual([{ x: 100, y: 10 }]);
    expect(tiltObject(t, -90).tilt).toBeUndefined();
  });

  it('mirrors the tilt on a flip and bakes into exact geometry', () => {
    expect(turnObjects([{ ...bar, tilt: 30 }], 'flipH')[0].tilt).toBe(-30);
    expect(turnObjects([{ ...bar, tilt: 30 }], 'cw')[0].tilt).toBe(30);
    const baked = bakeTilt(bar.shape, 90);
    expect(baked.type).toBe('poly');
    const b = tiltedBounds(bar.shape, 90);
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(100);
  });
});
