import { describe, expect, it } from 'vitest';
import { CompiledMotion, CompiledRotation } from './motion';
import { Simulation } from './simulation';
import type { MapData, MapObject, Motion, Rotation } from './types';
import { createEmptyMap, validateMap } from './validate';

const route = (repeat: Motion['repeat']): Motion => ({
  type: 'linear', points: [{ x: 100, y: 0 }], speed: 100, repeat, easing: 'none', delay: 0, clockwise: true,
});

describe("repeat 'restart'", () => {
  it('runs the route, then starts over from the beginning', () => {
    const m = new CompiledMotion(route('restart'), { x: 0, y: 0 });
    const at = (t: number) => m.offsetAt(t, { x: 0, y: 0 }).x;
    // One pass = 1 s (100 px at 100 px/s), with no closing leg back to the start
    expect(m.pass).toBe(1000);
    expect(at(500)).toBeCloseTo(50);
    expect(at(999)).toBeCloseTo(99.9);
    expect(at(1000)).toBeCloseTo(0);
    expect(at(1250)).toBeCloseTo(25);
    expect(m.jumps(990, 1010)).toBe(true);
    expect(m.jumps(1010, 1990)).toBe(false);
    // A loop goes back along a closing leg instead
    expect(new CompiledMotion(route('loop'), { x: 0, y: 0 }).pass).toBe(2000);
  });

  it('a rotation sweeps, then snaps back to its rest angle', () => {
    const r: Rotation = { pivot: { x: 0, y: 0 }, speed: 90, angle: 90, clockwise: true, repeat: 'restart', easing: 'none', delay: 0 };
    const c = new CompiledRotation(r);
    expect((c.angleAt(500) * 180) / Math.PI).toBeCloseTo(45);
    expect((c.angleAt(1500) * 180) / Math.PI).toBeCloseTo(45);
    expect(c.jumps(900, 1100)).toBe(true);
  });

  it('jumping back over the cursor does not kill it', () => {
    // A 40×40 wall slides up from (300, 540) to (300, 300) in 1.2 s, then jumps back down
    const m = createEmptyMap();
    const wall: MapObject = {
      role: 'wall', shape: { type: 'rect', x: 280, y: 520, w: 40, h: 40 },
      motion: { type: 'linear', points: [{ x: 300, y: 300 }], speed: 200, repeat: 'restart', easing: 'none', delay: 0, clockwise: true },
    };
    m.objects = [wall];
    const map: MapData = validateMap(JSON.parse(JSON.stringify(m)));
    // The cursor steps onto (300, 420) once the wall has gone past it upward, so the wall only
    // crosses it again in the jump from (300, 300) back to (300, 540) at t = 1200
    const sim = new Simulation(map);
    sim.start(120, 540);
    sim.feed(1, 200, 420);
    for (let t = 2; t < 1150; t += 5) sim.feed(t, 200, 420);
    // The wall reaches the top at t = 1200 and jumps back down; step in after it has passed
    for (let t = 1150; t < 1190; t += 5) sim.feed(t, 300, 420);
    expect(sim.status).toBe('playing');
    for (let t = 1190; t < 1300; t += 1) sim.feed(t, 300, 420);
    expect(sim.status).toBe('playing');
  });
});

describe("repeat 'slam'", () => {
  const slam = (returnSpeed?: number): Motion => ({ ...route('slam'), ...(returnSpeed ? { returnSpeed } : {}) });

  it('rushes to the end speeding up, rests, then slowly goes back', () => {
    // 100 px: 1 s in (at 100 px/s on average), 150 ms rest, 4 s back (default: a quarter of the speed)
    const m = new CompiledMotion(slam(), { x: 0, y: 0 });
    const at = (t: number) => m.offsetAt(t, { x: 0, y: 0 }).x;
    expect(at(500)).toBeCloseTo(12.5); // speeding up: only an eighth of the way at half time
    expect(at(999)).toBeGreaterThan(99);
    expect(at(1100)).toBeCloseTo(100); // resting at the end
    expect(at(1150 + 2000)).toBeCloseTo(50); // halfway back
    expect(at(1150 + 4000)).toBeCloseTo(0); // back at the start
    expect(at(1150 + 4000 + 500)).toBeCloseTo(12.5); // and again
    // The way in ends fast, the way back is slow
    expect(at(1000) - at(990)).toBeGreaterThan(2.5);
    expect(Math.abs(at(3160) - at(3150))).toBeLessThan(0.5);
  });

  it('takes its own return speed', () => {
    const m = new CompiledMotion(slam(50), { x: 0, y: 0 });
    expect(m.offsetAt(1150 + 2000, { x: 0, y: 0 }).x).toBeCloseTo(0);
  });

  it('is for routes only', () => {
    const map = createEmptyMap();
    map.objects = [{
      role: 'wall', shape: { type: 'rect', x: 400, y: 400, w: 40, h: 40 },
      rotation: { pivot: { x: 420, y: 420 }, speed: 90, angle: 90, clockwise: true, repeat: 'slam', easing: 'none', delay: 0 },
    }];
    expect(() => validateMap(JSON.parse(JSON.stringify(map)))).toThrow();
  });
});
