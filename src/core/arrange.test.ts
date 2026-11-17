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

describe('level settings and packs', () => {
  it('keeps level fields through validation and computes stars', async () => {
    const { starsFor, levelLabel } = await import('./level');
    const { validatePack } = await import('./validate');
    const map = validateMap({
      ...createEmptyMap(), title: ' Spiral ', level: 3, cursorColor: '#FF00AA', stars: { three: 5000, two: 8000, one: 12000 },
    });
    expect(map.title).toBe('Spiral');
    expect('cursorColor' in map).toBe(false); // retired field: dropped from old files
    expect(levelLabel(map)).toBe('Level 3 · Spiral');
    expect([4000, 5000, 7000, 12000, 12001].map((t) => starsFor(map, t))).toEqual([3, 3, 2, 1, 0]);
    expect(starsFor(createEmptyMap(), 1)).toBeNull();
    expect(() => validateMap({ ...createEmptyMap(), level: 1.5 })).toThrow();
    const pack = validatePack({ pack: 1, name: 'P', author: 'me', levels: [map, createEmptyMap()] });
    expect(pack.levels.length).toBe(2);
    expect(() => validatePack({ pack: 1, levels: [] })).toThrow();
    expect(() => validatePack({ pack: 1, levels: [{ v: 2 }] })).toThrow(/Level 1/);
  });
});

describe('phase 2 objects', () => {
  it('sectors flatten, rotate and pivot on their apex', async () => {
    const { defaultRotation } = await import('./validate');
    const s: Shape = { type: 'sector', cx: 100, cy: 100, r: 50, start: 0, sweep: 90 };
    const b = shapeBounds(s);
    expect([b.x, b.y, Math.round(b.w), Math.round(b.h)]).toEqual([100, 100, 50, 50]);
    expect(inside(s, 120, 120)).toBe(true);
    expect(inside(s, 80, 120)).toBe(false);
    const [o] = turnObjects([{ role: 'wall', shape: s }], 'cw');
    expect(o.shape.type === 'sector' && o.shape.start).toBe(90);
    expect(defaultRotation({ role: 'wall', shape: s }).pivot).toEqual({ x: 100, y: 100 });
    expect(validateMap({ ...createEmptyMap(), objects: [{ role: 'path', shape: s }] }).objects[0].shape).toEqual(s);
  });

  it('GOAL stays locked until every coin is collected', async () => {
    const { Simulation } = await import('./simulation');
    const map = {
      ...createEmptyMap(),
      start: { x: 0, y: 0, w: 20, h: 20 },
      goal: { x: 700, y: 0, w: 50, h: 50 },
      objects: [{ role: 'coin' as const, shape: { type: 'ellipse' as const, cx: 300, cy: 100, rx: 10, ry: 10 } }],
    };
    const miss = new Simulation(map);
    miss.start(10, 10);
    miss.feed(10, 720, 10);
    expect(miss.status).toBe('playing');
    expect(miss.coinsLeft).toBe(1);

    const hit = new Simulation(map);
    hit.start(10, 10);
    hit.feed(5, 300, 100);
    expect(hit.coinsLeft).toBe(0);
    expect(hit.collected[0]).toBe(1);
    hit.feed(10, 720, 10);
    expect(hit.status).toBe('cleared');
  });

  it('coins and darkness areas are not walls or floor', async () => {
    const { Simulation } = await import('./simulation');
    const map = {
      ...createEmptyMap(),
      start: { x: 0, y: 0, w: 20, h: 20 },
      goal: { x: 700, y: 0, w: 50, h: 50 },
      darkness: { light: 40 },
      objects: [{ role: 'dark' as const, shape: rect(100, 0, 100, 100) }],
    };
    const sim = new Simulation(validateMap(map));
    sim.start(10, 10);
    sim.feed(10, 720, 10);
    expect(sim.status).toBe('cleared');
  });
});

describe('phase 3: switches and links', () => {
  const base = () => ({
    ...createEmptyMap(),
    start: { x: 0, y: 280, w: 20, h: 20 },
    goal: { x: 900, y: 280, w: 50, h: 50 },
  });
  const sw = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    ({ role: 'trigger', shape: rect(x, y, 30, 30), trigger: { kind: 'switch', color: 0, ...extra } });
  const barrier = (link?: Record<string, unknown>) => ({ role: 'wall', shape: rect(400, 0, 20, 540), ...(link ? { link } : {}) });

  it('a switch removes a linked wall', async () => {
    const { Simulation } = await import('./simulation');
    const map = validateMap({ ...base(), objects: [barrier({ color: 0, action: 'remove' }), sw(200, 100)] });
    const blocked = new Simulation(map);
    blocked.start(10, 290);
    blocked.feed(20, 920, 300);
    expect(blocked.status).toBe('dead');

    const opened = new Simulation(map);
    opened.start(10, 290);
    opened.feed(10, 215, 115); // onto the switch
    expect(opened.channels[0]).toBe(1);
    expect(opened.hidden[0]).toBe(1);
    opened.feed(30, 920, 300);
    expect(opened.status).toBe('cleared');
  });

  it('linking to a color with no switch is an error', async () => {
    const { mapErrors } = await import('./validate');
    expect(mapErrors(validateMap({ ...base(), objects: [barrier({ color: 3, action: 'remove' })] }))[0]).toMatch(/Lemon/);
    expect(mapErrors(validateMap({ ...base(), objects: [barrier({ color: 0, action: 'remove' }), sw(200, 100)] }))).toEqual([]);
  });

  it('"start" objects only move while their color is ON, and a timer turns it OFF again', async () => {
    const { Simulation } = await import('./simulation');
    const mover = {
      role: 'wall', shape: rect(600, 0, 10, 10), link: { color: 0, action: 'start' },
      motion: { type: 'linear', points: [{ x: 900, y: 5 }], speed: 100, repeat: 'once', easing: 'none', delay: 0, clockwise: true },
    };
    const map = validateMap({ ...base(), objects: [mover, sw(200, 100, { kind: 'timer', duration: 100 })] });
    const sim = new Simulation(map);
    sim.start(10, 290);
    sim.feed(50, 12, 290);
    expect(sim.clock[0]).toBe(0);
    sim.feed(60, 215, 115); // timer switch: ON for 100 ms
    expect(sim.channels[0]).toBe(1);
    sim.feed(120, 215, 116);
    expect(sim.clock[0]).toBeGreaterThan(50);
    sim.feed(300, 215, 117);
    expect(sim.channels[0]).toBe(0);
    const frozen = sim.clock[0];
    sim.feed(400, 215, 118);
    expect(sim.clock[0]).toBe(frozen);
  });

  it('hold switches need the cursor to stay on them', async () => {
    const { Simulation } = await import('./simulation');
    const map = validateMap({ ...base(), objects: [sw(200, 100, { kind: 'hold', duration: 200 })] });
    const sim = new Simulation(map);
    sim.start(10, 290);
    sim.feed(10, 215, 115);
    sim.feed(100, 215, 116);
    expect(sim.channels[0]).toBe(0);
    expect(sim.progress[1 - 1]).toBeGreaterThan(0.3);
    sim.feed(260, 215, 117);
    expect(sim.channels[0]).toBe(1);
  });

  it('doors open on a switch; automatic doors cycle', async () => {
    const { Simulation } = await import('./simulation');
    const { autoDoorOpen } = await import('./switches');
    expect([0, 150, 250, 350, 450].map((t) => autoDoorOpen({ mode: 'auto', color: 0, moveMs: 100, waitMs: 100 }, t))).toEqual([0, 0.5, 1, 0.5, 0]);
    const door = { role: 'door', shape: rect(400, 0, 20, 540), door: { mode: 'switch', color: 0, moveMs: 100, waitMs: 0 } };
    const map = validateMap({ ...base(), objects: [door, sw(200, 100)] });
    const sim = new Simulation(map);
    sim.start(10, 290);
    sim.feed(10, 215, 115);
    sim.feed(200, 216, 115); // wait for the door to open fully
    expect(sim.doorOpen[0]).toBe(1);
    sim.feed(260, 920, 300);
    expect(sim.status).toBe('cleared');
    const shut = new Simulation(map);
    shut.start(10, 290);
    shut.feed(20, 920, 300);
    expect(shut.status).toBe('dead');
    expect(shut.endReason).toBe('mover');
  });

  it('click switches react to clicks, and replays reproduce them', async () => {
    const { Simulation, runReplay } = await import('./simulation');
    const map = validateMap({ ...base(), objects: [barrier({ color: 0, action: 'remove' }), sw(200, 100, { click: true })] });
    const sim = new Simulation(map);
    sim.start(10, 290);
    sim.feed(10, 215, 115);
    expect(sim.channels[0]).toBe(0); // touching isn't enough
    sim.click(12, 215, 115);
    expect(sim.channels[0]).toBe(1);
    sim.feed(40, 920, 300);
    expect(sim.status).toBe('cleared');
    const again = runReplay(map, sim.getReplay());
    expect(again.status).toBe('cleared');
    expect(again.endTime).toBe(sim.endTime);
  });
});

describe('phase 4: spikes, boulders, lasers, portals', () => {
  const base = () => ({ ...createEmptyMap(), start: { x: 0, y: 280, w: 20, h: 20 }, goal: { x: 900, y: 280, w: 50, h: 50 } });

  it('spikes thrust fast and return slowly', async () => {
    const { SpikeMover } = await import('./hazards');
    const s = new SpikeMover({ angle: 0, reach: 100, thrustMs: 100, returnMs: 400, waitMs: 500, delay: 0 });
    expect(s.extensionAt(250)).toBe(0);
    expect(s.extensionAt(550)).toBeGreaterThan(0.8); // halfway through the thrust: mostly out
    expect(s.extensionAt(600)).toBeCloseTo(1);
    expect(s.extensionAt(800)).toBeCloseTo(0.5);
    expect(s.extensionAt(1000)).toBeCloseTo(0);
    const out = { x: 0, y: 0 };
    s.offsetAt(600, out);
    expect(out.x).toBeCloseTo(100);
  });

  it('boulders spin by the distance they roll', async () => {
    const { compileObject, transformAt } = await import('./object');
    const { boulderShape } = await import('./hazards');
    const o = compileObject({
      role: 'wall', boulder: true, shape: { type: 'poly', points: boulderShape(100, 100, 20) },
      motion: { type: 'linear', points: [{ x: 300, y: 100 }], speed: 100, repeat: 'once', easing: 'none', delay: 0, clockwise: true },
    });
    const tf = transformAt(o, 1000, { dx: 0, dy: 0, cos: 1, sin: 0 });
    expect(tf.dx).toBeCloseTo(100);
    const r = (o.maxX - o.minX) / 2;
    expect(Math.atan2(tf.sin, tf.cos)).toBeCloseTo(Math.atan2(Math.sin(100 / r), Math.cos(100 / r)));
  });

  it('laser beams kill, reflect off mirrors and stop at walls', async () => {
    const { Simulation } = await import('./simulation');
    const laser = { role: 'laser', shape: rect(490, 10, 20, 20), laser: { color: 0, angle: 90, on: true } };
    const map = validateMap({ ...base(), objects: [laser] });
    const sim = new Simulation(map);
    const end = sim.beams[0].pts.slice(-2);
    expect(end[0]).toBeCloseTo(500);
    expect(end[1]).toBeCloseTo(540); // down to the map edge
    sim.start(10, 290);
    sim.feed(20, 920, 300);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('laser');

    // A wall in the way stops the beam above the cursor's line
    const blocked = validateMap({ ...base(), objects: [laser, { role: 'wall', shape: rect(450, 100, 100, 20) }] });
    const s2 = new Simulation(blocked);
    expect(s2.beams[0].pts[3]).toBeCloseTo(100);

    // A 45° mirror sends the beam sideways
    const mirror = { role: 'mirror', shape: { type: 'poly', points: [{ x: 470, y: 230 }, { x: 530, y: 290 }, { x: 532, y: 288 }, { x: 472, y: 228 }] } };
    const s3 = new Simulation(validateMap({ ...base(), objects: [laser, mirror] }));
    const p = s3.beams[0].pts;
    expect(p.length).toBe(6); // emitter → mirror → map edge
    expect(p[4]).toBeCloseTo(960); // down, then off to the right
    expect(p[5]).toBeCloseTo(p[3]);
  });

  it('a switch can turn a laser off', async () => {
    const { Simulation } = await import('./simulation');
    const laser = { role: 'laser', shape: rect(490, 10, 20, 20), laser: { color: 0, angle: 90, on: true, switchColor: 2 } };
    const sw = { role: 'trigger', shape: rect(200, 100, 30, 30), trigger: { kind: 'switch', color: 2 } };
    const sim = new Simulation(validateMap({ ...base(), objects: [laser, sw] }));
    sim.start(10, 290);
    sim.feed(10, 215, 115);
    expect(sim.channels[2]).toBe(1);
    sim.feed(40, 920, 300);
    expect(sim.status).toBe('cleared');
  });

  it('portals pull the cursor in and move it to the next portal of the same color', async () => {
    const { Simulation, PORTAL_PULL_MS } = await import('./simulation');
    const portal = (x: number, y: number, extra = {}) => ({ role: 'portal', shape: rect(x, y, 40, 40), portal: { color: 4, order: 0, mode: 'both', ...extra } });
    const map = validateMap({ ...base(), objects: [portal(200, 280), portal(700, 100, { order: 1 })] });
    const sim = new Simulation(map);
    sim.start(10, 290);
    sim.feed(10, 205, 300); // touch the first portal
    expect(sim.pull).not.toBeNull();
    sim.feed(10 + PORTAL_PULL_MS + 5, 205, 300);
    expect(sim.teleports).toBe(1);
    expect([Math.round(sim.x), Math.round(sim.y)]).toEqual([720, 120]);
    expect([Math.round(sim.offX), Math.round(sim.offY)]).toEqual([515, -180]);
    // The cursor now follows the mouse from there; it doesn't bounce straight back
    sim.feed(200, 206, 300);
    expect(sim.teleports).toBe(1);
    expect(Math.round(sim.x)).toBe(721);

    const { mapErrors } = await import('./validate');
    expect(mapErrors(validateMap({ ...base(), objects: [portal(200, 280)] }))[0]).toMatch(/no other/);
  });
});
