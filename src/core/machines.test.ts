import { describe, expect, it } from 'vitest';
import { gearRing, handPivot, PendulumSwing, pressExtension } from './machines';
import { CompiledRotation } from './motion';
import { compileObject } from './object';
import { Simulation } from './simulation';
import type { MapData, MapObject, Rotation } from './types';
import { createEmptyMap, validateMap } from './validate';

function mapWith(...objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

function sweep(sim: Simulation, t0: number, x0: number, y0: number, x1: number, y1: number, ms: number): number {
  for (let k = 1; k <= ms; k++) sim.feed(t0 + k, x0 + ((x1 - x0) * k) / ms, y0 + ((y1 - y0) * k) / ms);
  return t0 + ms;
}

const deg = (rad: number) => (rad * 180) / Math.PI;

describe('beat-by-beat rotation (#111 / #113)', () => {
  const rot = (patch: Partial<Rotation> = {}): Rotation => ({
    pivot: { x: 0, y: 0 }, speed: 0, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0,
    tick: { angle: 6, moveMs: 100, waitMs: 900 }, ...patch,
  });

  it('turns one beat, then stays still until the next', () => {
    const r = new CompiledRotation(rot());
    expect(deg(r.angleAt(50))).toBeCloseTo(3);
    expect(deg(r.angleAt(100))).toBeCloseTo(6);
    expect(deg(r.angleAt(900))).toBeCloseTo(6);
    expect(deg(r.angleAt(1050))).toBeCloseTo(9);
    expect(deg(r.angleAt(60_000))).toBeCloseTo(360);
  });

  it('keeps the sweep and repeat of the rotation', () => {
    const once = new CompiledRotation(rot({ angle: 12, repeat: 'once' }));
    expect(deg(once.angleAt(10_000))).toBeCloseTo(12);
    const back = new CompiledRotation(rot({ angle: 12, repeat: 'pingpong' }));
    expect(deg(back.angleAt(2100))).toBeCloseTo(6);
    expect(deg(back.angleAt(3100))).toBeCloseTo(0);
    const ccw = new CompiledRotation(rot({ clockwise: false }));
    expect(deg(ccw.angleAt(100))).toBeCloseTo(-6);
  });

  it('is kept through validation', () => {
    const m = mapWith({ role: 'wall', shape: { type: 'rect', x: 500, y: 300, w: 24, h: 150 }, hand: true, rotation: rot({ pivot: { x: 512, y: 438 } }) });
    expect(m.objects[0].rotation?.tick).toEqual({ angle: 6, moveMs: 100, waitMs: 900 });
    expect(m.objects[0].hand).toBe(true);
  });
});

describe('machines (#111–114)', () => {
  it('a gear is square and has its teeth in its outline', () => {
    const m = mapWith({ role: 'wall', shape: { type: 'rect', x: 500, y: 300, w: 120, h: 80 }, gear: { teeth: 8, depth: 25 } });
    expect(m.objects[0].shape).toEqual({ type: 'rect', x: 520, y: 300, w: 80, h: 80 });
    expect(gearRing({ x: 0, y: 0, w: 80, h: 80 }, { teeth: 8, depth: 25 }).length).toBe(8 * 5 * 2);
  });

  it('a clock hand turns about its hub', () => {
    expect(handPivot({ x: 100, y: 100, w: 20, h: 200 })).toEqual({ x: 110, y: 290 });
    expect(handPivot({ x: 100, y: 100, w: 200, h: 20 })).toEqual({ x: 110, y: 110 });
  });

  it('a pendulum swings to each side and back', () => {
    const p = new PendulumSwing({ amplitude: 40, periodMs: 2000, delay: 0 });
    expect(deg(p.angleAt(0))).toBeCloseTo(0);
    expect(deg(p.angleAt(500))).toBeCloseTo(40);
    expect(deg(p.angleAt(1500))).toBeCloseTo(-40);
    const o = compileObject(mapWith({ role: 'wall', shape: { type: 'rect', x: 500, y: 100, w: 50, h: 300 }, pendulum: { amplitude: 40, periodMs: 2000, delay: 0 } }).objects[0]);
    expect(o.rotation).not.toBeNull();
    expect(o.py).toBeLessThan(120);
  });

  it('a press waits, slams, holds and rises, one beat after another', () => {
    const p = { reach: 100, downMs: 100, holdMs: 200, upMs: 300, waitMs: 400, delay: 0 };
    expect(pressExtension(p, 200)).toBe(0);
    expect(pressExtension(p, 450)).toBeCloseTo(0.25);
    expect(pressExtension(p, 600)).toBe(1);
    expect(pressExtension(p, 1000)).toBe(0);
    expect(pressExtension(p, 1150)).toBeLessThan(0.5);
  });

  it("a press's head slams down onto the cursor; its cylinder is deadly too", () => {
    const press = (x: number): MapObject => ({ role: 'wall', shape: { type: 'rect', x, y: 400, w: 100, h: 30 },
      press: { reach: 120, downMs: 100, holdMs: 100000, upMs: 100, waitMs: 0, delay: 0 } });
    // Shut over the cursor's line at y = 540 (head ends up at 520–550)
    const shut = new Simulation(mapWith(press(800)));
    shut.start(120, 540);
    sweep(shut, 0, 120, 540, 1800, 540, 800);
    expect(shut.status).toBe('dead');
    // Its cylinder (above the head) stays put
    const cyl = new Simulation(mapWith(press(800)));
    cyl.start(120, 540);
    sweep(cyl, 0, 120, 540, 850, 330, 600);
    expect(cyl.status).toBe('dead');
  });

  it('a press never takes a route', () => {
    const m = mapWith({ role: 'wall', shape: { type: 'rect', x: 800, y: 400, w: 100, h: 30 },
      motion: { type: 'linear', points: [{ x: 900, y: 500 }], speed: 100, repeat: 'loop', easing: 'none', delay: 0, clockwise: true },
      press: { reach: 120, downMs: 100, holdMs: 100, upMs: 100, waitMs: 100, delay: 0 } });
    expect(m.objects[0].motion).toBeUndefined();
  });
});
