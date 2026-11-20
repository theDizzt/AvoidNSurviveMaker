import { describe, expect, it } from 'vitest';
import { compileObject, toWorld, transformAt } from './object';
import { Simulation } from './simulation';
import type { MapObject, Rotation, Saw } from './types';
import { createEmptyMap, validateMap } from './validate';

const turn = (pivot: { x: number; y: number }): Rotation => ({ pivot, speed: 90, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 });
const blade: Saw = { kind: 'blade', clockwise: true, spin: 0, stroke: 0, strokeMs: 400 };

/** Where the saw's center is at time t */
function centerAt(o: MapObject, t: number) {
  const c = compileObject(o);
  return toWorld(c, transformAt(c, t, { dx: 0, dy: 0, cos: 1, sin: 0 }), c.cx, c.cy, { x: 0, y: 0 });
}

describe('rotating saw (#62)', () => {
  it('keeps its rotation through validation', () => {
    const m = createEmptyMap();
    m.objects = [{ role: 'wall', shape: { type: 'rect', x: 400, y: 400, w: 120, h: 20 }, saw: blade, rotation: turn({ x: 460, y: 410 }) }];
    expect(validateMap(JSON.parse(JSON.stringify(m))).objects[0].rotation).toBeDefined();
  });

  it('swings its center around the pivot', () => {
    // Blade centered at (500, 410), pivot 100 px to its left: a quarter turn later it hangs below the pivot
    const o: MapObject = { role: 'wall', shape: { type: 'rect', x: 440, y: 400, w: 120, h: 20 }, saw: blade, rotation: turn({ x: 400, y: 410 }) };
    const c = centerAt(o, 1000);
    expect(c.x).toBeCloseTo(400);
    expect(c.y).toBeCloseTo(510);
  });

  it('saws along its turned long side', () => {
    // Turned a quarter (pointing down), the stroke runs up and down, not sideways
    const o: MapObject = {
      role: 'wall', shape: { type: 'rect', x: 440, y: 400, w: 120, h: 20 },
      saw: { ...blade, stroke: 40, strokeMs: 400 },
      rotation: { ...turn({ x: 500, y: 410 }), speed: 0.0001, angle: 90, repeat: 'once', delay: -1e9 },
    };
    const a = centerAt(o, 100); // stroke at its far end
    expect(a.x).toBeCloseTo(500, 0);
    expect(Math.abs(a.y - 410)).toBeCloseTo(20, 0);
  });

  it('kills the cursor it sweeps over', () => {
    const m = createEmptyMap();
    // A long blade turning around its center, 150 px right of where the cursor waits
    m.objects = [{ role: 'wall', shape: { type: 'rect', x: 400, y: 530, w: 200, h: 20 }, saw: blade, rotation: turn({ x: 500, y: 540 }) }];
    const map = validateMap(JSON.parse(JSON.stringify(m)));
    const sim = new Simulation(map);
    sim.start(120, 540);
    sim.feed(1, 500, 460); // straight above the pivot: the blade comes round to it
    for (let t = 2; t < 3000 && sim.status === 'playing'; t += 5) sim.feed(t, 500, 460);
    expect(sim.status).toBe('dead');
  });

  it('a plain saw is unchanged', () => {
    const o: MapObject = { role: 'wall', shape: { type: 'ellipse', cx: 300, cy: 300, rx: 24, ry: 24 }, saw: { kind: 'disc', clockwise: true, spin: 720, stroke: 0, strokeMs: 0 } };
    const c = centerAt(o, 1234);
    expect(c.x).toBeCloseTo(300);
    expect(c.y).toBeCloseTo(300);
  });
});
