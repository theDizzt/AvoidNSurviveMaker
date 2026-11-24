import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import type { MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

/** A map with no paths (everywhere is floor) holding `objects` */
function mapWith(...objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

/** Move the mouse in a straight line to (x1, y1) over ms milliseconds */
function moveTo(sim: Simulation, t0: number, x1: number, y1: number, ms: number): number {
  const x0 = sim.x, y0 = sim.y;
  for (let k = 1; k <= ms; k++) sim.feed(t0 + k, x0 + ((x1 - x0) * k) / ms, y0 + ((y1 - y0) * k) / ms);
  return t0 + ms;
}

const plate = (x: number): MapObject => ({ role: 'trigger', shape: { type: 'rect', x, y: 500, w: 80, h: 80 }, trigger: { kind: 'switch', color: 3, momentary: true } });
/** Gone while color 3 is ON */
const gate: MapObject = { role: 'wall', shape: { type: 'rect', x: 1200, y: 300, w: 40, h: 40 }, link: { color: 3, action: 'remove' } };

describe('pressure plates (switch "only while touching")', () => {
  it('a color is ON only while the cursor is on the plate', () => {
    const sim = new Simulation(mapWith(plate(400), gate));
    sim.start(120, 540);
    let t = moveTo(sim, 0, 300, 540, 100);
    expect(sim.channels[3]).toBe(0);
    t = moveTo(sim, t, 440, 540, 100);
    expect(sim.channels[3]).toBe(1);
    expect(sim.hidden[1]).toBe(1);
    // Staying on keeps it ON
    t = moveTo(sim, t, 450, 545, 300);
    expect(sim.channels[3]).toBe(1);
    // Off the plate: OFF again, the gate is back
    t = moveTo(sim, t, 600, 540, 100);
    expect(sim.channels[3]).toBe(0);
    expect(sim.hidden[1]).toBe(0);
    // And again
    moveTo(sim, t, 440, 540, 100);
    expect(sim.channels[3]).toBe(1);
  });

  it('stays ON while another plate of its color is still pressed... and a quick sweep across leaves it OFF', () => {
    const sim = new Simulation(mapWith(plate(400), plate(470), gate));
    sim.start(120, 540);
    let t = moveTo(sim, 0, 440, 540, 200);
    // Across onto the overlapping second plate, off the first
    t = moveTo(sim, t, 530, 540, 100);
    expect(sim.channels[3]).toBe(1);
    t = moveTo(sim, t, 700, 540, 100);
    expect(sim.channels[3]).toBe(0);
    // Straight over a plate in a single step
    sim.feed(t + 4, 300, 540);
    expect(sim.channels[3]).toBe(0);
  });

  it('can\'t be clicked, start ON or be once-only', () => {
    const m = mapWith({ ...plate(400), trigger: { kind: 'switch', color: 3, momentary: true, click: true, initial: true, once: true } });
    expect(m.objects[0].trigger).toEqual({ kind: 'switch', color: 3, momentary: true });
    // Only switches can be plates
    const timer = mapWith({ ...plate(400), trigger: { kind: 'timer', color: 3, momentary: true, duration: 1000 } });
    expect(timer.objects[0].trigger!.momentary).toBeUndefined();
  });

  it('an electric plate powers its wire only while pressed', () => {
    const elec: MapObject = { role: 'power', shape: { type: 'rect', x: 400, y: 500, w: 80, h: 80 }, power: { kind: 'switch', momentary: true } };
    const wire: MapObject = { role: 'wire', shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 }, wire: { points: [{ x: 440, y: 500 }, { x: 440, y: 200 }] } };
    const map = mapWith(elec, wire);
    expect(map.objects[0].power).toEqual({ kind: 'switch', momentary: true });
    const sim = new Simulation(map);
    sim.start(120, 540);
    let t = moveTo(sim, 0, 430, 560, 200);
    expect(sim.power[1]).toBe(1);
    t = moveTo(sim, t, 700, 560, 200);
    expect(sim.power[1]).toBe(0);
  });
});
