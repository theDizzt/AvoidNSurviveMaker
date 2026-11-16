import { describe, expect, it } from 'vitest';
import { segmentRectEntry } from './geometry';
import { compileMover, moverPos } from './mover';
import { runReplay, Simulation, formatTime } from './simulation';
import { createEmptyMap, mapWarnings, validateMap } from './validate';
import { decodeMap, encodeMap } from './share';
import { BUILTIN_LEVELS } from './levels';
import type { MapData } from './types';

function baseMap(patch: Partial<MapData> = {}): MapData {
  return {
    ...createEmptyMap(),
    start: { x: 0, y: 0, w: 20, h: 20 },
    goal: { x: 700, y: 0, w: 50, h: 50 },
    ...patch,
  };
}

describe('segmentRectEntry', () => {
  it('returns the fraction where the segment first touches the rect', () => {
    expect(segmentRectEntry(0, 5, 100, 5, 40, 0, 10, 10)).toBeCloseTo(0.4);
  });
  it('returns -1 when it never touches', () => {
    expect(segmentRectEntry(0, 50, 100, 50, 40, 0, 10, 10)).toBe(-1);
    expect(segmentRectEntry(0, 5, 30, 5, 40, 0, 10, 10)).toBe(-1);
  });
  it('returns 0 when the start point is inside', () => {
    expect(segmentRectEntry(45, 5, 100, 5, 40, 0, 10, 10)).toBe(0);
  });
});

describe('moverPos', () => {
  const cm = compileMover({ w: 10, h: 10, path: [{ x: 0, y: 0 }, { x: 100, y: 0 }], speed: 100, mode: 'pingpong', offset: 0 });
  const p = { x: 0, y: 0 };
  it('pingpong: goes to the end and comes back', () => {
    expect(moverPos(cm, 500, p).x + 5).toBeCloseTo(50);
    expect(moverPos(cm, 1000, p).x + 5).toBeCloseTo(100);
    expect(moverPos(cm, 1500, p).x + 5).toBeCloseTo(50);
    expect(moverPos(cm, 2000, p).x + 5).toBeCloseTo(0);
  });
});

describe('Simulation', () => {
  it('does not start when clicking outside START', () => {
    const sim = new Simulation(baseMap());
    expect(sim.start(100, 100)).toBe(false);
    expect(sim.status).toBe('ready');
  });

  it('cannot tunnel through a thin wall even with a long jump', () => {
    const sim = new Simulation(baseMap({ walls: [{ x: 100, y: 0, w: 2, h: 500 }] }));
    sim.start(10, 10);
    sim.feed(10, 600, 10); // 590px in 10ms
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('wall');
    expect(sim.x).toBeCloseTo(100);
    // 590px over 10ms → reaches x=100 at 90/590*10ms
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
    // reaches x=700 at 690/700 of the way
    expect(sim.endTime).toBeCloseTo((690 / 700) * 1000, 9);
    expect(formatTime(sim.endTime)).toBe('0.985');
  });

  it('fails when leaving the map', () => {
    const sim = new Simulation(baseMap());
    sim.start(10, 10);
    sim.feed(5, 10, -30);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('bounds');
    expect(sim.y).toBeCloseTo(0);
  });

  it('fails when a moving obstacle hits a stationary cursor', () => {
    const sim = new Simulation(baseMap({
      start: { x: 140, y: 40, w: 20, h: 20 },
      movers: [{ w: 10, h: 10, path: [{ x: 100, y: 50 }, { x: 300, y: 50 }], speed: 100, mode: 'pingpong', offset: 0 }],
    }));
    sim.start(150, 50);
    sim.advanceTo(2000);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('mover');
    // obstacle center x = 100 + 0.1t; its right edge (center+5) reaches 150 at t=450ms
    expect(sim.endTime).toBeCloseTo(450, 6);
  });

  it('catches the cursor and an obstacle passing through each other', () => {
    // obstacle moves right, cursor moves left fast (a per-frame point check would miss this)
    const sim = new Simulation(baseMap({
      start: { x: 380, y: 40, w: 20, h: 20 },
      movers: [{ w: 4, h: 40, path: [{ x: 300, y: 50 }, { x: 800, y: 50 }], speed: 20000, mode: 'pingpong', offset: 0 }],
    }));
    sim.start(390, 50);
    sim.feed(1, 300, 50); // no overlap at t=0 or t=1, but they cross in between
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('mover');
  });

  it('re-running a replay gives exactly the same result (deterministic)', () => {
    const map = BUILTIN_LEVELS[2];
    const sim = new Simulation(map);
    sim.start(40, 50);
    let t = 0;
    let x = 40;
    let y = 50;
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
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
  });

  it('aborts are recorded in the replay', () => {
    const map = baseMap();
    const sim = new Simulation(map);
    sim.start(10, 10);
    sim.feed(5, 15, 10);
    sim.abort('left');
    const again = runReplay(map, sim.getReplay());
    expect(again.status).toBe('dead');
    expect(again.endReason).toBe('left');
  });
});

describe('validateMap', () => {
  it('all built-in levels are valid with no warnings', () => {
    for (const m of BUILTIN_LEVELS) {
      expect(validateMap(m)).toEqual(m);
      expect(mapWarnings(m)).toEqual([]);
    }
  });
  it('rejects invalid values', () => {
    expect(() => validateMap({ ...createEmptyMap(), width: 'abc' })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), v: 99 })).toThrow();
    expect(() => validateMap({ ...createEmptyMap(), walls: [{ x: 0, y: 0, w: -5, h: 10 }] })).toThrow();
  });
  it('strips unknown fields', () => {
    const m = validateMap({ ...createEmptyMap(), evil: '<script>' }) as unknown as Record<string, unknown>;
    expect(m.evil).toBeUndefined();
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
