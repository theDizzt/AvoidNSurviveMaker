import { describe, expect, it } from 'vitest';
import { runReplay, Simulation } from './simulation';
import type { MapData, MapObject } from './types';
import { createEmptyMap, validateMap } from './validate';

/** A wide ice rink right of START (everything else is floor: no paths but the rink and the zones) */
function rink(grip = 25): MapData {
  const m = createEmptyMap();
  const ice: MapObject = { role: 'path', shape: { type: 'rect', x: 180, y: 300, w: 1500, h: 480 }, ice: { grip } };
  m.objects = [ice];
  return validateMap(JSON.parse(JSON.stringify(m)));
}

describe('ice (#71–74)', () => {
  it('keeps sliding after the mouse stops', () => {
    const sim = new Simulation(rink());
    sim.start(120, 540);
    // Move right at 0.5 px/ms onto the ice, then hold the mouse still
    for (let t = 1; t <= 800; t++) sim.feed(t, 120 + t * 0.5, 540);
    const mouseX = 120 + 800 * 0.5;
    const atStop = sim.x;
    for (let t = 801; t <= 1300; t++) sim.feed(t, mouseX, 540);
    expect(sim.status).toBe('playing');
    // The cursor went on past where it was when the mouse stopped, and is slowing down
    expect(sim.x).toBeGreaterThan(atStop + 20);
    expect(Math.abs(sim.vx)).toBeLessThan(0.5);
    expect(sim.y).toBeCloseTo(540);
  });

  it('lags behind a change of direction', () => {
    const sim = new Simulation(rink());
    sim.start(120, 540);
    for (let t = 1; t <= 600; t++) sim.feed(t, 120 + t * 0.5, 540);
    const turnX = sim.x;
    // The mouse turns back: the cursor still carries on to the right for a while
    for (let t = 601; t <= 700; t++) sim.feed(t, 420 - (t - 600) * 0.5, 540);
    expect(sim.x).toBeGreaterThan(turnX);
  });

  it('more grip slides less', () => {
    const slide = (grip: number) => {
      const sim = new Simulation(rink(grip));
      sim.start(120, 540);
      for (let t = 1; t <= 800; t++) sim.feed(t, 120 + t * 0.5, 540);
      for (let t = 801; t <= 2000; t++) sim.feed(t, 520, 540);
      return sim.x - 520;
    };
    expect(slide(80)).toBeLessThan(slide(10));
  });

  it('without ice the cursor follows the mouse exactly', () => {
    const m = rink();
    delete m.objects[0].ice;
    const sim = new Simulation(m);
    sim.start(120, 540);
    for (let t = 1; t <= 800; t++) sim.feed(t, 120 + t * 0.5, 540);
    expect(sim.x).toBeCloseTo(520);
  });

  it('replays to the same result', () => {
    const m = rink(15);
    const sim = new Simulation(m);
    sim.start(120, 540);
    for (let t = 1; t < 4000 && sim.status === 'playing'; t += 7) sim.feed(t, 300 + Math.sin(t / 400) * 250, 540 + Math.cos(t / 300) * 150);
    sim.advanceTo(4500);
    const again = runReplay(m, JSON.parse(JSON.stringify(sim.getReplay())));
    expect(again.status).toBe(sim.status);
    expect(again.endTime).toBe(sim.endTime);
  });
});
