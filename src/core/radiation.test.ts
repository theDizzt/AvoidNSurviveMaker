import { describe, expect, it } from 'vitest';
import { auraRadius, segmentCircleEntry } from './radiation';
import { Simulation } from './simulation';
import type { Aura, MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

/** Validated map with these objects (START at 60–180 × 480–600, GOAL at 1740–1860) */
function mapWith(...objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

/** Move the mouse in a straight line from (x0, y0) to (x1, y1) over ms milliseconds, from time t0 */
function sweep(sim: Simulation, t0: number, x0: number, y0: number, x1: number, y1: number, ms: number): number {
  for (let k = 1; k <= ms; k++) sim.feed(t0 + k, x0 + ((x1 - x0) * k) / ms, y0 + ((y1 - y0) * k) / ms);
  return t0 + ms;
}

const aura = (patch: Partial<Aura> = {}): Aura => ({ min: 50, max: 300, growMs: 1000, holdMs: 5000, shrinkMs: 1000, restMs: 0, delay: 0, ...patch });

describe('radiation aura (#116 / #117)', () => {
  it('grows, holds, shrinks and rests', () => {
    const a = aura({ holdMs: 500, restMs: 500 });
    expect(auraRadius(a, 0)).toBe(50);
    expect(auraRadius(a, 500)).toBeCloseTo(175);
    expect(auraRadius(a, 1200)).toBe(300);
    expect(auraRadius(a, 2000)).toBeCloseTo(175);
    expect(auraRadius(a, 2700)).toBe(50);
    // and again
    expect(auraRadius(a, 3000 + 1200)).toBe(300);
  });

  it('rests until its delay, and a negative delay starts partway', () => {
    expect(auraRadius(aura({ delay: 2000 }), 1500)).toBe(50);
    expect(auraRadius(aura({ delay: -1000 }), 0)).toBe(300);
  });

  it('finds where a segment first enters a circle', () => {
    expect(segmentCircleEntry(0, 0, 100, 0, 50, 0, 10)).toBeCloseTo(0.4);
    expect(segmentCircleEntry(50, 0, 100, 0, 50, 0, 10)).toBe(0);
    expect(segmentCircleEntry(0, 20, 100, 20, 50, 0, 10)).toBe(-1);
    expect(segmentCircleEntry(0, 0, 30, 0, 50, 0, 10)).toBe(-1);
  });
});

describe('radioactive zone and waste (#115–117)', () => {
  it('keeps a box rectangular and a drum round', () => {
    const m = mapWith(
      { role: 'rad', shape: { type: 'ellipse', cx: 500, cy: 300, rx: 40, ry: 20 }, rad: { kind: 'box', aura: aura() } },
      { role: 'rad', shape: { type: 'rect', x: 600, y: 300, w: 80, h: 40 }, rad: { kind: 'drum', aura: aura() } },
      { role: 'rad', shape: { type: 'rect', x: 800, y: 300, w: 80, h: 40 }, rad: { kind: 'zone' } },
    );
    expect(m.objects[0].shape.type).toBe('rect');
    expect(m.objects[1].shape).toEqual({ type: 'ellipse', cx: 640, cy: 320, rx: 20, ry: 20 });
    expect(m.objects[2].rad).toEqual({ kind: 'zone' });
  });

  it('a radioactive zone kills on touch', () => {
    const sim = new Simulation(mapWith({ role: 'rad', shape: { type: 'rect', x: 600, y: 0, w: 100, h: 1080 }, rad: { kind: 'zone' } }));
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 1800, 540, 800);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('radiation');
  });

  it('the aura kills once it has grown over the cursor', () => {
    const drum = (a: Aura): MapObject => ({ role: 'rad', shape: { type: 'ellipse', cx: 900, cy: 300, rx: 24, ry: 24 }, rad: { kind: 'drum', aura: a } });
    // 240 px below the drum: past it while the aura is small, then caught once it has grown
    const early = new Simulation(mapWith(drum(aura({ delay: 100_000 }))));
    early.start(120, 540);
    sweep(early, 0, 120, 540, 1800, 540, 800);
    expect(early.status).toBe('cleared');

    const late = new Simulation(mapWith(drum(aura())));
    late.start(120, 540);
    const t = sweep(late, 0, 120, 540, 700, 540, 1500);
    sweep(late, t, 700, 540, 1800, 540, 800);
    expect(late.status).toBe('dead');
    expect(late.endReason).toBe('radiation');
  });

  it('a safe zone over the aura protects the cursor', () => {
    const sim = new Simulation(mapWith(
      { role: 'rad', shape: { type: 'ellipse', cx: 900, cy: 300, rx: 24, ry: 24 }, rad: { kind: 'drum', aura: aura({ delay: -1000 }) } },
      { role: 'safe', shape: { type: 'rect', x: 600, y: 480, w: 600, h: 120 } },
    ));
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 1800, 540, 800);
    expect(sim.status).toBe('cleared');
  });
});
