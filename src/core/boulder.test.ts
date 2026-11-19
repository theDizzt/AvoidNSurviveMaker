import { describe, expect, it } from 'vitest';
import { boulderShape } from './hazards';
import { CompiledMotion, weave } from './motion';
import { compileObject } from './object';
import type { MapObject, Motion, Point } from './types';
import { createEmptyMap, validateMap } from './validate';

const motion = (points: Point[], extra: Partial<Motion> = {}): Motion => ({
  type: 'linear', points, speed: 100, repeat: 'once', easing: 'none', delay: 0, clockwise: true, ...extra,
});

describe('wavy route (#30 boulder)', () => {
  it('starts and ends on the route and swings by the amplitude in between', () => {
    const pts = weave([0, 0, 400, 0], { amplitude: 20, wavelength: 100 });
    expect(pts[0]).toBeCloseTo(0);
    expect(pts[1]).toBeCloseTo(0);
    expect(pts.at(-2)).toBeCloseTo(400);
    expect(pts.at(-1)).toBeCloseTo(0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeCloseTo(20, 0);
    expect(Math.min(...ys)).toBeCloseTo(-20, 0);
  });

  it('first bumps up on a route heading left', () => {
    const pts = weave([400, 100, 0, 100], { amplitude: 20, wavelength: 100 });
    // A quarter wave in: y is above the route (smaller on screen)
    const i = pts.findIndex((v, k) => k % 2 === 0 && v <= 375);
    expect(pts[i + 1]).toBeLessThan(100 - 15);
  });

  it('fits whole half-waves into each leg so legs join without a jump', () => {
    const m = new CompiledMotion(motion([{ x: 330, y: 0 }, { x: 330, y: 250 }], { wave: { amplitude: 15, wavelength: 100 } }), { x: 0, y: 0 });
    const pass = m.pass;
    const at = (t: number) => m.offsetAt(t, { x: 0, y: 0 });
    // Marker 1 lies at the end of leg 1: the wave is back on the route there
    const leg1 = m.legs[0].dur;
    const p = at(leg1);
    expect(p.x).toBeCloseTo(330, 0);
    expect(p.y).toBeCloseTo(0, 0);
    // No jump anywhere along the route
    let prev = at(0);
    for (let t = 5; t <= pass; t += 5) {
      const q = at(t);
      expect(Math.hypot(q.x - prev.x, q.y - prev.y)).toBeLessThan(2);
      prev = q;
    }
  });

  it('rolls by the distance it really travels (longer than the straight route)', () => {
    const straight = compileObject({ role: 'wall', boulder: true, shape: { type: 'poly', points: boulderShape(0, 0, 26) }, motion: motion([{ x: 400, y: 0 }]) });
    const wavy = compileObject({ role: 'wall', boulder: true, shape: { type: 'poly', points: boulderShape(0, 0, 26) }, motion: motion([{ x: 400, y: 0 }], { wave: { amplitude: 14, wavelength: 120 } }) });
    expect(Math.abs(wavy.rotation!.angleAt(1e9))).toBeGreaterThan(Math.abs(straight.rotation!.angleAt(1e9)));
  });

  it('survives validation and drops a bad wave', () => {
    const m = createEmptyMap();
    const o: MapObject = { role: 'wall', boulder: true, shape: { type: 'poly', points: boulderShape(300, 300, 26) }, motion: motion([{ x: 600, y: 300 }], { wave: { amplitude: 14, wavelength: 120 } }) };
    m.objects = [o];
    expect(validateMap(JSON.parse(JSON.stringify(m))).objects[0].motion!.wave).toEqual({ amplitude: 14, wavelength: 120 });
    const bad = JSON.parse(JSON.stringify(m));
    bad.objects[0].motion.wave = { amplitude: 14, wavelength: 1 };
    expect(() => validateMap(bad)).toThrow();
  });

  it('rock outline: 10 knobs of 3 corners each, within the radius', () => {
    const pts = boulderShape(0, 0, 26);
    expect(pts).toHaveLength(30);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(26.01);
    expect(pts.every((p) => !p.smooth)).toBe(true);
  });
});
