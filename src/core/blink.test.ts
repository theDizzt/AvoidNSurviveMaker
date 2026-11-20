import { describe, expect, it } from 'vitest';
import { blinkState } from './hazards';
import { Simulation } from './simulation';
import type { Blink, MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

function mapWith(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

const B: Blink = { onMs: 1000, offMs: 500, delay: 0 };

/** Park the cursor at (x, y) right after starting, then wait until `until` (or death) */
function parkAt(m: MapData, x: number, y: number, until: number): Simulation {
  const sim = new Simulation(m);
  sim.start(m.start.x + 60, m.start.y + 60);
  sim.feed(1, x, y);
  for (let t = 2; t <= until && sim.status === 'playing'; t += 5) sim.feed(t, x, y);
  return sim;
}

describe('blinking paths / walls (#75–82)', () => {
  it('is there, then gone, on a cycle', () => {
    expect(blinkState(B, 400)).toEqual({ on: true, left: 600 });
    expect(blinkState(B, 1200)).toEqual({ on: false, left: 300 });
    expect(blinkState(B, 1600)).toEqual({ on: true, left: 900 });
    // There before the delay; never gone with no off time
    expect(blinkState({ ...B, delay: 2000 }, 1200).on).toBe(true);
    expect(blinkState({ ...B, offMs: 0 }, 1200).on).toBe(true);
  });

  it('a blinking wall is deadly only while it is there', () => {
    const wall: MapObject = { role: 'wall', shape: { type: 'rect', x: 500, y: 500, w: 100, h: 100 }, blink: { onMs: 500, offMs: 2000, delay: 0 } };
    const m = mapWith([wall]);
    // Wait off to the side until it is gone, then step onto it and stay until just before it returns
    const sim = new Simulation(m);
    sim.start(120, 540);
    sim.feed(1, 300, 300);
    for (let t = 2; t < 600; t += 5) sim.feed(t, 300, 300);
    sim.feed(700, 550, 550);
    for (let t = 705; t < 2450; t += 5) sim.feed(t, 550, 550);
    expect(sim.status).toBe('playing');
    for (let t = 2450; t < 2600 && sim.status === 'playing'; t += 5) sim.feed(t, 550, 550);
    expect(sim.endReason).toBe('mover');
    expect(sim.endTime).toBeCloseTo(2500, -1);
  });

  it('a blinking path is floor only while it is there', () => {
    const start = createEmptyMap().start;
    // A bridge from START that comes and goes, beside a permanent one
    const bridge: MapObject = { role: 'path', shape: { type: 'rect', x: start.x + start.w, y: start.y, w: 300, h: 120 }, blink: { onMs: 1000, offMs: 1000, delay: 0 } };
    const m = mapWith([bridge]);
    const sim = parkAt(m, start.x + start.w + 150, start.y + 60, 1500);
    expect(sim.endReason).toBe('void');
    expect(sim.endTime).toBeCloseTo(1000, -1);
  });

  it('only paths and walls keep it', () => {
    const [p, c] = mapWith([
      { role: 'path', shape: { type: 'rect', x: 0, y: 0, w: 50, h: 50 }, blink: B },
      { role: 'coin', shape: { type: 'ellipse', cx: 300, cy: 300, rx: 12, ry: 12 }, blink: B },
    ]).objects;
    expect(p.blink).toEqual(B);
    expect(c.blink).toBeUndefined();
  });
});
