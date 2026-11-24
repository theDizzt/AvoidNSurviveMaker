import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import type { MapData } from './types';
import { validateMap } from './validate';

const files = import.meta.glob<unknown>('../../themes/*/levels/*.json', { eager: true, import: 'default' });

/** A wandering cursor from the middle of START, the same every time for a given seed */
function wander(seed: number, map: MapData, n: number): [number, number, number][] {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let x = map.start.x + map.start.w / 2;
  let y = map.start.y + map.start.h / 2;
  const out: [number, number, number][] = [];
  for (let k = 1; k <= n; k++) {
    x += (rnd() - 0.35) * 40;
    y += (rnd() - 0.5) * 40;
    out.push([k * 37, x, y]);
  }
  return out;
}

function outcome(sim: Simulation) {
  return { status: sim.status, end: sim.endTime, reason: sim.endReason, x: sim.x, y: sim.y, coins: sim.coinsLeft, time: sim.time, replay: sim.getReplay() };
}

describe('Simulation.snapshot / restore', () => {
  it('picks up a run exactly where it left off, on every campaign level', () => {
    let checked = 0;
    for (const [path, raw] of Object.entries(files)) {
      const map = validateMap(JSON.parse(JSON.stringify(raw)));
      for (const seed of [3, 7]) {
        const moves = wander(seed, map, 120);
        const sim = new Simulation(map);
        sim.start(map.start.x + map.start.w / 2, map.start.y + map.start.h / 2);
        const half = 40;
        for (const [t, x, y] of moves.slice(0, half)) sim.feed(t, x, y);
        if (sim.status !== 'playing') continue;
        const snap = sim.snapshot();
        for (const [t, x, y] of moves.slice(half)) sim.feed(t, x, y);
        const first = outcome(sim);
        // Something else in between, then back to the snapshot: twice, to be sure it isn't used up
        for (let r = 0; r < 2; r++) {
          sim.restore(snap);
          sim.feed(snap.own.find(([k]) => k === 'time')![1] as number + 500, 0, 0);
          sim.restore(snap);
          for (const [t, x, y] of moves.slice(half)) sim.feed(t, x, y);
          expect(outcome(sim), path).toEqual(first);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
