import { describe, expect, it } from 'vitest';
import { Circuit, initialPower } from './electric';
import { compileMap, compileObject } from './object';
import { Simulation } from './simulation';
import type { MapData, MapObject } from './types';
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

describe('ice (#71–74, #100–110)', () => {
  it('never blinks', () => {
    const m = mapWith({ role: 'path', shape: { type: 'rect', x: 0, y: 0, w: 100, h: 100 }, ice: { grip: 25 }, blink: { onMs: 500, offMs: 500, delay: 0 } });
    expect(m.objects[0].blink).toBeUndefined();
    expect(m.objects[0].ice).toEqual({ grip: 25 });
  });

  it('can move, rotate, and be a ring sector', () => {
    const m = mapWith(
      { role: 'path', shape: { type: 'sector', cx: 500, cy: 500, r: 100, start: 0, sweep: 90, inner: 50 }, ice: { grip: 25 },
        rotation: { pivot: { x: 500, y: 500 }, speed: 90, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 } },
    );
    expect(m.objects[0].ice).toBeDefined();
    expect(m.objects[0].rotation).toBeDefined();
  });
});

describe('thorn vine (#83 / #84)', () => {
  it('grows thorns past its outline that kill', () => {
    const m = mapWith({ role: 'wall', shape: { type: 'rect', x: 600, y: 300, w: 40, h: 400 }, vine: true });
    expect(m.objects[0].vine).toBe(true);
    const o = compileObject(m.objects[0]);
    // Thorns reach out beyond the rectangle
    expect(o.minX).toBeLessThan(598);
    expect(o.maxX).toBeGreaterThan(642);
    const sim = new Simulation(m);
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 700, 540, 600);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('wall');
  });

  it('is only kept on walls', () => {
    const m = mapWith({ role: 'path', shape: { type: 'rect', x: 600, y: 300, w: 40, h: 400 }, vine: true });
    expect(m.objects[0].vine).toBeUndefined();
  });
});

describe('liquids and lily pads (#85–87)', () => {
  const pond: MapObject = { role: 'liquid', shape: { type: 'rect', x: 400, y: 400, w: 400, h: 300 }, liquid: { kind: 'pond' } };

  it('drowns the cursor', () => {
    const sim = new Simulation(mapWith(pond));
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 600, 540, 500);
    expect(sim.status).toBe('dead');
    expect(sim.endReason).toBe('liquid');
  });

  it('lava, a sulfur spring and oil (#118–120) are deadly freeform liquids too', () => {
    for (const kind of ['lava', 'sulfur', 'oil'] as const) {
      const m = mapWith({
        role: 'liquid', shape: { type: 'poly', free: true, points: [{ x: 400, y: 400, smooth: true }, { x: 800, y: 380, smooth: true }, { x: 820, y: 700, smooth: true }, { x: 420, y: 720, smooth: true }] }, liquid: { kind },
      });
      expect(m.objects[0].liquid).toEqual({ kind });
      const sim = new Simulation(m);
      sim.start(120, 540);
      sweep(sim, 0, 120, 540, 600, 540, 500);
      expect(sim.status, kind).toBe('dead');
      expect(sim.endReason).toBe('liquid');
    }
    expect(() => mapWith({ ...pond, liquid: { kind: 'tar' as never } })).toThrow();
  });

  it('is safe on a lily pad, which keeps round', () => {
    const lily: MapObject = { role: 'lily', shape: { type: 'rect', x: 340, y: 460, w: 200, h: 160 } };
    const m = mapWith(pond, lily);
    expect(m.objects[1].shape).toEqual({ type: 'ellipse', cx: 440, cy: 540, rx: 80, ry: 80 });
    const sim = new Simulation(m);
    sim.start(120, 540);
    // Onto the pad's middle (well within its drift) and stay there
    const t = sweep(sim, 0, 120, 540, 440, 540, 400);
    for (let k = 1; k <= 2000; k++) sim.feed(t + k, 440, 540);
    expect(sim.status).toBe('playing');
  });

  it('lily pads drift', () => {
    const m = mapWith({ role: 'lily', shape: { type: 'ellipse', cx: 400, cy: 400, rx: 30, ry: 30 } });
    const o = compileMap(m)[0];
    expect(o.dynamic).toBe(true);
    const a = o.motion!.offsetAt(0, { x: 0, y: 0 });
    const b = o.motion!.offsetAt(1500, { x: 0, y: 0 });
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
    expect(Math.hypot(b.x, b.y)).toBeLessThan(10);
  });

  it('a lily pad does not turn the map into a path map', () => {
    const sim = new Simulation(mapWith({ role: 'lily', shape: { type: 'ellipse', cx: 1000, cy: 200, rx: 30, ry: 30 } }));
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 900, 540, 500);
    expect(sim.status).toBe('playing');
  });
});

describe('electricity (#91, #94–97)', () => {
  /** A switch at 300,200; a wire from it to 700,200; a wall at the end */
  const sw = (extra: Partial<MapObject['power']> = {}): MapObject => ({ role: 'power', shape: { type: 'rect', x: 280, y: 180, w: 40, h: 40 }, power: { kind: 'switch', ...extra } });
  const wire = (x0: number, y0: number, x1: number, y1: number): MapObject => ({ role: 'wire', shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 }, wire: { points: [{ x: x0, y: y0 }, { x: x1, y: y1 }] } });
  const block: MapObject = { role: 'wall', shape: { type: 'rect', x: 680, y: 300, w: 40, h: 480 } };

  it('regenerates the wire shape and connects its ends', () => {
    const m = mapWith(sw(), wire(300, 200, 700, 200), { role: 'wall', shape: { type: 'rect', x: 690, y: 190, w: 20, h: 20 } });
    expect(m.objects[1].shape.type).toBe('poly');
    const c = new Circuit(m, compileMap(m));
    expect(c.isTarget[2]).toBe(1);
    expect(c.isTarget[0]).toBe(0);
  });

  it('a live wire kills, a dead one does not', () => {
    const dead = new Simulation(mapWith(sw(), wire(300, 200, 300, 900)));
    dead.start(120, 540);
    sweep(dead, 0, 120, 540, 500, 540, 400);
    expect(dead.status).toBe('playing');
    const live = new Simulation(mapWith(sw({ initial: true }), wire(300, 200, 300, 900)));
    live.start(120, 540);
    sweep(live, 0, 120, 540, 500, 540, 400);
    expect(live.status).toBe('dead');
    expect(live.endReason).toBe('shock');
  });

  it('touching the switch powers the wire, which removes the wall it ends on', () => {
    // Switch near START; wire from it up to the wall blocking the way to GOAL
    const s: MapObject = { role: 'power', shape: { type: 'rect', x: 200, y: 520, w: 40, h: 40 }, power: { kind: 'switch' } };
    const w = wire(220, 520, 220, 100);
    const w2 = wire(220, 100, 700, 100);
    const wall: MapObject = { role: 'wall', shape: { type: 'rect', x: 680, y: 80, w: 40, h: 1000 } };
    const m = mapWith(s, w, w2, wall);
    const sim = new Simulation(m);
    sim.start(120, 540);
    expect(sim.hidden[3]).toBe(0);
    let t = sweep(sim, 0, 120, 540, 230, 540, 200);
    expect(sim.power[0]).toBe(1);
    expect(sim.power[1]).toBe(1);
    expect(sim.power[2]).toBe(1);
    expect(sim.hidden[3]).toBe(1);
    t = sweep(sim, t, 230, 540, 1800, 540, 800);
    expect(sim.status).toBe('cleared');
  });

  it('an inverter powers its output while its input is dead', () => {
    const inv: MapObject = { role: 'power', shape: { type: 'rect', x: 470, y: 180, w: 60, h: 40 }, power: { kind: 'inverter' } };
    const m = mapWith(sw(), wire(300, 200, 480, 200), inv, wire(520, 200, 800, 200));
    const objects = compileMap(m);
    const { power } = initialPower(m, objects);
    expect(power[1]).toBe(0);
    expect(power[2]).toBe(1);
    expect(power[3]).toBe(1);
    const on = mapWith(sw({ initial: true }), wire(300, 200, 480, 200), inv, wire(520, 200, 800, 200));
    const p2 = initialPower(on, compileMap(on)).power;
    expect(p2[1]).toBe(1);
    expect(p2[3]).toBe(0);
  });

  it('a timer powers for its duration', () => {
    const timer: MapObject = { role: 'power', shape: { type: 'rect', x: 200, y: 520, w: 40, h: 40 }, power: { kind: 'timer', duration: 300 } };
    const sim = new Simulation(mapWith(timer, wire(220, 520, 220, 100)));
    sim.start(120, 540);
    let t = sweep(sim, 0, 120, 540, 230, 540, 100);
    expect(sim.power[1]).toBe(1);
    t = sweep(sim, t, 230, 540, 260, 540, 400);
    expect(sim.power[1]).toBe(0);
  });

  it('a pulley powers while turned', () => {
    const pulley: MapObject = { role: 'power', shape: { type: 'ellipse', cx: 400, cy: 540, rx: 60, ry: 60 }, power: { kind: 'pulley' } };
    const sim = new Simulation(mapWith(pulley, wire(400, 540, 400, 100)));
    sim.start(120, 540);
    // Into the wheel, staying clear of the wire, then circle around its center
    // (the wire leaves the wheel upward: stay in its lower half)
    let t = sweep(sim, 0, 120, 540, 400 + Math.cos(Math.PI * 0.9) * 30, 540 + Math.sin(Math.PI * 0.9) * 30, 300);
    expect(sim.status).toBe('playing');
    // Press on it to grab it, then turn
    sim.click(t, sim.x, sim.y);
    for (let k = 1; k <= 200; k++) {
      const a = Math.PI * 0.9 - (k / 200) * Math.PI * 0.8;
      sim.feed(t + k, 400 + Math.cos(a) * 30, 540 + Math.sin(a) * 30);
    }
    t += 200;
    expect(sim.status).toBe('playing');
    expect(sim.power[1]).toBe(1);
    for (let k = 1; k <= 500; k++) sim.feed(t + k, sim.x - sim.offX, sim.y - sim.offY);
    expect(sim.power[1]).toBe(0);
  });

  it('a wired door opens while powered', () => {
    const door: MapObject = { role: 'door', shape: { type: 'rect', x: 680, y: 400, w: 40, h: 280 }, door: { mode: 'auto', color: 0, moveMs: 200, waitMs: 1000 } };
    const m = mapWith(sw({ initial: true }), wire(300, 200, 700, 200), wire(700, 200, 700, 410), door);
    const sim = new Simulation(m);
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 130, 540, 400);
    expect(sim.doorOpen[3]).toBe(1);
  });

  it('keeps blocks still unless powered (start)', () => {
    const mover: MapObject = { role: 'wall', shape: { type: 'rect', x: 1000, y: 100, w: 40, h: 40 },
      motion: { type: 'linear', points: [{ x: 1200, y: 120 }], speed: 200, repeat: 'pingpong', easing: 'none', delay: 0, clockwise: true } };
    const m = mapWith(sw(), wire(300, 200, 1020, 120), mover);
    const sim = new Simulation(m);
    sim.start(120, 540);
    sweep(sim, 0, 120, 540, 130, 540, 400);
    expect(sim.clock[2]).toBe(0);
    void block;
  });
});
