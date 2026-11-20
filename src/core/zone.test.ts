import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import type { MapData } from './types';
import { createEmptyMap, validateMap } from './validate';
import { ZoneArea, zoneFromShape, zoneShape } from './zone';

function withZones(patch: Partial<MapData>): MapData {
  return validateMap(JSON.parse(JSON.stringify({ ...createEmptyMap(), ...patch })));
}

describe('shaped START / GOAL (#63–68)', () => {
  it('keeps its shape inside the zone rectangle in 0–1 coordinates', () => {
    const drawn = { type: 'poly' as const, points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 300 }] };
    const z = zoneFromShape(drawn);
    expect(z.rect).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    expect(z.shape).toEqual({ type: 'poly', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] });
    // Moving / resizing the rectangle carries the shape along
    expect(zoneShape({ x: 0, y: 0, w: 400, h: 100 }, z.shape)).toEqual({ type: 'poly', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 100 }] });
  });

  it('a round START only starts inside the circle', () => {
    const m = withZones({ start: { x: 60, y: 480, w: 120, h: 120 }, startShape: { type: 'ellipse' } });
    expect(new Simulation(m).start(65, 485)).toBe(false); // the rectangle's corner, outside the circle
    expect(new Simulation(m).start(120, 540)).toBe(true);
  });

  it('a triangle GOAL counts only once the cursor is inside the triangle', () => {
    // Triangle pointing down inside the goal rectangle (1740, 480, 120×120)
    const m = withZones({ goalShape: { type: 'poly', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] } });
    const area = new ZoneArea(m.goal, m.goalShape);
    expect(area.contains(1745, 595)).toBe(false);
    expect(area.contains(1800, 500)).toBe(true);
    // Sweeping across the rectangle's empty bottom-left corner doesn't clear
    const sim = new Simulation(m);
    sim.start(120, 540);
    sim.feed(100, 1700, 598);
    sim.feed(200, 1750, 598);
    expect(sim.status).toBe('playing');
    sim.feed(300, 1800, 500);
    expect(sim.status).toBe('cleared');
  });

  it('rejects shape points outside 0–1', () => {
    expect(() => withZones({ startShape: { type: 'poly', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }] } })).toThrow();
  });
});
