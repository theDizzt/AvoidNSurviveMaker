import { pointInPoly, pointInRect } from './geometry';
import { compileObject, toWorld, transformAt, type Transform } from './object';
import { shapeCenter } from './shape';
import {
  MAP_VERSION,
  type Easing, type Fill, type MapData, type MapObject, type Motion, type PatternKind, type Point, type PolyPoint, type Rect,
  type Repeat, type Rotation, type Shape, type SurfaceStyle, type Theme,
} from './types';

export const LIMITS = {
  minSize: 200,
  maxSize: 4000,
  maxObjects: 2000,
  maxPolyPoints: 256,
  maxMarkers: 64,
  maxSpeed: 5000,
  maxRotSpeed: 3600,
  maxAngle: 36000,
  maxDelay: 600_000,
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

function oneOf<T extends string>(v: unknown, name: string, options: readonly T[]): T {
  if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
  return fail(`${name}: must be one of ${options.join(', ')}`);
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail(`${name}: must be true or false`);
  return v;
}

const REPEATS = ['loop', 'pingpong', 'once'] as const satisfies readonly Repeat[];
const EASINGS = ['none', 'in', 'out', 'inOut'] as const satisfies readonly Easing[];

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

function shape(v: unknown, name: string, W: number, H: number): Shape {
  const o = obj(v, name);
  const type = oneOf(o.type, `${name}.type`, ['rect', 'ellipse', 'poly'] as const);
  if (type === 'rect') return { type, ...rect(o, name, W, H) };
  if (type === 'ellipse') {
    return {
      type,
      cx: num(o.cx, `${name}.cx`, -W, W * 2),
      cy: num(o.cy, `${name}.cy`, -H, H * 2),
      rx: num(o.rx, `${name}.rx`, 1, W),
      ry: num(o.ry, `${name}.ry`, 1, H),
    };
  }
  const points = arr(o.points, `${name}.points`, LIMITS.maxPolyPoints).map((p, i): PolyPoint => {
    const pt = point(p, `${name}.points[${i}]`, W, H);
    return obj(p, name).smooth === true ? { ...pt, smooth: true } : pt;
  });
  if (points.length < 3) fail(`${name}.points: a polygon needs at least 3 vertices`);
  return { type, points };
}

function motion(v: unknown, name: string, W: number, H: number): Motion {
  const o = obj(v, name);
  const type = oneOf(o.type, `${name}.type`, ['linear', 'curve', 'circle'] as const);
  return {
    type,
    points: arr(o.points, `${name}.points`, LIMITS.maxMarkers).map((p, i) => point(p, `${name}.points[${i}]`, W, H)),
    speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxSpeed),
    repeat: oneOf(o.repeat, `${name}.repeat`, REPEATS),
    easing: oneOf(o.easing, `${name}.easing`, EASINGS),
    delay: num(o.delay, `${name}.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
    clockwise: bool(o.clockwise, `${name}.clockwise`),
  };
}

function rotation(v: unknown, name: string, W: number, H: number): Rotation {
  const o = obj(v, name);
  return {
    pivot: point(o.pivot, `${name}.pivot`, W, H),
    speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxRotSpeed),
    angle: num(o.angle, `${name}.angle`, 0, LIMITS.maxAngle),
    clockwise: bool(o.clockwise, `${name}.clockwise`),
    repeat: oneOf(o.repeat, `${name}.repeat`, REPEATS),
    easing: oneOf(o.easing, `${name}.easing`, EASINGS),
    delay: num(o.delay, `${name}.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
  };
}

function mapObject(v: unknown, name: string, W: number, H: number): MapObject {
  const o = obj(v, name);
  const out: MapObject = {
    role: oneOf(o.role, `${name}.role`, ['path', 'wall'] as const),
    shape: shape(o.shape, `${name}.shape`, W, H),
  };
  if (o.motion !== undefined) out.motion = motion(o.motion, `${name}.motion`, W, H);
  if (o.rotation !== undefined) out.rotation = rotation(o.rotation, `${name}.rotation`, W, H);
  return out;
}

function color(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) fail(`${name}: must be a color like #12ab9f`);
  return v.toLowerCase();
}

const PATTERNS = ['stripes', 'diagonal', 'dots', 'grid', 'checker'] as const satisfies readonly PatternKind[];

function fill(v: unknown, name: string): Fill {
  const o = obj(v, name);
  const type = oneOf(o.type, `${name}.type`, ['solid', 'gradient', 'pattern'] as const);
  if (type === 'solid') return { type, color: color(o.color, `${name}.color`) };
  if (type === 'gradient') {
    return {
      type,
      style: oneOf(o.style, `${name}.style`, ['linear', 'radial'] as const),
      from: color(o.from, `${name}.from`),
      to: color(o.to, `${name}.to`),
      angle: num(o.angle, `${name}.angle`, -360, 360),
    };
  }
  return {
    type,
    pattern: oneOf(o.pattern, `${name}.pattern`, PATTERNS),
    color: color(o.color, `${name}.color`),
    background: color(o.background, `${name}.background`),
    size: num(o.size, `${name}.size`, 4, 64),
  };
}

function surface(v: unknown, name: string): SurfaceStyle {
  const o = obj(v, name);
  return { fill: fill(o.fill, `${name}.fill`), edge: color(o.edge, `${name}.edge`) };
}

function theme(v: unknown, name: string): Theme {
  const o = obj(v, name);
  return { wall: surface(o.wall, `${name}.wall`), path: surface(o.path, `${name}.path`) };
}

/** Map format v1 (rect walls + rect movers) → v2 objects */
function migrateV1(o: Record<string, unknown>): Record<string, unknown> {
  const objects: unknown[] = [];
  for (const w of Array.isArray(o.walls) ? o.walls : []) {
    objects.push({ role: 'wall', shape: { type: 'rect', ...(w as object) } });
  }
  for (const raw of Array.isArray(o.movers) ? o.movers : []) {
    const m = raw as { w: number; h: number; path: Point[]; speed: number; mode: string; offset?: number };
    const p0 = m.path?.[0] ?? { x: 0, y: 0 };
    objects.push({
      role: 'wall',
      shape: { type: 'rect', x: p0.x - m.w / 2, y: p0.y - m.h / 2, w: m.w, h: m.h },
      motion: {
        type: 'linear',
        points: (m.path ?? []).slice(1),
        speed: m.speed,
        repeat: m.mode === 'loop' ? 'loop' : 'pingpong',
        easing: 'none',
        delay: -(m.offset ?? 0),
        clockwise: true,
      },
    });
  }
  return { ...o, v: MAP_VERSION, objects };
}

/**
 * Validate a map from an external source (share link, file, later server upload)
 * and return a clean object with unknown fields stripped. Older map versions are migrated.
 */
export function validateMap(input: unknown): MapData {
  let o = obj(input, 'map');
  if (o.v === 1) o = migrateV1(o);
  if (o.v !== MAP_VERSION) fail(`Unsupported map version (${String(o.v)})`);
  const W = num(o.width, 'width', LIMITS.minSize, LIMITS.maxSize);
  const H = num(o.height, 'height', LIMITS.minSize, LIMITS.maxSize);
  const map: MapData = {
    v: MAP_VERSION,
    name: text(o.name, 'name') || 'Untitled map',
    author: text(o.author, 'author'),
    width: W,
    height: H,
    start: rect(o.start, 'start', W, H),
    goal: rect(o.goal, 'goal', W, H),
    objects: arr(o.objects, 'objects', LIMITS.maxObjects).map((m, i) => mapObject(m, `objects[${i}]`, W, H)),
  };
  if (o.theme !== undefined) map.theme = theme(o.theme, 'theme');
  return map;
}

/** Does the object (posed at time t) overlap the rect? Checks vertices both ways, good enough for warnings. */
function overlapsRect(m: MapObject, r: Rect, t: number): boolean {
  const c = compileObject(m);
  const tf: Transform = transformAt(c, t, { dx: 0, dy: 0, cos: 1, sin: 0 });
  const world = new Float64Array(c.poly.length);
  const p = { x: 0, y: 0 };
  for (let i = 0; i < c.poly.length; i += 2) {
    toWorld(c, tf, c.poly[i], c.poly[i + 1], p);
    world[i] = p.x;
    world[i + 1] = p.y;
    if (pointInRect(p.x, p.y, r)) return true;
  }
  const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h / 2]];
  return corners.some(([x, y]) => pointInPoly(x, y, world));
}

/** Things that are structurally valid but may cause problems in play */
export function mapWarnings(map: MapData): string[] {
  const out: string[] = [];
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= map.width && r.y + r.h <= map.height;
  if (!inside(map.start)) out.push('The START area extends outside the map.');
  if (!inside(map.goal)) out.push('The GOAL area extends outside the map.');
  if (overlapsRect({ role: 'wall', shape: { type: 'rect', ...map.start } }, map.goal, 0)) out.push('START and GOAL overlap.');
  map.objects.forEach((o, i) => {
    if (o.role !== 'wall') return;
    if (overlapsRect(o, map.start, 0)) out.push(`Wall #${i + 1} overlaps START when the run begins.`);
    if (!o.motion && !o.rotation && overlapsRect(o, map.goal, 0)) out.push(`Wall #${i + 1} covers part of GOAL.`);
  });
  map.objects.forEach((o, i) => {
    if (o.motion && o.motion.points.length === 0) out.push(`Object #${i + 1} is set to move but has no markers.`);
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
    objects: [],
  };
}

export const DEFAULT_MOTION: Readonly<Motion> = {
  type: 'linear',
  points: [],
  speed: 150,
  repeat: 'pingpong',
  easing: 'inOut',
  delay: 0,
  clockwise: true,
};

export function defaultRotation(o: MapObject): Rotation {
  return {
    pivot: shapeCenter(o.shape),
    speed: 90,
    angle: 360,
    clockwise: true,
    repeat: 'loop',
    easing: 'none',
    delay: 0,
  };
}
