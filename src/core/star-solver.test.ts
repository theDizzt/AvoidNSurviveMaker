import { describe, expect, it } from 'vitest';
import { runReplay, Simulation } from './simulation';
import { ceilTenth, rateStars, RouteSolver, SKILLS, STAR_TIERS, starTimesFor, type SkillId } from './star-solver';
import type { MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

/** START (60, 480) and GOAL (1740, 480) joined by a straight corridor, plus `extra` */
function corridor(extra: MapObject[] = []): MapData {
  const m = createEmptyMap();
  m.objects = [{ role: 'path', shape: { type: 'rect', x: 180, y: 480, w: 1560, h: 120 } }, ...extra];
  return validateMap(JSON.parse(JSON.stringify(m)));
}

const TIMES: Record<SkillId, number> = { expert: 1000, skilled: 1300, casual: 1700, careful: 2400 };

describe('star times from routes', () => {
  it('rounds up to the next 0.1 s', () => {
    expect(ceilTenth(1000)).toBe(1000);
    expect(ceilTenth(1000.4)).toBe(1100);
    expect(ceilTenth(1001)).toBe(1100);
    expect(ceilTenth(1099.9)).toBe(1100);
    // Floating-point noise from the slack factors doesn't push a round value up
    expect(ceilTenth(3000 * 1.1)).toBe(3300);
    expect(ceilTenth(12)).toBe(100);
  });

  it('every tier gives three < two < one, and a stricter tier never gives more time', () => {
    let prev: number[] | null = null;
    for (const tier of STAR_TIERS) {
      const s = starTimesFor(TIMES, tier);
      expect(s.three).toBeLessThan(s.two);
      expect(s.two).toBeLessThan(s.one);
      for (const v of [s.three, s.two, s.one]) expect(v % 100).toBe(0);
      if (prev) [s.three, s.two, s.one].forEach((v, i) => expect(v).toBeLessThanOrEqual(prev![i]));
      prev = [s.three, s.two, s.one];
    }
    // Brutal: the fastest skills' own times
    expect(starTimesFor(TIMES, 'brutal')).toEqual({ three: 1000, two: 1300, one: 1700 });
    // Equal times still leave a 0.1 s step between the stars
    const same = { expert: 1000, skilled: 1000, casual: 1000, careful: 1000 };
    expect(starTimesFor(same, 'brutal')).toEqual({ three: 1000, two: 1100, one: 1200 });
  });

  it('finds a straight run, faster for better players, and the routes really clear', () => {
    const map = corridor();
    const r = rateStars(map, 'normal');
    const ms = r.skills.map((s) => s.ms!);
    expect(ms.every((v) => v > 0)).toBe(true);
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1]);
    for (const s of r.skills) {
      const sim = runReplay(map, s.replay!);
      expect(sim.status).toBe('cleared');
      expect(sim.endTime).toBeCloseTo(s.ms!, 6);
    }
    // ~1560 px of corridor 120 px wide: no human crosses it in a blink, nor needs ages
    expect(ms[0]).toBeGreaterThan(300);
    expect(ms[3]).toBeLessThan(5000);
    expect(r.stars).toEqual(starTimesFor(r.times, 'normal'));
  });

  it('a person who already cleared it faster sets the expert time', () => {
    const r = rateStars(corridor(), 'brutal', { observedMs: 250 });
    expect(r.times.expert).toBe(250);
    expect(r.stars.three).toBe(300);
  });

  it('waits for a gate that opens and shuts, and gets through it in one piece', () => {
    // A block that closes the corridor, sliding up out of the way and back every 2 s
    const gate: MapObject = {
      role: 'wall', shape: { type: 'rect', x: 900, y: 470, w: 60, h: 140 },
      motion: { type: 'linear', points: [{ x: 930, y: 300 }], speed: 240, repeat: 'pingpong', easing: 'none', delay: 0, clockwise: true },
    };
    const map = corridor([gate]);
    const solver = new RouteSolver(map);
    const expert = solver.solve(SKILLS[0], 20_000)!;
    const careful = solver.solve(SKILLS[3], 20_000)!;
    expect(expert).not.toBeNull();
    expect(careful).not.toBeNull();
    expect(runReplay(map, expert.replay).status).toBe('cleared');
    expect(runReplay(map, careful.replay).status).toBe('cleared');
    expect(careful.ms).toBeGreaterThan(expert.ms);
    // Slower than the open corridor: it had to time the gate
    const open = new RouteSolver(corridor()).solve(SKILLS[0], 20_000)!;
    expect(expert.ms).toBeGreaterThanOrEqual(open.ms);
  });

  it('goes for the switch that opens the way first', () => {
    // A wall that a switch up a side passage removes
    const map = corridor([
      { role: 'wall', shape: { type: 'rect', x: 900, y: 480, w: 60, h: 120 }, link: { color: 1, action: 'remove' } },
      { role: 'path', shape: { type: 'rect', x: 480, y: 300, w: 120, h: 180 } },
      { role: 'trigger', shape: { type: 'rect', x: 510, y: 320, w: 60, h: 60 }, trigger: { kind: 'switch', color: 1 } },
    ]);
    const r = rateStars(map, 'normal');
    expect(r.skills[0].ms).not.toBeNull();
    for (const s of r.skills) if (s.replay) expect(runReplay(map, s.replay).status).toBe('cleared');
    // The detour to the switch costs time over the open corridor
    expect(r.times.expert).toBeGreaterThan(rateStars(corridor(), 'normal').times.expert);
  });

  it('gives up on a level with no way to the GOAL', () => {
    const m = createEmptyMap();
    m.objects = [{ role: 'path', shape: { type: 'rect', x: 180, y: 480, w: 600, h: 120 } }];
    const r = new RouteSolver(validateMap(JSON.parse(JSON.stringify(m)))).solve(SKILLS[0], 20_000);
    expect(r).toBeNull();
  });
});

describe('Simulation restarts', () => {
  it('a second run on the same instance gets its coins back', () => {
    const m = createEmptyMap();
    m.objects = [{ role: 'coin', shape: { type: 'ellipse', cx: 400, cy: 540, rx: 12, ry: 12 } }];
    const map = validateMap(JSON.parse(JSON.stringify(m)));
    const sim = new Simulation(map);
    for (let run = 0; run < 2; run++) {
      sim.start(120, 540);
      sim.feed(100, 400, 540);
      expect(sim.coinsLeft).toBe(0);
      sim.feed(400, 1800, 540);
      expect(sim.status).toBe('cleared');
    }
  });
});
