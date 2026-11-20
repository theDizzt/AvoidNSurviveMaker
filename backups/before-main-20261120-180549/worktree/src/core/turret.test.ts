import { describe, expect, it } from 'vitest';
import { runReplay, Simulation } from './simulation';
import type { MapData, MapObject, Turret } from './types';
import { createEmptyMap, DEFAULT_GUN, DEFAULT_MISSILE, validateMap } from './validate';

function mapWith(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

function turret(x: number, y: number, t: Partial<Turret> & { kind: Turret['kind'] }): MapObject {
  return { role: 'turret', shape: { type: 'rect', x: x - 30, y: y - 30, w: 60, h: 60 }, turret: { ...(t.kind === 'gun' ? DEFAULT_GUN : DEFAULT_MISSILE), ...t } };
}

/** Park the cursor at (x, y) right after starting, then wait until `until` (or death) */
function parkAt(m: MapData, x: number, y: number, until: number): Simulation {
  const sim = new Simulation(m);
  sim.start(m.start.x + 60, m.start.y + 60);
  sim.feed(1, x, y);
  for (let t = 2; t <= until && sim.status === 'playing'; t += 7) sim.feed(t, x, y);
  return sim;
}

describe('turret (#60)', () => {
  it('is always 60×60 and fills in its defaults', () => {
    const [o] = mapWith([{ role: 'turret', shape: { type: 'rect', x: 400, y: 400, w: 10, h: 200 }, turret: { kind: 'gun' } as Turret }]).objects;
    expect(o.shape).toEqual({ type: 'rect', x: 375, y: 470, w: 60, h: 60 });
    expect(o.turret).toEqual(DEFAULT_GUN);
  });

  it('turns toward a cursor in range and shoots it', () => {
    // Cursor at (300, 540), turret 200 px to the right, barrel resting the other way
    const m = mapWith([turret(500, 540, { kind: 'gun', angle: 0, turnSpeed: 360, speed: 400 })]);
    const sim = parkAt(m, 300, 540, 3000);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('bullet');
    // Half a turn at 360°/s, then ~170 px at 400 px/s
    expect(sim.endTime).toBeGreaterThan(500);
    expect(sim.endTime).toBeLessThan(1100);
  });

  it('ignores a cursor out of range', () => {
    const m = mapWith([turret(700, 540, { kind: 'gun', range: 300 })]);
    expect(parkAt(m, 300, 540, 3000).status).toBe('playing');
  });

  it('cannot turn past its arc', () => {
    // Barrel faces right with a 90° arc: a cursor straight left is out of its reach
    const m = mapWith([turret(500, 540, { kind: 'gun', angle: 0, arc: 90 })]);
    expect(parkAt(m, 300, 540, 3000).status).toBe('playing');
  });

  it('bullets stop at walls unless they are anti-materiel rounds', () => {
    const wall: MapObject = { role: 'wall', shape: { type: 'rect', x: 390, y: 400, w: 20, h: 100 } };
    const shield = (pierce: boolean) => mapWith([wall, turret(500, 450, { kind: 'gun', angle: 180, pierce })]);
    expect(parkAt(shield(false), 300, 450, 3000).status).toBe('playing');
    expect(parkAt(shield(true), 300, 450, 3000).endReason).toBe('bullet');
  });

  it('can be removed by a switch link', () => {
    const t = { ...turret(500, 540, { kind: 'gun', angle: 180 }), link: { color: 0, action: 'remove' as const } };
    const trig: MapObject = { role: 'trigger', shape: { type: 'rect', x: 900, y: 900, w: 40, h: 40 }, trigger: { kind: 'switch', color: 0, initial: true } };
    expect(parkAt(mapWith([t, trig]), 300, 540, 3000).status).toBe('playing');
  });
});

describe('homing missile (#61)', () => {
  it('curves after the cursor and blows up on it', () => {
    // Launched straight up, it has to turn around to reach a cursor to its left
    const m = mapWith([turret(600, 540, { kind: 'missile', angle: -90, speed: 250, turnSpeed: 150 })]);
    const sim = parkAt(m, 300, 540, 6000);
    expect(sim.endReason).toBe('missile');
    expect(sim.guns.blasts.length).toBe(1);
  });

  it('blows up on a wall in its way', () => {
    const wall: MapObject = { role: 'wall', shape: { type: 'rect', x: 380, y: 300, w: 30, h: 480 } };
    const sim = parkAt(mapWith([wall, turret(600, 540, { kind: 'missile', angle: 180, turnSpeed: 30 })]), 300, 540, 3000);
    expect(sim.status).toBe('playing');
    expect(sim.guns.shots.length + sim.guns.blasts.length).toBeGreaterThan(0);
  });

  it('runs out of flight time', () => {
    // Too slow a turn to ever come round: it blows up by itself after 1 s
    const m = mapWith([turret(600, 540, { kind: 'missile', angle: -90, turnSpeed: 0, lifeMs: 1000, fireMs: 10_000 })]);
    const sim = parkAt(m, 300, 540, 1500);
    expect(sim.status).toBe('playing');
    expect(sim.guns.shots.length).toBe(0);
  });

  it('replays to the same result', () => {
    const m = mapWith([turret(600, 540, { kind: 'missile', angle: -90 }), turret(400, 300, { kind: 'gun' })]);
    const sim = new Simulation(m);
    sim.start(120, 540);
    for (let t = 1; t < 8000 && sim.status === 'playing'; t += 9) sim.feed(t, 120 + Math.sin(t / 300) * 200 + 200, 540 + Math.cos(t / 250) * 150);
    const again = runReplay(m, JSON.parse(JSON.stringify(sim.getReplay())));
    expect(again.status).toBe(sim.status);
    expect(again.endReason).toBe(sim.endReason);
    expect(again.endTime).toBe(sim.endTime);
  });
});
