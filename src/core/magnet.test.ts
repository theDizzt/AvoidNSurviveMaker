import { describe, expect, it } from 'vitest';
import { LuggageMover } from './conveyor';
import { compileMap } from './object';
import { Simulation } from './simulation';
import type { MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

function mapWith(...objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

/** Hold the mouse still at (x, y) from t0 for ms milliseconds */
function hold(sim: Simulation, t0: number, x: number, y: number, ms: number): number {
  for (let k = 1; k <= ms; k++) sim.feed(t0 + k, x, y);
  return t0 + ms;
}

const magnet = (x: number, y: number, patch: Partial<MapObject> = {}): MapObject => ({
  role: 'magnet', shape: { type: 'rect', x: x - 30, y: y - 15, w: 60, h: 30 },
  magnet: { range: 300, strength: 400, cursor: true, metal: true }, ...patch,
});
const box = (x: number, y: number): MapObject => ({ role: 'metal', shape: { type: 'rect', x: x - 20, y: y - 20, w: 40, h: 40 } });

describe('magnet (#99)', () => {
  it('pulls a still cursor in until it touches the magnet', () => {
    const sim = new Simulation(mapWith(magnet(400, 540)));
    sim.start(180, 540);
    hold(sim, 0, 180, 540, 4000);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('wall');
  });

  it('pulls nothing beyond its range, nor while switched off', () => {
    const far = new Simulation(mapWith(magnet(700, 540)));
    far.start(180, 540);
    hold(far, 0, 180, 540, 2000);
    expect(far.status).toBe('playing');
    expect(far.x).toBe(180);

    // Linked with "start": off until its switch is pressed
    const off = new Simulation(mapWith(magnet(400, 540, { link: { color: 0, action: 'start' } }), { role: 'trigger', shape: { type: 'rect', x: 1000, y: 100, w: 40, h: 40 }, trigger: { kind: 'switch', color: 0 } }));
    off.start(180, 540);
    hold(off, 0, 180, 540, 2000);
    expect(off.status).toBe('playing');
  });

  it('can be set to leave the cursor alone', () => {
    const sim = new Simulation(mapWith(magnet(400, 540, { magnet: { range: 300, strength: 400, cursor: false, metal: true } })));
    sim.start(180, 540);
    hold(sim, 0, 180, 540, 2000);
    expect(sim.status).toBe('playing');
  });
});

describe('metal box (#98)', () => {
  it('is dragged to the magnet and stops against it', () => {
    const m = mapWith(magnet(1000, 200), box(1000, 400));
    const objects = compileMap(m);
    const sim = new Simulation(m, objects);
    sim.start(120, 540);
    hold(sim, 0, 120, 540, 3000);
    const mover = objects[1].motion as LuggageMover;
    expect(mover).toBeInstanceOf(LuggageMover);
    // Pulled up from 400 until its top (center - 20) meets the magnet's bottom (215)
    expect(mover.y1).toBeLessThan(-150);
    expect(400 + mover.y1 - 20).toBeGreaterThanOrEqual(215 - 0.01);
    expect(Math.abs(mover.x1)).toBeLessThan(1e-6);
  });

  it('is stopped by a wall in its way, and kills like one', () => {
    const m = mapWith(magnet(1000, 200), { role: 'wall', shape: { type: 'rect', x: 900, y: 300, w: 200, h: 20 } }, box(1000, 400));
    const objects = compileMap(m);
    const sim = new Simulation(m, objects);
    sim.start(120, 540);
    hold(sim, 0, 120, 540, 3000);
    const mover = objects[2].motion as LuggageMover;
    expect(400 + mover.y1 - 20).toBeGreaterThanOrEqual(320 - 0.01);

    // Driving the cursor into it
    const hit = new Simulation(mapWith(box(600, 540)));
    hit.start(120, 540);
    for (let k = 1; k <= 600; k++) hit.feed(k, 120 + k, 540);
    expect(hit.status).toBe('dead');
  });

  it('has no route or rotation of its own', () => {
    const m = mapWith({ ...box(500, 500), rotation: { pivot: { x: 500, y: 500 }, speed: 90, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 } });
    expect(m.objects[0].rotation).toBeUndefined();
  });
});
