import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import type { MapData } from './types';
import { createEmptyMap, validateMap } from './validate';

function seamMap(): MapData {
  const m = createEmptyMap();
  m.start = { x: 700, y: 480, w: 120, h: 120 };
  m.objects = [
    // Ring sector over the upper-left quarter of (500, 800); its 270° end is the line x = 500, y 480–600
    { role: 'path', shape: { type: 'sector', cx: 500, cy: 800, r: 320, inner: 200, start: 180, sweep: 90 } },
    // Straight path laid flush against that end
    { role: 'path', shape: { type: 'rect', x: 500, y: 480, w: 400, h: 120 } },
  ];
  return validateMap(JSON.parse(JSON.stringify(m)));
}

describe('flush path seams', () => {
  it('wandering across where a ring sector meets a straight path is safe', () => {
    const map = seamMap();
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 500; trial++) {
      const sim = new Simulation(map);
      sim.start(760, 540);
      let x = 500 + (rnd() - 0.5) * 20;
      let y = 490 + rnd() * 100;
      sim.feed(1, x, y);
      for (let t = 2; t < 40 && sim.status === 'playing'; t++) {
        x = rnd() < 0.3 ? 500 : Math.min(510, Math.max(490, x + (rnd() - 0.5) * 6));
        y = Math.min(595, Math.max(485, y + (rnd() - 0.5) * 6));
        sim.feed(t, x, y);
      }
      expect(sim.status, `trial ${trial} at ${x}, ${y}`).toBe('playing');
    }
  });

  it('a circle laid in the hole of a ring sector is one floor with it, all along the arc', () => {
    const m = createEmptyMap();
    m.start = { x: 60, y: 480, w: 120, h: 120 };
    m.objects = [
      { role: 'path', shape: { type: 'rect', x: 180, y: 500, w: 200, h: 80 } },
      { role: 'path', shape: { type: 'sector', cx: 700, cy: 540, r: 350, inner: 173, start: 150, sweep: 60 } },
      { role: 'path', shape: { type: 'ellipse', cx: 700, cy: 540, rx: 173, ry: 173 } },
    ];
    const map = validateMap(JSON.parse(JSON.stringify(m)));
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 300; trial++) {
      const sim = new Simulation(map);
      sim.start(120, 540);
      sim.feed(100, 400, 540);
      // Wandering back and forth over the arc where they meet (x ≈ 527)
      let x = 527 + (rnd() - 0.5) * 6;
      let y = 540 + (rnd() - 0.5) * 120;
      let t = 200;
      sim.feed(t, x, y);
      for (let k = 0; k < 60 && sim.status === 'playing'; k++) {
        x = Math.min(560, Math.max(500, x + (rnd() - 0.5) * 8));
        y = Math.min(600, Math.max(480, y + (rnd() - 0.5) * 8));
        sim.feed((t += 8), x, y);
      }
      expect(sim.status, `trial ${trial} at ${x}, ${y}`).toBe('playing');
    }
  });
});
