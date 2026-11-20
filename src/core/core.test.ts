import { describe, expect, it } from 'vitest';
import { pointInPoly, segmentRectEntry } from './geometry';
import { CompiledMotion, CompiledRotation, ease } from './motion';
import { flattenShape } from './shape';
import { runReplay, Simulation, formatTime } from './simulation';
import { createEmptyMap, mapErrors, mapWarnings, validateMap } from './validate';
import { decodeMap, encodeMap } from './share';
import { BUILTIN_LEVELS } from './levels';
import floatingBridge from './fixtures/floating-bridge.json';
import { THEME_PRESETS } from './theme';
import type { MapData, MapObject, Motion, Rect, Rotation } from './types';

function baseMap(objects: MapObject[] = [], patch: Partial<MapData> = {}): MapData {
  return {
    ...createEmptyMap(),
    start: { x: 0, y: 0, w: 20, h: 20 },
    goal: { x: 700, y: 0, w: 50, h: 50 },
    objects,
    ...patch,
  };
}
const wall = (r: Rect, extra: Partial<MapObject> = {}): MapObject => ({ role: 'wall', shape: { type: 'rect', ...r }, ...extra });
const path = (r: Rect, extra: Partial<MapObject> = {}): MapObject => ({ role: 'path', shape: { type: 'rect', ...r }, ...extra });
const motion = (m: Partial<Motion>): Motion => ({
  type: 'linear', points: [], speed: 100, repeat: 'pingpong', easing: 'none', delay: 0, clockwise: true, ...m,
});
const rotation = (r: Partial<Rotation>): Rotation => ({
  pivot: { x: 0, y: 0 }, speed: 90, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0, ...r,
});

describe('geometry', () => {
  it('segmentRectEntry returns the fraction where the segment first touches the rect', () => {
    expect(segmentRectEntry(0, 5, 100, 5, 40, 0, 10, 10)).toBeCloseTo(0.4);
    expect(segmentRectEntry(0, 50, 100, 50, 40, 0, 10, 10)).toBe(-1);
    expect(segmentRectEntry(45, 5, 100, 5, 40, 0, 10, 10)).toBe(0);
  });
  it('flattened circles stay within a fraction of a pixel of the true circle', () => {
    const { poly } = flattenShape({ type: 'ellipse', cx: 0, cy: 0, rx: 200, ry: 200 });
    expect(pointInPoly(199.5, 0, poly)).toBe(true);
    expect(pointInPoly(0, 199.5, poly)).toBe(true);
    expect(pointInPoly(141.2, 141.2, poly)).toBe(true); // r ≈ 199.7
    expect(pointInPoly(141.6, 141.6, poly)).toBe(false); // r ≈ 200.3
  });
  it('freeform smooth vertices bend the outline', () => {
    const corner = flattenShape({ type: 'poly', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
    const smooth = flattenShape({ type: 'poly', points: [{ x: 0, y: 0, smooth: true }, { x: 100, y: 0, smooth: true }, { x: 100, y: 100, smooth: true }, { x: 0, y: 100, smooth: true }] });
    expect(corner.poly.length).toBe(8);
    expect(smooth.poly.length).toBeGreaterThan(40);
    expect(smooth.maxX).toBeGreaterThan(100); // the curve bulges past the corner points
  });
});

describe('motion', () => {
  const p = { x: 0, y: 0 };
  it('curves only the selected leg and retraces it on pingpong', () => {
    const m = new CompiledMotion(motion({
      points: [{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }],
      segmentTypes: ['linear', 'curve', 'linear'],
    }), { x: 0, y: 0 });
    expect(Array.from(m.legs[0].pts)).toEqual([0, 0, 100, 0]);
    expect(Array.from(m.legs[2].pts)).toEqual([100, 100, 200, 100]);
    expect(Array.from(m.legs[1].pts).filter((_, i) => i % 2 === 0).some(x => Math.abs(x - 100) > 1)).toBe(true);
    expect(m.offsetAt(m.legs[0].dur + m.legs[1].dur, { x: 0, y: 0 })).toMatchObject({ x: expect.closeTo(100), y: expect.closeTo(100) });
    const t = m.legs[0].dur + m.legs[1].dur / 3;
    const forward = m.offsetAt(t, { x: 0, y: 0 });
    const backward = m.offsetAt(2 * m.pass - t, { x: 0, y: 0 });
    expect(backward.x).toBeCloseTo(forward.x);
    expect(backward.y).toBeCloseTo(forward.y);
  });
  it('overrides curve defaults and independently curves the loop return', () => {
    const m = new CompiledMotion(motion({ type: 'curve', repeat: 'loop',
      points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], segmentTypes: ['linear', 'linear', 'curve'],
    }), { x: 0, y: 0 });
    expect(m.legs.map(l => l.pts.length > 4)).toEqual([false, false, true]);
    const fallback = new CompiledMotion(motion({ type: 'curve',
      points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], segmentTypes: ['linear'],
    }), { x: 0, y: 0 });
    expect(fallback.legs.map(l => l.pts.length > 4)).toEqual([false, true]);
  });
  it('preserves segment types through validation and sharing, rejecting invalid types', async () => {
    const map = baseMap([wall({ x: 20, y: 20, w: 20, h: 20 }, { motion: motion({
      points: [{ x: 100, y: 50 }, { x: 100, y: 150 }], segmentTypes: ['linear', 'curve', 'linear'],
    }) })]);
    expect(validateMap(map).objects[0].motion?.segmentTypes).toEqual(['linear', 'curve', 'linear']);
    expect((await decodeMap(await encodeMap(map))).objects[0].motion?.segmentTypes).toEqual(['linear', 'curve', 'linear']);
    const bad = JSON.parse(JSON.stringify(map));
    bad.objects[0].motion.segmentTypes = ['circle'];
    expect(() => validateMap(bad)).toThrow();
  });
  it('linear pingpong goes to the end and comes back', () => {
    const m = new CompiledMotion(motion({ points: [{ x: 100, y: 0 }] }), { x: 0, y: 0 });
    expect(m.offsetAt(500, p).x).toBeCloseTo(50);
    expect(m.offsetAt(1000, p).x).toBeCloseTo(100);
    expect(m.offsetAt(1500, p).x).toBeCloseTo(50);
    expect(m.offsetAt(2000, p).x).toBeCloseTo(0);
  });
  it('once stops at the last marker; loop returns to the anchor', () => {
    const once = new CompiledMotion(motion({ points: [{ x: 100, y: 0 }], repeat: 'once' }), { x: 0, y: 0 });
    expect(once.offsetAt(5000, p).x).toBeCloseTo(100);
    const loop = new CompiledMotion(motion({ points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], repeat: 'loop' }), { x: 0, y: 0 });
    // 100 + 100 + √2·100 px at 100 px/s
    expect(loop.pass).toBeCloseTo(2000 + Math.SQRT2 * 1000);
    expect(loop.offsetAt(1500, p)).toMatchObject({ x: expect.closeTo(100), y: expect.closeTo(50) });
  });
  it('delay holds the object; negative delay starts mid-motion', () => {
    const m = new CompiledMotion(motion({ points: [{ x: 100, y: 0 }], delay: 300 }), { x: 0, y: 0 });
    expect(m.offsetAt(200, p).x).toBe(0);
    expect(m.offsetAt(800, p).x).toBeCloseTo(50);
    const early = new CompiledMotion(motion({ points: [{ x: 100, y: 0 }], delay: -500 }), { x: 0, y: 0 });
    expect(early.offsetAt(1, p).x).toBeCloseTo(50.1);
  });
  it('easing slows the start and end of each leg', () => {
    expect(ease('inOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('inOut', 0.1)).toBeLessThan(0.1);
    expect(ease('in', 0.5)).toBeCloseTo(0.25);
    expect(ease('out', 0.5)).toBeCloseTo(0.75);
    const m = new CompiledMotion(motion({ points: [{ x: 100, y: 0 }], easing: 'inOut' }), { x: 0, y: 0 });
    expect(m.offsetAt(100, p).x).toBeLessThan(10);
    expect(m.offsetAt(500, p).x).toBeCloseTo(50);
  });
  it('circle orbits the center at the anchor distance', () => {
    const m = new CompiledMotion(motion({ type: 'circle', points: [{ x: 0, y: 0 }], speed: 100, repeat: 'loop' }), { x: 100, y: 0 });
    const lap = (2 * Math.PI * 100 * 1000) / 100;
    expect(Math.abs(m.pass - lap) / lap).toBeLessThan(0.001);
    m.offsetAt(m.pass / 4, p); // clockwise on screen (y down): (100,0) → (0,100)
    expect(p.x + 100).toBeCloseTo(0, 0);
    expect(p.y).toBeCloseTo(100, 0);
  });
  it('curve passes through every marker', () => {
    const m = new CompiledMotion(motion({ type: 'curve', points: [{ x: 100, y: 100 }, { x: 200, y: 0 }], repeat: 'once' }), { x: 0, y: 0 });
    expect(m.offsetAt(m.legs[0].dur, p)).toMatchObject({ x: expect.closeTo(100), y: expect.closeTo(100) });
  });
  it('rotation: loop, pingpong and direction', () => {
    expect(new CompiledRotation(rotation({ speed: 90 })).angleAt(1000)).toBeCloseTo(Math.PI / 2);
    expect(new CompiledRotation(rotation({ speed: 90, clockwise: false })).angleAt(1000)).toBeCloseTo(-Math.PI / 2);
    const swing = new CompiledRotation(rotation({ speed: 90, angle: 90, repeat: 'pingpong' }));
    expect(swing.angleAt(1000)).toBeCloseTo(Math.PI / 2);
    expect(swing.angleAt(1500)).toBeCloseTo(Math.PI / 4);
  });
});

describe('Simulation', () => {
  it('does not start when clicking outside START', () => {
    const sim = new Simulation(baseMap());
    expect(sim.start(100, 100)).toBe(false);
    expect(sim.status).toBe('ready');
  });

  it('cannot tunnel through a thin wall even with a long jump', () => {
    const sim = new Simulation(baseMap([wall({ x: 100, y: 0, w: 2, h: 500 })]));
    sim.start(10, 10);
    sim.feed(10, 600, 10); // 590px in 10ms
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('wall');
    expect(sim.x).toBeCloseTo(100);
    expect(sim.endTime).toBeCloseTo((90 / 590) * 10, 9);
  });

  it('advances one tick per 1ms boundary', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(3.4, 12, 10);
    expect(sim.ticks).toBe(3);
    sim.feed(7.9, 14, 10);
    expect(sim.ticks).toBe(7);
    expect(sim.status).toBe('playing');
  });

  it('clears at the exact time GOAL is reached', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(1000, 710, 10);
    expect(sim.status).toBe('cleared');
    expect(sim.endTime).toBeCloseTo((690 / 700) * 1000, 9);
    // Preserve exact collision timing; discard fractional ms for display and records.
    expect(formatTime(sim.endTime)).toBe('0.985');
  });

  it('fails when leaving the map', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(5, 10, -30);
    expect(sim.endReason).toBe('bounds');
    expect(sim.y).toBeCloseTo(0);
  });

  it('circle walls collide on their curved edge, not their bounding box', () => {
    const map = baseMap([{ role: 'wall', shape: { type: 'ellipse', cx: 200, cy: 200, rx: 50, ry: 50 } }]);
    const miss = new Simulation(map);
    miss.start(10, 10);
    miss.feed(5, 160, 160); // inside the bbox corner, outside the circle (distance ≈ 56.6)
    expect(miss.status).toBe('playing');
    const hit = new Simulation(map);
    hit.start(10, 10);
    hit.feed(5, 200, 200);
    expect(hit.endReason).toBe('wall');
    expect(Math.hypot(hit.x - 200, hit.y - 200)).toBeCloseTo(50, 0);
  });

  describe('paths', () => {
    it('everything is safe when the map has no paths', () => {
      const sim = new Simulation(baseMap());
      sim.start(10, 10);
      sim.feed(5, 300, 300);
      expect(sim.status).toBe('playing');
    });
    it('leaving the paths is deadly, START and GOAL count as floor', () => {
      const sim = new Simulation(baseMap([path({ x: 20, y: 0, w: 200, h: 20 })]));
      sim.start(10, 10); // on START, outside the path
      sim.feed(5, 100, 10); // onto the path
      expect(sim.status).toBe('playing');
      sim.feed(10, 100, 60); // off the bottom edge (y = 20)
      expect(sim.endReason).toBe('void');
      expect(sim.y).toBeCloseTo(20);
    });
    it('overlapping paths form one walkable area', () => {
      const sim = new Simulation(baseMap([path({ x: 20, y: 0, w: 200, h: 20 }), path({ x: 200, y: 0, w: 20, h: 300 })]));
      sim.start(10, 10);
      sim.feed(5, 210, 10);
      sim.feed(10, 210, 290);
      expect(sim.status).toBe('playing');
    });
    it('walls on top of a path are still deadly', () => {
      const sim = new Simulation(baseMap([path({ x: 20, y: 0, w: 200, h: 20 }), wall({ x: 100, y: 0, w: 5, h: 20 })]));
      sim.start(10, 10);
      sim.feed(5, 150, 10);
      expect(sim.endReason).toBe('wall');
    });
    it('a wall-piercing path makes static walls harmless inside it, but not moving walls', () => {
      const big = wall({ x: 100, y: 0, w: 200, h: 300 });
      const tunnel = path({ x: 80, y: 0, w: 60, h: 20 }, { pierce: true });
      const ok = new Simulation(baseMap([path({ x: 20, y: 0, w: 80, h: 20 }), tunnel, big]));
      ok.start(10, 10);
      ok.feed(5, 130, 10); // into the wall, inside the tunnel
      expect(ok.status).toBe('playing');
      ok.feed(10, 160, 10); // past the tunnel's end, still in the wall
      expect(ok.endReason).toBe('wall');
      expect(ok.x).toBeCloseTo(140);

      const mover = wall({ x: 120, y: 0, w: 5, h: 20 }, { rotation: rotation({ pivot: { x: 122, y: 10 }, speed: 1, angle: 1 }) });
      const hit = new Simulation(baseMap([path({ x: 20, y: 0, w: 80, h: 20 }), tunnel, mover]));
      hit.start(10, 10);
      hit.feed(5, 130, 10);
      expect(hit.endReason).toBe('mover');
    });
    it('a moving wall-piercing path carves through static walls as it moves', () => {
      const map = baseMap([
        wall({ x: 100, y: 0, w: 200, h: 300 }),
        path({ x: 0, y: 0, w: 140, h: 20 }, { pierce: true, motion: motion({ points: [{ x: 70, y: 200 }], speed: 100, repeat: 'once' }) }),
      ]);
      const sim = new Simulation(map);
      sim.start(10, 10);
      sim.feed(1, 120, 10); // inside the wall, carried by the piercing path
      expect(sim.status).toBe('playing');
    });
    it('coins are pulled in from within COIN_MAGNET of their center', () => {
      const coin = (cx: number, cy: number): MapObject => ({ role: 'coin', shape: { type: 'ellipse', cx, cy, rx: 12, ry: 12 } });
      const sim = new Simulation(baseMap([coin(100, 40), coin(300, 50)]));
      sim.start(10, 10);
      sim.feed(5, 400, 10); // passes 30 from the first coin, 40 from the second
      expect(sim.coinsLeft).toBe(1);
      expect(sim.collected[0]).toBe(1);
      // Picked up where the cursor first came within 36 (x = 100 - sqrt(36² - 30²) ≈ 80.1)
      expect(sim.collectedAt[0]).toBeCloseTo(((100 - Math.sqrt(36 * 36 - 30 * 30) - 10) / 390) * 5, 6);
      expect(sim.collectedPos[0]).toBeCloseTo(100);
      expect(sim.collectedPos[1]).toBeCloseTo(40);
    });
    it('a moving platform leaves a cursor that stays still', () => {
      const map = baseMap(
        [path({ x: 15, y: 0, w: 40, h: 20 }, { motion: motion({ points: [{ x: 335, y: 10 }], speed: 100, repeat: 'once' }) })],
        { start: { x: 0, y: 0, w: 20, h: 20 } }, // START overlaps the platform's rest position
      );
      const sim = new Simulation(map);
      sim.start(5, 10);
      sim.feed(1, 30, 10); // step onto the platform (x 15..55)
      expect(sim.status).toBe('playing');
      sim.advanceTo(2000);
      // the platform's left edge (15 + 0.1t) passes x=30 at t = 150ms
      expect(sim.endReason).toBe('void');
      expect(sim.endTime).toBeCloseTo(150, 6);
    });
  });

  it('fails when a moving wall hits a stationary cursor', () => {
    const map = baseMap(
      [wall({ x: 95, y: 45, w: 10, h: 10 }, { motion: motion({ points: [{ x: 300, y: 50 }], speed: 100 }) })],
      { start: { x: 140, y: 40, w: 20, h: 20 } },
    );
    const sim = new Simulation(map);
    sim.start(150, 50);
    sim.advanceTo(2000);
    expect(sim.endReason).toBe('mover');
    // obstacle center x = 100 + 0.1t; its right edge (center+5) reaches 150 at t=450ms
    expect(sim.endTime).toBeCloseTo(450, 6);
  });

  it('catches the cursor and a wall passing through each other', () => {
    // no overlap at t=0 or t=1, but they cross in between
    const map = baseMap(
      [wall({ x: 298, y: 30, w: 4, h: 40 }, { motion: motion({ points: [{ x: 800, y: 50 }], speed: 5000 }) })],
      { start: { x: 380, y: 40, w: 20, h: 20 } },
    );
    const sim = new Simulation(map);
    sim.start(390, 50);
    sim.feed(1, 300, 50);
    expect(sim.endReason).toBe('mover');
  });

  it('a rotating bar sweeps into a stationary cursor at the right time', () => {
    // bar from (100,95) to (200,105) spinning clockwise around (100,100) at 90°/s
    const map = baseMap(
      [wall({ x: 100, y: 95, w: 100, h: 10 }, { rotation: rotation({ pivot: { x: 100, y: 100 }, speed: 90 }) })],
      { start: { x: 140, y: 140, w: 20, h: 20 } },
    );
    const sim = new Simulation(map);
    sim.start(150, 150); // 45° below the bar, distance ≈ 70.7 from the pivot
    sim.advanceTo(3000);
    expect(sim.endReason).toBe('mover');
    // the bar's leading edge is 5px ahead of its center line: hit when angle = 45° − asin(5 / 70.71)
    const expected = ((45 - (Math.asin(5 / Math.hypot(50, 50)) * 180) / Math.PI) / 90) * 1000;
    expect(sim.endTime).toBeCloseTo(expected, 0);
  });

  it('re-running a replay gives exactly the same result (deterministic)', () => {
    for (const map of BUILTIN_LEVELS) {
      const sim = new Simulation(map);
      const s = map.start;
      let x = s.x + s.w / 2;
      let y = s.y + s.h / 2;
      sim.start(x, y);
      let t = 0;
      let seed = 42;
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      while (sim.status === 'playing' && t < 20000) {
        t += 0.25 + rand() * 3;
        x += (rand() - 0.3) * 6;
        y += (rand() - 0.5) * 4;
        sim.feed(t, x, y);
      }
      const again = runReplay(map, JSON.parse(JSON.stringify(sim.getReplay())));
      expect(again.status).toBe(sim.status);
      expect(again.endReason).toBe(sim.endReason);
      expect(again.endTime).toBe(sim.endTime);
      expect(again.x).toBe(sim.x);
      expect(again.y).toBe(sim.y);
    }
  });

  it('Floating Bridge can be cleared by riding the moving platform', () => {
    const map = validateMap(floatingBridge);
    const sim = new Simulation(map);
    const platform = sim.objects[1].motion!;
    const off = { x: 0, y: 0 };
    const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
    // [t0, t1, from, to] straight moves; the platform ride follows the platform itself
    const legs: [number, number, [number, number], [number, number]][] = [
      [0, 300, [102, 270], [437, 270]], // along the wavy path onto the platform
      [2500, 2560, [631, 270], [696, 270]], // platform arrives (1s wait + 1.5s trip): step off onto the island
      [2560, 2860, [696, 270], [696, 335]], // around the spinning bar…
      [2860, 3360, [696, 335], [858, 335]],
      [3360, 3560, [858, 335], [858, 281]], // …and up into GOAL (bottom edge y=302)
    ];
    sim.start(102, 270);
    expect(sim.status).toBe('playing');
    for (let t = 1; t <= 3560 && sim.status === 'playing'; t++) {
      let x: number;
      let y: number;
      const leg = legs.find(([a, b]) => t > a && t <= b);
      if (leg) {
        const f = (t - leg[0]) / (leg[1] - leg[0]);
        x = lerp(leg[2][0], leg[3][0], f);
        y = lerp(leg[2][1], leg[3][1], f);
      } else {
        // riding: stay at the same spot on the platform
        platform.offsetAt(t, off);
        x = 437 + off.x;
        y = 270;
      }
      sim.feed(t, x, y);
    }
    expect(sim.endReason).toBe(null);
    expect(sim.status).toBe('cleared');
  });

  it('aborts are recorded in the replay', () => {
    const map = baseMap();
    const sim = new Simulation(map);
    sim.start(10, 10);
    sim.feed(5, 15, 10);
    sim.abort('left');
    expect(runReplay(map, sim.getReplay()).endReason).toBe('left');
  });
});

describe('switch revert', () => {
  // A timer switch ON for 200 ms; a wall linked to it moves only while ON
  const run = (revert: boolean) => {
    const map = validateMap(baseMap([
      { role: 'trigger', shape: { type: 'rect', x: 40, y: 0, w: 20, h: 20 }, trigger: { kind: 'timer', color: 1, duration: 200, ...(revert ? { revert: true } : {}) } },
      wall({ x: 400, y: 400, w: 20, h: 20 }, { motion: motion({ points: [{ x: 900, y: 410 }], repeat: 'once' }), link: { color: 1, action: 'start' } }),
    ]));
    const sim = new Simulation(map);
    sim.start(10, 10);
    const at: Record<number, number> = {};
    for (const [t, x] of [[10, 50], [20, 100], [150, 100], [210, 100], [300, 100], [600, 100]] as const) {
      sim.feed(t, x, 10);
      at[t] = sim.clock[1];
    }
    expect(sim.status).toBe('playing');
    return at;
  };
  it('stopped objects stay put without it', () => {
    const at = run(false);
    expect(at[150]).toBeGreaterThan(0);
    expect(at[600]).toBeCloseTo(at[300], 6);
    expect(at[600]).toBeGreaterThan(150);
  });
  it('objects that move only while ON rewind to their start once OFF', () => {
    const at = run(true);
    expect(at[210]).toBeGreaterThan(150);
    expect(at[300]).toBeLessThan(at[210]);
    expect(at[600]).toBe(0);
  });
  it('the option survives validation', () => {
    const t = { kind: 'switch', color: 2, revert: true } as const;
    expect(validateMap(baseMap([{ role: 'trigger', shape: { type: 'rect', x: 40, y: 0, w: 20, h: 20 }, trigger: t }])).objects[0].trigger?.revert).toBe(true);
  });
});

describe('validateMap', () => {
  it('all built-in levels are valid and playable', () => {
    // Warnings are advisory (a level may block GOAL on purpose), so only errors fail here
    for (const m of BUILTIN_LEVELS) {
      expect(validateMap(m), m.name).toEqual(m);
      expect(mapErrors(m), m.name).toEqual([]);
    }
  });
  it('walls that only touch START or GOAL are not warned about', () => {
    const m = validateMap({
      v: 2, name: 't', width: 1920, height: 1080,
      start: { x: 240, y: 540, w: 120, h: 120 }, goal: { x: 60, y: 540, w: 120, h: 120 },
      objects: [{ role: 'wall', shape: { type: 'rect', x: 180, y: 540, w: 60, h: 120 } }],
    });
    expect(mapWarnings(m)).toEqual([]);
    m.objects[0].shape = { type: 'rect', x: 170, y: 540, w: 80, h: 120 };
    expect(mapWarnings(m).length).toBe(2);
  });
  it('rejects invalid values', () => {
    expect(() => validateMap({ ...createEmptyMap(), width: 'abc' })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), v: 99 })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), objects: [wall({ x: 0, y: 0, w: -5, h: 10 })] })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), objects: [{ role: 'wall', shape: { type: 'poly', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }] })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), objects: [{ role: 'lava', shape: { type: 'rect', x: 0, y: 0, w: 5, h: 5 } }] })).toThrow();
  });
  it('fog and sand dust areas validate and never touch the cursor', () => {
    const shape = { type: 'poly' as const, free: true, points: [{ x: 100, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200, smooth: true }, { x: 100, y: 200 }] };
    const fog: MapObject = { role: 'fog', shape, fog: { kind: 'sand', density: 80 } };
    expect(validateMap({ ...createEmptyMap(), objects: [fog] }).objects[0]).toEqual(fog);
    expect(() => validateMap({ ...createEmptyMap(), objects: [{ ...fog, fog: { kind: 'sand', density: 120 } }] })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), objects: [{ ...fog, fog: { kind: 'smoke', density: 50 } }] })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), objects: [{ role: 'fog', shape }] })).toThrow();
    // Walking straight through the fog to GOAL clears the level
    const sim = new Simulation(baseMap([fog]));
    sim.start(10, 10);
    sim.feed(1000, 720, 20);
    expect(sim.status).toBe('cleared');
  });
  it('accepts every theme preset and keeps it through sharing', async () => {
    for (const p of THEME_PRESETS) {
      const map = { ...createEmptyMap(), ...(p.theme ? { theme: p.theme } : {}) };
      expect(validateMap(map)).toEqual(map);
      expect(await decodeMap(await encodeMap(map))).toEqual(map);
    }
  });
  it('rejects bad theme values', () => {
    const theme = THEME_PRESETS.find((p) => p.id === 'neon')!.theme!;
    const bad = (patch: object) => validateMap({ ...createEmptyMap(), theme: { ...theme, ...patch } });
    expect(() => bad({ wall: { fill: { type: 'solid', color: 'red' }, edge: '#ffffff' } })).toThrow();
    expect(() => bad({ wall: { fill: { type: 'solid', color: 'url(javascript:alert(1))' }, edge: '#ffffff' } })).toThrow();
    expect(() => bad({ path: { fill: { type: 'pattern', pattern: 'zigzag', color: '#000000', background: '#ffffff', size: 10 }, edge: '#ffffff' } })).toThrow();
    expect(() => bad({ path: { fill: { type: 'pattern', pattern: 'dots', color: '#000000', background: '#ffffff', size: 999 }, edge: '#ffffff' } })).toThrow();
  });
  it('strips unknown fields', () => {
    const m = validateMap({ ...createEmptyMap(), evil: '<script>' }) as unknown as Record<string, unknown>;
    expect(m.evil).toBeUndefined();
  });
  it('migrates v1 maps (walls + movers)', () => {
    const v1 = {
      v: 1, name: 'old', author: '', width: 800, height: 500,
      start: { x: 0, y: 0, w: 20, h: 20 }, goal: { x: 700, y: 0, w: 50, h: 50 },
      walls: [{ x: 100, y: 0, w: 10, h: 100 }],
      movers: [{ w: 10, h: 20, path: [{ x: 300, y: 50 }, { x: 300, y: 250 }], speed: 80, mode: 'pingpong', offset: 250 }],
    };
    const m = validateMap(v1);
    expect(m.v).toBe(2);
    expect(m.objects).toHaveLength(2);
    expect(m.objects[1]).toEqual({
      role: 'wall',
      shape: { type: 'rect', x: 295, y: 40, w: 10, h: 20 },
      motion: { type: 'linear', points: [{ x: 300, y: 250 }], speed: 80, repeat: 'pingpong', easing: 'none', delay: -250, clockwise: true },
    });
  });
});

describe('share', () => {
  it('encode → decode round-trips to the same map', async () => {
    for (const m of BUILTIN_LEVELS) {
      const code = await encodeMap(m);
      expect(code).toMatch(/^[zj][A-Za-z0-9_-]+$/);
      expect(await decodeMap(code)).toEqual(m);
    }
  });
  it('throws on a corrupted code', async () => {
    await expect(decodeMap('zAAAA')).rejects.toThrow();
    await expect(decodeMap('xabc')).rejects.toThrow();
  });
});

describe('saws, text boxes and safe zones (#43–48)', () => {
  const disc = { kind: 'disc' as const, clockwise: true, spin: 720, stroke: 0, strokeMs: 0 };
  const blade = { kind: 'blade' as const, clockwise: true, spin: 0, stroke: 40, strokeMs: 400 };

  it('a moving wall passes harmlessly over a cursor in a safe zone', () => {
    const map = baseMap(
      [
        wall({ x: 95, y: 45, w: 10, h: 10 }, { motion: motion({ points: [{ x: 300, y: 50 }], speed: 100 }) }),
        { role: 'safe', shape: { type: 'rect', x: 130, y: 30, w: 40, h: 40 } },
      ],
      { start: { x: 140, y: 40, w: 20, h: 20 } },
    );
    const sim = new Simulation(validateMap(map));
    sim.start(150, 50);
    sim.advanceTo(3000);
    expect(sim.status).toBe('playing');
  });

  it('a safe zone counts as floor on a map with paths', () => {
    const map = baseMap(
      [path({ x: 0, y: 0, w: 100, h: 100 }), { role: 'safe', shape: { type: 'rect', x: 100, y: 0, w: 100, h: 100 } }],
      { start: { x: 0, y: 0, w: 20, h: 20 } },
    );
    const sim = new Simulation(validateMap(map));
    sim.start(10, 10);
    sim.feed(100, 150, 50);
    expect(sim.status).toBe('playing');
    sim.feed(200, 250, 50);
    expect(sim.endReason).toBe('void');
  });

  it('a grinder is deadly and stays round', () => {
    const map = validateMap(baseMap(
      [wall({ x: 180, y: 30, w: 40, h: 50 }, { saw: disc })],
      { start: { x: 0, y: 40, w: 20, h: 20 } },
    ));
    const s = map.objects[0].shape;
    expect(s.type === 'ellipse' && s.rx === s.ry && s.rx === 20).toBe(true);
    const sim = new Simulation(map);
    sim.start(10, 55);
    sim.feed(100, 300, 55);
    expect(sim.endReason).toBe('mover');
  });

  it('a saw blade saws back and forth along its long side', () => {
    // blade 100×10 at x 100–200; it reaches 20px further right a quarter stroke in (100 ms)
    const map = validateMap(baseMap(
      [wall({ x: 100, y: 45, w: 100, h: 10 }, { saw: blade })],
      { start: { x: 205, y: 40, w: 20, h: 20 } },
    ));
    const sim = new Simulation(map);
    sim.start(212, 50);
    sim.advanceTo(1000);
    expect(sim.endReason).toBe('mover');
    // right edge 200 + 20·sin(2πt/400) reaches 212 at t = asin(0.6)·400 / 2π
    expect(sim.endTime).toBeCloseTo((Math.asin(12 / 20) * 400) / (2 * Math.PI), 0);
  });

  it('text box effects are kept, clamped, or dropped when invalid', () => {
    const text = { text: 'Hi', color: '#112233', font: 'main', size: 20, bold: false, align: 'center' as const, outlineWidth: 2 };
    const fx = (extra: Record<string, unknown>) => validateMap(baseMap([{ role: 'text', shape: { type: 'rect', x: 50, y: 30, w: 200, h: 40 }, text: { ...text, ...extra } as never }])).objects[0].text;
    expect(fx({ shadow: '#000000', glow: '#3AE8FF', gradient: '#ff7a3a', depth: 4, depthColor: '#1a2233' }))
      .toMatchObject({ shadow: '#000000', glow: '#3ae8ff', gradient: '#ff7a3a', depth: 4, depthColor: '#1a2233' });
    expect(fx({ depth: 99 })?.depth).toBe(30);
    const bad = fx({ shadow: 'red', glow: 5, depth: 0 });
    expect(bad).not.toHaveProperty('shadow');
    expect(bad).not.toHaveProperty('glow');
    expect(bad).not.toHaveProperty('depth');
  });

  it('text boxes keep their settings and never block the cursor', () => {
    const map = validateMap(baseMap(
      [{ role: 'text', shape: { type: 'rect', x: 50, y: 30, w: 200, h: 40 }, text: { text: 'Hello', color: '#112233', font: 'paperlogy-bold', size: 20, bold: true, align: 'left', outline: '#ffffff', outlineWidth: 2, background: '#00000080' } }],
      { start: { x: 0, y: 40, w: 20, h: 20 } },
    ));
    expect(map.objects[0].text).toMatchObject({ text: 'Hello', font: 'paperlogy-bold', background: '#00000080', align: 'left' });
    expect(map.objects[0].text).not.toHaveProperty('glow');
    const sim = new Simulation(map);
    sim.start(10, 50);
    sim.feed(100, 300, 50);
    expect(sim.status).toBe('playing');
  });
});

describe('formatUtc', () => {
  it('shows timestamps in UTC whatever the offset in the input', async () => {
    const { formatUtc } = await import('./time');
    expect(formatUtc('2026-11-17T17:05:09+09:00')).toBe('2026-11-17 08:05:09 UTC');
    expect(formatUtc('not a date')).toBe('—');
    expect(formatUtc(undefined)).toBe('—');
  });
});

describe('stacked coins', () => {
  it('warns when a coin sits on top of another (they look like one but count twice)', () => {
    const coin = (cx: number, cy: number) => ({ role: 'coin' as const, shape: { type: 'ellipse' as const, cx, cy, rx: 12, ry: 12 } });
    const m = { ...createEmptyMap(), objects: [coin(300, 200), coin(500, 200), coin(303, 198)] };
    const warn = mapWarnings(m);
    expect(warn.filter((w) => w.includes('#3') && w.includes('#1'))).toHaveLength(1);
    expect(mapWarnings({ ...m, objects: [coin(300, 200), coin(500, 200)] }).some((w) => w.includes('#2'))).toBe(false);
  });
});
