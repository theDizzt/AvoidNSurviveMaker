import { describe, expect, it } from 'vitest';
import { pointInPoly } from './geometry';
import { objectLights } from './lighting';
import { compileObject } from './object';
import { flattenShape } from './shape';
import { Simulation } from './simulation';
import type { MapData, MapObject, Shape } from './types';
import { createEmptyMap, DEFAULT_SECRET_RADIUS, DEFAULT_TORCH_LIGHT, validateMap } from './validate';

const ring = (inner: number, sweep = 90): Shape => ({ type: 'sector', cx: 300, cy: 300, r: 100, start: 0, sweep, inner });
const inside = (s: Shape, x: number, y: number) => pointInPoly(x, y, flattenShape(s).poly);

function mapWith(objects: MapObject[]): MapData {
  const m = createEmptyMap();
  m.objects = objects;
  return validateMap(JSON.parse(JSON.stringify(m)));
}

describe('ring sector (#53/#54)', () => {
  it('covers the band between the radii, not the hole', () => {
    const s = ring(50);
    expect(inside(s, 300 + 75 * Math.cos(Math.PI / 4), 300 + 75 * Math.sin(Math.PI / 4))).toBe(true);
    expect(inside(s, 300 + 25 * Math.cos(Math.PI / 4), 300 + 25 * Math.sin(Math.PI / 4))).toBe(false);
    expect(inside(s, 300 + 120 * Math.cos(Math.PI / 4), 300 + 120 * Math.sin(Math.PI / 4))).toBe(false);
  });

  it('a full ring keeps its hole', () => {
    const s = ring(50, 360);
    expect(inside(s, 300, 300)).toBe(false);
    expect(inside(s, 375, 300 + 1)).toBe(true);
    expect(inside(s, 225, 300)).toBe(true);
  });

  it('a ring wall kills when the cursor crosses its band', () => {
    const m = mapWith([{ role: 'wall', shape: { type: 'sector', cx: 600, cy: 300, r: 100, start: 0, sweep: 360, inner: 50 } }]);
    const hole = new Simulation(m);
    hole.start(m.start.x + 10, m.start.y + 10);
    hole.feed(10, 600, 300); // straight across the band into the hole
    expect(hole.status).toBe('dead');
  });

  it('validation keeps the inner radius below the outer one', () => {
    const m = createEmptyMap();
    m.objects = [{ role: 'path', shape: ring(150) }];
    expect(() => validateMap(JSON.parse(JSON.stringify(m)))).toThrow();
    m.objects = [{ role: 'path', shape: ring(40) }];
    expect((validateMap(JSON.parse(JSON.stringify(m))).objects[0].shape as Extract<Shape, { type: 'sector' }>).inner).toBe(40);
  });
});

describe('torches (#57/#58) and secret walls (#55)', () => {
  const torch = (carry = false): MapObject => ({ role: 'torch', shape: { type: 'rect', x: 500, y: 200, w: 24, h: 40 }, ...(carry ? { torch: { carry: true } } : {}) });

  it('a torch always has a light, 120 px by default', () => {
    const m = mapWith([torch(), torch(true)]);
    expect(m.objects[0].light).toEqual({ radius: DEFAULT_TORCH_LIGHT });
    expect(m.objects[1].torch).toEqual({ carry: true });
  });

  it('a carried torch lights from the cursor', () => {
    const objs = mapWith([torch(true)]).objects.map(compileObject);
    const [rest] = objectLights(objs, 0);
    expect(rest).toMatchObject({ x: 512, y: 220, r: 120 });
    const [held] = objectLights(objs, 0, { carried: [1], cursor: { x: 40, y: 50 } });
    expect(held).toMatchObject({ x: 40, y: 50, r: 120 });
  });

  it('secret walls default to a 60 px reveal radius', () => {
    const m = mapWith([{ role: 'secret', shape: { type: 'rect', x: 100, y: 100, w: 200, h: 100 } }]);
    expect(m.objects[0].secret).toEqual({ radius: DEFAULT_SECRET_RADIUS });
  });

  it('torches and secret walls are harmless', () => {
    const m = mapWith([
      { role: 'secret', shape: { type: 'rect', x: 0, y: 0, w: m0().width, h: m0().height } },
      torch(),
    ]);
    const sim = new Simulation(m);
    sim.start(m.start.x + 10, m.start.y + 10);
    sim.feed(50, 512, 220); // through the secret wall and onto the torch
    expect(sim.status).toBe('playing');
  });
});

function m0(): MapData {
  return createEmptyMap();
}
