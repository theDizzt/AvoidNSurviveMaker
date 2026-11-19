import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import type { MapData, MapObject } from './types';
import { createEmptyMap, LIMITS, mapErrors, validateMap } from './validate';

const crystal = (x: number, y: number): MapObject => ({ role: 'crystal', shape: { type: 'rect', x: x - 10, y: y - 10, w: 20, h: 20 } });

function mapWith(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

/** Run from START's center through `points`, ending at GOAL's center */
function run(m: MapData, points: [number, number][]): Simulation {
  const sim = new Simulation(m);
  const s = { x: m.start.x + m.start.w / 2, y: m.start.y + m.start.h / 2 };
  sim.start(s.x, s.y);
  const g = { x: m.goal.x + m.goal.w / 2, y: m.goal.y + m.goal.h / 2 };
  let t = 0;
  for (const [x, y] of [...points, [g.x, g.y] as [number, number]]) sim.feed((t += 200), x, y);
  return sim;
}

describe('crystal star (#59)', () => {
  it('is always 48×48 around where it was placed', () => {
    const [o] = mapWith([crystal(500, 300)]).objects;
    expect(o.shape).toEqual({ type: 'rect', x: 476, y: 276, w: LIMITS.crystalSize, h: LIMITS.crystalSize });
  });

  it('a map may hold only one', () => {
    expect(mapErrors(mapWith([crystal(500, 300)]))).toEqual([]);
    expect(mapErrors(mapWith([crystal(500, 300), crystal(700, 300)]))).toHaveLength(1);
  });

  it('counts when carried to GOAL, and only then', () => {
    const m = mapWith([crystal(960, 300)]);
    const mid = m.start.y + m.start.h / 2;
    const withIt = run(m, [[960, 320]]);
    expect(withIt.status).toBe('cleared');
    expect(withIt.crystalHeld).toBe(true);
    const without = run(m, [[960, mid]]);
    expect(without.status).toBe('cleared');
    expect(without.crystalHeld).toBe(false);
  });

  it('does not lock GOAL like a coin, and is hidden once picked up', () => {
    const m = mapWith([crystal(960, 300)]);
    const sim = run(m, [[960, 300]]);
    expect(sim.coinTotal).toBe(0);
    expect(sim.status).toBe('cleared');
    expect(sim.hidden[0]).toBe(1);
  });

  it('a new run starts without it', () => {
    const m = mapWith([crystal(960, 300)]);
    const sim = run(m, [[960, 300]]);
    expect(sim.crystalHeld).toBe(true);
    sim.start(m.start.x + 10, m.start.y + 10);
    expect(sim.crystalHeld).toBe(false);
  });
});
