import { compileMover, moverPos } from './mover';
import { rectsOverlap } from './geometry';
import { MAP_VERSION, type MapData, type Mover, type Point, type Rect } from './types';

export const LIMITS = {
  minSize: 200,
  maxSize: 4000,
  maxWalls: 1000,
  maxMovers: 200,
  maxPathPoints: 64,
  maxSpeed: 5000,
  maxOffset: 600_000,
  maxText: 60,
} as const;

export class MapValidationError extends Error {}

function fail(msg: string): never {
  throw new MapValidationError(msg);
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${name}: must be an object`);
  return v as Record<string, unknown>;
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${name}: must be a number`);
  if (v < min || v > max) fail(`${name}: must be between ${min} and ${max} (got ${v})`);
  return v;
}

function text(v: unknown, name: string): string {
  if (v === undefined) return '';
  if (typeof v !== 'string') fail(`${name}: must be a string`);
  return v.slice(0, LIMITS.maxText);
}

function arr(v: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(`${name}: must be an array`);
  if (v.length > max) fail(`${name}: at most ${max} items allowed`);
  return v;
}

function rect(v: unknown, name: string, W: number, H: number): Rect {
  const o = obj(v, name);
  return {
    x: num(o.x, `${name}.x`, -W, W),
    y: num(o.y, `${name}.y`, -H, H),
    w: num(o.w, `${name}.w`, 1, W),
    h: num(o.h, `${name}.h`, 1, H),
  };
}

function point(v: unknown, name: string, W: number, H: number): Point {
  const o = obj(v, name);
  return { x: num(o.x, `${name}.x`, -W, W * 2), y: num(o.y, `${name}.y`, -H, H * 2) };
}

function mover(v: unknown, name: string, W: number, H: number): Mover {
  const o = obj(v, name);
  const path = arr(o.path, `${name}.path`, LIMITS.maxPathPoints).map((p, i) => point(p, `${name}.path[${i}]`, W, H));
  if (path.length === 0) fail(`${name}.path: needs at least 1 waypoint`);
  const mode = o.mode === 'loop' ? 'loop' : o.mode === 'pingpong' ? 'pingpong' : fail(`${name}.mode: must be pingpong or loop`);
  return {
    w: num(o.w, `${name}.w`, 1, W),
    h: num(o.h, `${name}.h`, 1, H),
    path,
    speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxSpeed),
    mode,
    offset: o.offset === undefined ? 0 : num(o.offset, `${name}.offset`, 0, LIMITS.maxOffset),
  };
}

/**
 * Validate a map from an external source (share link, file, later server upload)
 * and return a clean object with unknown fields stripped.
 */
export function validateMap(input: unknown): MapData {
  const o = obj(input, 'map');
  if (o.v !== MAP_VERSION) fail(`Unsupported map version (${String(o.v)})`);
  const W = num(o.width, 'width', LIMITS.minSize, LIMITS.maxSize);
  const H = num(o.height, 'height', LIMITS.minSize, LIMITS.maxSize);
  return {
    v: MAP_VERSION,
    name: text(o.name, 'name') || 'Untitled map',
    author: text(o.author, 'author'),
    width: W,
    height: H,
    start: rect(o.start, 'start', W, H),
    goal: rect(o.goal, 'goal', W, H),
    walls: arr(o.walls, 'walls', LIMITS.maxWalls).map((w, i) => rect(w, `walls[${i}]`, W, H)),
    movers: arr(o.movers, 'movers', LIMITS.maxMovers).map((m, i) => mover(m, `movers[${i}]`, W, H)),
  };
}

/** Things that are structurally valid but may cause problems in play */
export function mapWarnings(map: MapData): string[] {
  const out: string[] = [];
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= map.width && r.y + r.h <= map.height;
  if (!inside(map.start)) out.push('The START area extends outside the map.');
  if (!inside(map.goal)) out.push('The GOAL area extends outside the map.');
  if (rectsOverlap(map.start, map.goal)) out.push('START and GOAL overlap.');
  map.walls.forEach((w, i) => {
    if (rectsOverlap(w, map.start)) out.push(`Wall #${i + 1} overlaps START.`);
    if (rectsOverlap(w, map.goal)) out.push(`Wall #${i + 1} overlaps GOAL.`);
  });
  const p = { x: 0, y: 0 };
  map.movers.forEach((m, i) => {
    moverPos(compileMover(m), 0, p);
    if (rectsOverlap({ x: p.x, y: p.y, w: m.w, h: m.h }, map.start)) {
      out.push(`Obstacle #${i + 1} overlaps START when the run begins.`);
    }
  });
  return out;
}

export function createEmptyMap(): MapData {
  return {
    v: MAP_VERSION,
    name: 'New map',
    author: '',
    width: 800,
    height: 500,
    start: { x: 20, y: 220, w: 60, h: 60 },
    goal: { x: 720, y: 220, w: 60, h: 60 },
    walls: [],
    movers: [],
  };
}
