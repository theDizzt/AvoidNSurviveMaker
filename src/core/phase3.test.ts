import { describe, expect, it } from 'vitest';
import { boulderShape, fallState } from './hazards';
import { runReplay, Simulation } from './simulation';
import type { Fall, MapData, MapObject, Motion } from './types';
import { createEmptyMap, mapErrors, validateMap } from './validate';

function mapWith(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

const FALL: Fall = { height: 300, fallMs: 600, waitMs: 1000, delay: 0 };

describe('falling rock (#51)', () => {
  it('waits, falls, lands, repeats', () => {
    expect(fallState(FALL, 500)).toMatchObject({ falling: false, sinceLanding: Infinity });
    expect(fallState(FALL, 1300)).toMatchObject({ falling: true, u: 0.5 });
    expect(fallState(FALL, 1700)).toMatchObject({ falling: false, sinceLanding: 100 });
  });

  it('keeps only its drop: no route or rotation of its own', () => {
    const [o] = mapWith([{
      role: 'wall', shape: { type: 'poly', points: boulderShape(500, 300, 26) }, fall: FALL,
      motion: { type: 'linear', points: [{ x: 600, y: 300 }], speed: 100, repeat: 'loop', easing: 'none', delay: 0, clockwise: true },
    }]).objects;
    expect(o.fall).toEqual(FALL);
    expect(o.motion).toBeUndefined();
  });

  /** Park the cursor at (x, y), reached right after starting, then wait until `until` */
  function parkAt(m: MapData, x: number, y: number, until: number): Simulation {
    const sim = new Simulation(m);
    sim.start(m.start.x + 10, m.start.y + 10);
    sim.feed(1, x, y);
    for (let t = 2; t <= until && sim.status === 'playing'; t += 5) sim.feed(t, x, y);
    return sim;
  }

  it('is harmless on its landing spot while waiting, deadly where it falls', () => {
    const m = mapWith([{ role: 'wall', shape: { type: 'poly', points: boulderShape(500, 300, 26) }, fall: FALL }]);
    // On the landing spot: safe during the wait, hit when the rock arrives
    expect(parkAt(m, 500, 300, 900).status).toBe('playing');
    const hit = parkAt(m, 500, 300, 1700);
    expect(hit.status).toBe('dead');
    expect(hit.endTime).toBeGreaterThan(1500);
    expect(hit.endTime).toBeLessThanOrEqual(1600);
    // Halfway up the drop line: the rock passes through early in the fall
    const mid = parkAt(m, 500, 150, 1700);
    expect(mid.status).toBe('dead');
    expect(mid.endTime).toBeLessThan(1500);
  });
});

describe('pulley (#52)', () => {
  const route: Motion = { type: 'linear', points: [{ x: 900, y: 300 }], speed: 100, repeat: 'once', easing: 'none', delay: 0, clockwise: true };
  const objects = (mode: 'hold' | 'unwind'): MapObject[] => [
    { role: 'pulley', shape: { type: 'ellipse', cx: 400, cy: 300, rx: 60, ry: 60 }, pulley: { color: 2, mode, turnMs: 1000, unwind: 100 } },
    { role: 'path', shape: { type: 'rect', x: 600, y: 280, w: 40, h: 40 }, motion: route, link: { color: 2, action: 'pulley' } },
  ];

  /** Circle the cursor `turns` times (negative = counter-clockwise) around the pulley, 40 px out */
  function circle(sim: Simulation, t0: number, turns: number): number {
    const steps = Math.round(Math.abs(turns) * 72);
    let t = t0;
    for (let k = 0; k <= steps; k++) {
      const a = Math.sign(turns) * (k / 72) * Math.PI * 2;
      sim.feed((t += 4), 400 + Math.cos(a) * 40, 300 + Math.sin(a) * 40);
    }
    return t;
  }

  function begin(mode: 'hold' | 'unwind'): { sim: Simulation; t: number } {
    // A map with no paths: everywhere is floor, so only the motion is tested
    const m = createEmptyMap();
    m.objects = objects(mode).slice(0, 1).concat({ ...objects(mode)[1], role: 'wall' });
    const map = validateMap(JSON.parse(JSON.stringify(m)));
    const sim = new Simulation(map);
    sim.start(map.start.x + 10, map.start.y + 10);
    sim.feed(10, 440, 300);
    // Press on the wheel: it is held from now on
    sim.click(11, 440, 300);
    return { sim, t: 11 };
  }

  it('turns only while held: pressed on the wheel, then circled however wide', () => {
    // Not pressed: circling does nothing
    const m = createEmptyMap();
    m.objects = objects('hold').slice(0, 1).concat({ ...objects('hold')[1], role: 'wall' });
    const free = new Simulation(validateMap(JSON.parse(JSON.stringify(m))));
    free.start(m.start.x + 10, m.start.y + 10);
    free.feed(10, 440, 300);
    circle(free, 10, 1);
    expect(free.pulleyTime[2]).toBe(0);
    // Pressed next to it, not on it: still nothing
    free.click(400, 600, 300);
    expect(free.grabbed).toBe(-1);

    const { sim, t } = begin('hold');
    expect(sim.grabbed).toBe(0);
    // Held, circles 150 px out (well past the 60 px rim) turn it
    let tt = t;
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      sim.feed((tt += 8), 400 + Math.cos(a) * 150, 300 + Math.sin(a) * 150);
    }
    expect(sim.pulleyTime[2]).toBeCloseTo(1000, -1);
    // Let go: circling no longer turns it
    sim.release((tt += 8), 550, 300);
    expect(sim.grabbed).toBe(-1);
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      sim.feed((tt += 8), 400 + Math.cos(a) * 150, 300 + Math.sin(a) * 150);
    }
    expect(sim.pulleyTime[2]).toBeCloseTo(1000, -1);
  });

  it('a replay grabs and lets go at the same moments', () => {
    const { sim, t } = begin('hold');
    let tt = circle(sim, t, 1);
    sim.release((tt += 8), 440, 300);
    tt = circle(sim, tt, 1);
    const again = runReplay(sim.map, sim.getReplay());
    expect(again.pulleyTime[2]).toBe(sim.pulleyTime[2]);
    expect(again.clock).toEqual(sim.clock);
    void tt;
  });

  it('needs a pulley of its color on the map', () => {
    expect(mapErrors(mapWith(objects('hold')))).toEqual([]);
    expect(mapErrors(mapWith([objects('hold')[1]]))).toHaveLength(1);
  });

  it('a clockwise turn winds the linked object forward, counter-clockwise back, never before the start', () => {
    const { sim, t } = begin('hold');
    let at = circle(sim, t, 1);
    expect(sim.status).toBe('playing');
    expect(sim.pulleyTime[2]).toBeCloseTo(1000, -1);
    at = circle(sim, at, -2);
    expect(sim.pulleyTime[2]).toBe(0);
    expect(sim.pulleyAngle[0]).toBeCloseTo(0, 1);
    void at;
  });

  it('stops at the end of a once-motion', () => {
    const { sim, t } = begin('hold');
    circle(sim, t, 12);
    // From its center (620, 300) to (900, 300): 280 px at 100 px/s, so 2.8 s however far it's wound
    expect(sim.pulleyTime[2]).toBeCloseTo(2800, -1);
  });

  it('holds when let go, or unwinds', () => {
    const hold = begin('hold');
    let at = circle(hold.sim, hold.t, 1);
    hold.sim.release(at + 1, 440, 300);
    hold.sim.feed(at + 600, 440, 300);
    expect(hold.sim.pulleyTime[2]).toBeCloseTo(1000, -1);

    const unwind = begin('unwind');
    at = circle(unwind.sim, unwind.t, 1);
    unwind.sim.release(at + 1, 440, 300);
    unwind.sim.feed(at + 600, 440, 300);
    // 150 ms grace, then back at full speed: about 450 ms of the 1000 unwound
    expect(unwind.sim.pulleyTime[2]).toBeGreaterThan(450);
    expect(unwind.sim.pulleyTime[2]).toBeLessThan(650);
  });
});
