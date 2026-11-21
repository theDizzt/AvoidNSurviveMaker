import { describe, expect, it } from 'vitest';
import { BeltPath, conveyorOutline, polysOverlap } from './conveyor';
import { pointInPoly } from './geometry';
import { transformAt, type Transform } from './object';
import { Simulation } from './simulation';
import type { Conveyor, MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

const belt = (c: Partial<Conveyor> = {}): MapObject => {
  const conveyor: Conveyor = { points: [{ x: 300, y: 300 }, { x: 1300, y: 300 }], loop: false, width: 80, speed: 200, ...c };
  return { role: 'conveyor', shape: { type: 'poly', points: conveyorOutline(conveyor) }, conveyor };
};
const crate = (x: number, y: number, size = 40): MapObject => ({ role: 'luggage', shape: { type: 'rect', x: x - size / 2, y: y - size / 2, w: size, h: size } });
const wall = (x: number, y: number, w: number, h: number): MapObject => ({ role: 'wall', shape: { type: 'rect', x, y, w, h } });

function map(objects: MapObject[], patch: Partial<MapData> = {}): MapData {
  return validateMap(JSON.parse(JSON.stringify({ ...createEmptyMap(), objects, ...patch })));
}

/** Run with the mouse held still at (x, y) from START for `ms` */
function hold(m: MapData, x: number, y: number, ms: number): Simulation {
  const sim = new Simulation(m);
  sim.start(m.start.x + 10, m.start.y + 10);
  sim.feed(1, x, y);
  for (let t = 2; t <= ms && sim.status === 'playing'; t++) sim.feed(t, x, y);
  return sim;
}

const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
/** Where crate `i` has been carried (offset from where it was placed) */
const crateOffset = (sim: Simulation, i: number) => transformAt(sim.objects[i], sim.time, tf);

describe('conveyor belt (#69) shape', () => {
  it('outlines an open belt around its centerline, width wide', () => {
    const ring = new Float64Array(conveyorOutline({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], loop: false, width: 20, speed: 1 }).flatMap((p) => [p.x, p.y]));
    expect(pointInPoly(50, 0, ring)).toBe(true);
    expect(pointInPoly(50, 9, ring)).toBe(true);
    expect(pointInPoly(50, 11, ring)).toBe(false);
    expect(pointInPoly(100, 50, ring)).toBe(true); // after the corner
    expect(pointInPoly(108, -8, ring)).toBe(true); // the mitered corner
  });

  it('makes a loop a ring: its middle is not belt', () => {
    const ring = new Float64Array(conveyorOutline({ points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], loop: true, width: 40, speed: 1 }).flatMap((p) => [p.x, p.y]));
    expect(pointInPoly(100, 0, ring)).toBe(true);
    expect(pointInPoly(0, 100, ring)).toBe(true);
    expect(pointInPoly(100, 100, ring)).toBe(false);
  });

  it('measures distance along the belt and wraps a loop', () => {
    const p = new BeltPath({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], loop: true, width: 20, speed: 1000 });
    expect(p.length).toBe(400);
    expect(p.project(50, 3)).toBeCloseTo(50);
    const out = { x: 0, y: 0 };
    expect(p.pointAt(450, out)).toEqual({ x: 50, y: 0 });
    expect(p.pointAt(150, out)).toEqual({ x: 100, y: 50 });
  });

  it('tells overlapping rings from touching ones', () => {
    const sq = (x: number) => new Float64Array([x, 0, x + 10, 0, x + 10, 10, x, 10]);
    expect(polysOverlap(sq(0), sq(5))).toBe(true);
    expect(polysOverlap(sq(0), sq(10))).toBe(false);
    expect(polysOverlap(sq(0), new Float64Array([2, 2, 4, 2, 4, 4]))).toBe(true); // one inside the other
  });

  it('regenerates the shape from the centerline when a map is loaded', () => {
    const m = map([{ ...belt(), shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10 } }]);
    const s = m.objects[0].shape;
    expect(s.type).toBe('poly');
  });
});

describe('conveyor belt (#69) in play', () => {
  it('carries the cursor along it while the mouse stays still', () => {
    const sim = hold(map([belt()]), 500, 300, 1000);
    expect(sim.status).toBe('playing');
    expect(sim.x).toBeCloseTo(700, 0); // 200 px/s for 1 s
    expect(sim.y).toBeCloseTo(300, 3);
  });

  it('runs the other way when reversed', () => {
    const sim = hold(map([belt({ reverse: true })]), 900, 300, 500);
    expect(sim.x).toBeCloseTo(800, 0);
  });

  it('is safe floor on a map with paths, without making the rest of a wall-only map deadly', () => {
    // A map with paths: the belt joins START's area
    const path: MapObject = { role: 'path', shape: { type: 'rect', x: 60, y: 260, w: 260, h: 80 } };
    const onPaths = map([path, belt({ speed: 1 })], { start: { x: 60, y: 260, w: 80, h: 80 } });
    expect(hold(onPaths, 600, 300, 200).status).toBe('playing');
    // No other paths: open floor around the belt stays safe
    expect(hold(map([belt({ speed: 1 })]), 600, 700, 200).status).toBe('playing');
  });
});

describe('luggage (#70)', () => {
  it('rides the belt and kills the cursor like a wall', () => {
    const m = map([belt(), crate(400, 300)]);
    const sim = hold(m, 200, 800, 500);
    expect(sim.status).toBe('playing');
    const off = crateOffset(sim, 1);
    expect(off.dx).toBeGreaterThan(90);
    expect(Math.abs(off.dy)).toBeLessThan(1);
    // Touching it is death
    const hit = new Simulation(m);
    hit.start(m.start.x + 10, m.start.y + 10);
    hit.feed(50, 400, 300);
    expect(hit.endReason).toBe('mover');
  });

  it('stops at the end of a one-way belt', () => {
    const sim = hold(map([belt({ speed: 1000 }), crate(1200, 300)]), 200, 800, 1000);
    const off = crateOffset(sim, 1);
    expect(1200 + off.dx).toBeCloseTo(1280, 0); // its far edge at the belt's end (x = 1300)
  });

  it('is stopped by a wall across the belt and by the crate stopped in front of it', () => {
    const sim = hold(map([belt({ speed: 1000 }), wall(800, 200, 20, 200), crate(500, 300), crate(400, 300)]), 200, 800, 1000);
    const front = 500 + crateOffset(sim, 2).dx;
    const back = 400 + crateOffset(sim, 3).dx;
    expect(front).toBeCloseTo(780, 0); // against the wall at x = 800
    expect(back).toBeCloseTo(740, 0); // against the first crate
  });

  it('stays put when it is wider than the belt', () => {
    const sim = hold(map([belt({ width: 40 }), crate(500, 300, 60)]), 200, 800, 500);
    expect(crateOffset(sim, 1).dx).toBe(0);
  });

  it('follows a loop round its corners', () => {
    const loop = belt({ points: [{ x: 400, y: 200 }, { x: 800, y: 200 }, { x: 800, y: 600 }, { x: 400, y: 600 }], loop: true, speed: 400 });
    const sim = hold(map([loop, crate(500, 200)]), 200, 900, 1500);
    const o = crateOffset(sim, 1);
    // 600 px along: past the first corner, down the right side
    expect(500 + o.dx).toBeCloseTo(800, -1);
    expect(200 + o.dy).toBeGreaterThan(300);
  });

  it('starts each run where it was placed', () => {
    const m = map([belt(), crate(400, 300)]);
    const first = hold(m, 200, 800, 300);
    expect(crateOffset(first, 1).dx).toBeGreaterThan(0);
    const again = new Simulation(m, first.objects);
    expect(transformAt(again.objects[1], 0, tf).dx).toBe(0);
  });
});

describe('conveyor belt (#69) corners', () => {
  // Right along y = 300 to x = 800, then down to y = 800
  const corner = () => belt({ points: [{ x: 300, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 800 }], speed: 400 });

  it('turns the cursor at a corner and keeps it on the belt', () => {
    const sim = hold(map([corner()]), 700, 300, 1000);
    expect(sim.status).toBe('playing');
    // 400 px along: 100 px to the corner, then 300 px down
    expect(sim.x).toBeCloseTo(800, -1);
    expect(sim.y).toBeGreaterThan(500);
  });

  it('turns the cursor from the outer part of a corner too', () => {
    // Past the corner on the outside (beyond the vertex, inside the mitered corner)
    const sim = hold(map([corner()]), 820, 290, 500);
    expect(sim.status).toBe('playing');
    expect(sim.y).toBeGreaterThan(400);
    expect(sim.x).toBeLessThan(840);
  });

  it('turns a crate at a corner', () => {
    const sim = hold(map([corner(), crate(600, 300)]), 200, 900, 1500);
    const o = crateOffset(sim, 1);
    expect(600 + o.dx).toBeCloseTo(800, -1);
    expect(300 + o.dy).toBeGreaterThan(500);
  });
});

describe('luggage (#70) at a corner beside walls', () => {
  it('turns a crate as wide as the belt around the wall inside a loop', () => {
    // A loop around a wall block that fills its middle, edge to edge with the belt
    const loop = belt({ points: [{ x: 400, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 700 }, { x: 400, y: 700 }], loop: true, width: 60, speed: 400 });
    const inner = wall(430, 330, 440, 340);
    const sim = hold(map([loop, inner, crate(800, 300, 60)]), 200, 900, 1000);
    const o = crateOffset(sim, 2);
    // 400 px along: 100 px to the corner, then 300 px down the right side
    expect(800 + o.dx).toBeCloseTo(900, 0);
    expect(300 + o.dy).toBeCloseTo(600, -1);
  });
});
