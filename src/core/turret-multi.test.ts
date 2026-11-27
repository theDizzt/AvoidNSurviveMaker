import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { barrelCount, spinAim } from './turret';
import type { MapData, MapObject, Turret } from './types';
import { createEmptyMap, DEFAULT_FIXED, DEFAULT_GUN, DEFAULT_SPIN, validateMap } from './validate';
import { turnObjects } from './arrange';

function mapWith(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

function turret(x: number, y: number, t: Partial<Turret> & { kind: 'fixed' | 'spin' }): MapObject {
  return { role: 'turret', shape: { type: 'rect', x: x - 30, y: y - 30, w: 60, h: 60 }, turret: { ...(t.kind === 'fixed' ? DEFAULT_FIXED : DEFAULT_SPIN), ...t } };
}

function parkAt(m: MapData, x: number, y: number, until: number): Simulation {
  const sim = new Simulation(m);
  sim.start(m.start.x + 60, m.start.y + 60);
  sim.feed(1, x, y);
  for (let t = 2; t <= until && sim.status === 'playing'; t += 7) sim.feed(t, x, y);
  return sim;
}

describe('fixed / rotating turrets (#121–126)', () => {
  it('keeps barrels / always / ccw only where they apply, and leaves older turrets unchanged', () => {
    const [a, b, c] = mapWith([
      turret(300, 300, { kind: 'fixed', barrels: 4, always: true, ccw: true }),
      turret(600, 300, { kind: 'spin', barrels: 2, ccw: true }),
      { role: 'turret', shape: { type: 'rect', x: 0, y: 0, w: 60, h: 60 }, turret: { ...DEFAULT_GUN, barrels: 2, always: true } as Turret },
    ]).objects;
    expect(a.turret).toEqual({ ...DEFAULT_FIXED, barrels: 4, always: true });
    expect(b.turret).toEqual({ ...DEFAULT_SPIN, barrels: 2, ccw: true });
    expect(c.turret).toEqual(DEFAULT_GUN);
    expect(barrelCount(a.turret!)).toBe(4);
  });

  it('a fixed turret only fires at a cursor inside its sight arc', () => {
    // Barrel faces left at the cursor
    expect(parkAt(mapWith([turret(500, 540, { kind: 'fixed', angle: 180 })]), 300, 540, 3000).endReason).toBe('bullet');
    // Barrel faces up: the cursor to its left is outside the 60° arc
    const sim = parkAt(mapWith([turret(500, 540, { kind: 'fixed', angle: -90 })]), 300, 540, 3000);
    expect(sim.status).toBe('playing');
    expect(sim.guns.shots.length + sim.guns.blasts.length).toBe(0);
  });

  it('a two-way fixed turret also fires out of its back barrel', () => {
    // Barrel faces right, the cursor is to the left: only the back barrel sees it
    expect(parkAt(mapWith([turret(500, 540, { kind: 'fixed', angle: 0, barrels: 2 })]), 300, 540, 3000).endReason).toBe('bullet');
  });

  it('fires nonstop when set to, cursor or not', () => {
    const m = mapWith([turret(500, 540, { kind: 'fixed', angle: -90, barrels: 4, always: true, fireMs: 500 })]);
    const sim = parkAt(m, 1500, 900, 1200);
    expect(sim.status).toBe('playing');
    // Fired at about 0, 500 and 1000 ms, four shots each
    expect(sim.guns.shots.length + sim.guns.blasts.length).toBeGreaterThanOrEqual(8);
  });

  it('a rotating turret sweeps round and hits a cursor in range', () => {
    const sim = parkAt(mapWith([turret(500, 540, { kind: 'spin', angle: 0, turnSpeed: 180, fireMs: 100 })]), 300, 540, 4000);
    expect(sim.endReason).toBe('bullet');
  });

  it('swings back and forth inside a narrow arc', () => {
    const t = { ...DEFAULT_SPIN, arc: 90, turnSpeed: 90 };
    const deg = (ms: number) => Math.round((spinAim(t, ms) * 180) / Math.PI) + 0;
    expect([deg(0), deg(500), deg(1000), deg(1500), deg(2000)]).toEqual([0, 45, 0, -45, 0]);
    expect(Math.round((spinAim({ ...t, ccw: true }, 500) * 180) / Math.PI)).toBe(-45);
    // A cursor behind the arc is never hit
    expect(parkAt(mapWith([turret(500, 540, { kind: 'spin', angle: 0, arc: 90, fireMs: 100 })]), 300, 540, 4000).status).toBe('playing');
  });

  it('a mirrored rotating turret turns the other way', () => {
    const o = turret(500, 540, { kind: 'spin' });
    const [once] = turnObjects([o], 'flipH');
    expect(once.turret!.ccw).toBe(true);
    expect(turnObjects([once], 'flipV')[0].turret!.ccw).toBeUndefined();
  });
});
