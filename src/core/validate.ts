import { t } from './i18n';
import { pointInPoly, pointInRect } from './geometry';
import { compileObject, toWorld, transformAt, type Transform } from './object';
import { switchColor } from './colors';
import { shapeBounds, shapeCenter } from './shape';
import {
  MAP_VERSION, PACK_VERSION,
  type Door, type Easing, type Fill, type MapData, type MapPack, type Trigger, type TriggerKind, type MapObject, type Motion, type PatternKind, type Point, type PolyPoint, type Rect,
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
  maxLevel: 9999,
  /** Longest star time (ms) */
  maxStarTime: 3_600_000,
  maxPackLevels: 200,
  /** Coins are always this size (diameter) */
  coinSize: 24,
  /** Global darkness light radius */
  minLight: 16,
  maxLight: 2000,
} as const;

export class MapValidationError extends Error {}

function fail(msg: string): never {
  throw new MapValidationError(msg);
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(t('validate.object', { name }));
  return v as Record<string, unknown>;
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(t('validate.number', { name }));
  if (v < min || v > max) fail(t('validate.range', { name, min, max, value: v }));
  return v;
}

function text(v: unknown, name: string): string {
  if (v === undefined) return '';
  if (typeof v !== 'string') fail(t('validate.string', { name }));
  return v.slice(0, LIMITS.maxText);
}

function arr(v: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(t('validate.array', { name }));
  if (v.length > max) fail(t('validate.arrayMax', { name, max }));
  return v;
}

function oneOf<T extends string>(v: unknown, name: string, options: readonly T[]): T {
  if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
  return fail(t('validate.oneOf', { name, options: options.join(', ') }));
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail(t('validate.bool', { name }));
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
  const type = oneOf(o.type, `${name}.type`, ['rect', 'ellipse', 'poly', 'sector'] as const);
  if (type === 'rect') return { type, ...rect(o, name, W, H) };
  if (type === 'sector') {
    return {
      type,
      cx: num(o.cx, `${name}.cx`, -W, W * 2),
      cy: num(o.cy, `${name}.cy`, -H, H * 2),
      r: num(o.r, `${name}.r`, 1, Math.max(W, H)),
      start: num(o.start, `${name}.start`, -720, 720),
      sweep: num(o.sweep, `${name}.sweep`, 1, 360),
    };
  }
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
  if (points.length < 3) fail(t('validate.polyPoints', { name }));
  return o.free === true ? { type, points, free: true } : { type, points };
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
    ...(o.showPath === true ? { showPath: true } : {}),
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
    ...(o.showPivot === true ? { showPivot: true } : {}),
  };
}

function colorIndex(v: unknown, name: string): number {
  const c = num(v, name, 0, 15);
  if (!Number.isInteger(c)) fail(t('validate.colorIndex', { name }));
  return c;
}

const TRIGGER_KINDS = ['switch', 'timer', 'hold', 'startZone', 'stopZone'] as const satisfies readonly TriggerKind[];

function trigger(v: unknown, name: string): Trigger {
  const o = obj(v, name);
  const kind = oneOf(o.kind, `${name}.kind`, TRIGGER_KINDS);
  const t: Trigger = { kind, color: colorIndex(o.color, `${name}.color`) };
  if (o.click === true && (kind === 'switch' || kind === 'timer')) t.click = true;
  if (o.initial === true && (kind === 'switch' || kind === 'hold')) t.initial = true;
  if (o.once === true && kind !== 'startZone' && kind !== 'stopZone') t.once = true;
  if (o.revert === true) t.revert = true;
  if (kind === 'timer' || kind === 'hold') t.duration = num(o.duration, `${name}.duration`, 50, LIMITS.maxDelay);
  return t;
}

function door(v: unknown, name: string): Door {
  const o = obj(v, name);
  return {
    mode: oneOf(o.mode, `${name}.mode`, ['auto', 'switch'] as const),
    color: colorIndex(o.color, `${name}.color`),
    moveMs: num(o.moveMs, `${name}.moveMs`, 50, LIMITS.maxDelay),
    waitMs: num(o.waitMs, `${name}.waitMs`, 0, LIMITS.maxDelay),
  };
}

function mapObject(v: unknown, name: string, W: number, H: number): MapObject {
  const o = obj(v, name);
  const out: MapObject = {
    role: oneOf(o.role, `${name}.role`, ['path', 'wall', 'coin', 'dark', 'trigger', 'door', 'laser', 'mirror', 'portal', 'text', 'safe'] as const),
    shape: shape(o.shape, `${name}.shape`, W, H),
  };
  if (o.motion !== undefined) out.motion = motion(o.motion, `${name}.motion`, W, H);
  if (o.rotation !== undefined) out.rotation = rotation(o.rotation, `${name}.rotation`, W, H);
  if (o.group !== undefined) {
    const g = num(o.group, `${name}.group`, 1, 1e9);
    if (Number.isInteger(g)) out.group = g;
  }
  if (out.role === 'coin') {
    // Coins are always a 24×24 circle, centered where the shape was
    const c = shapeCenter(out.shape);
    out.shape = { type: 'ellipse', cx: c.x, cy: c.y, rx: LIMITS.coinSize / 2, ry: LIMITS.coinSize / 2 };
  }
  if (out.role === 'path' && o.pierce === true) out.pierce = true;
  if (out.role === 'trigger') out.trigger = trigger(o.trigger, `${name}.trigger`);
  if (out.role === 'door') {
    if (out.shape.type !== 'rect') fail(t('validate.doorRect', { name }));
    out.door = door(o.door, `${name}.door`);
  }
  if (out.role === 'wall' && o.spike !== undefined) {
    const s = obj(o.spike, `${name}.spike`);
    out.spike = {
      angle: num(s.angle, `${name}.spike.angle`, -720, 720),
      reach: num(s.reach, `${name}.spike.reach`, 1, Math.max(W, H)),
      thrustMs: num(s.thrustMs, `${name}.spike.thrustMs`, 10, LIMITS.maxDelay),
      returnMs: num(s.returnMs, `${name}.spike.returnMs`, 10, LIMITS.maxDelay),
      waitMs: num(s.waitMs, `${name}.spike.waitMs`, 0, LIMITS.maxDelay),
      delay: num(s.delay, `${name}.spike.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
    };
    delete out.motion; // a spike's own thrust is its movement
  }
  if (out.role === 'wall' && o.boulder === true && !out.spike) {
    out.boulder = true;
    delete out.rotation; // it spins by rolling
  }
  if (out.role === 'wall' && o.saw !== undefined && !out.spike && !out.boulder) {
    const s = obj(o.saw, `${name}.saw`);
    const kind = oneOf(s.kind, `${name}.saw.kind`, ['disc', 'blade'] as const);
    out.saw = {
      kind,
      clockwise: s.clockwise !== false,
      spin: kind === 'disc' ? num(s.spin, `${name}.saw.spin`, 0, LIMITS.maxRotSpeed) : 0,
      stroke: kind === 'blade' ? num(s.stroke, `${name}.saw.stroke`, 0, Math.max(W, H)) : 0,
      strokeMs: kind === 'blade' ? num(s.strokeMs, `${name}.saw.strokeMs`, 50, LIMITS.maxDelay) : 0,
    };
    delete out.rotation; // a saw's own spin / sawing is its rotation
    const b = shapeBounds(out.shape);
    if (kind === 'disc') {
      // Always a circle
      const r = Math.max(1, Math.min(b.w, b.h) / 2);
      out.shape = { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: r, ry: r };
    } else if (out.shape.type !== 'rect') {
      out.shape = { type: 'rect', ...b };
    }
  }
  if (out.role === 'text') {
    const t = obj(o.text, `${name}.text`);
    if (out.shape.type !== 'rect') out.shape = { type: 'rect', ...shapeBounds(out.shape) };
    const hex8 = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{8}$/.test(v) ? v.toLowerCase() : undefined);
    out.text = {
      text: typeof t.text === 'string' ? t.text.slice(0, 500) : '',
      color: color(t.color, `${name}.text.color`),
      font: typeof t.font === 'string' && /^[\w -]{1,40}$/.test(t.font) ? t.font : 'main',
      size: num(t.size, `${name}.text.size`, 6, 200),
      bold: t.bold === true,
      align: t.align === 'left' || t.align === 'right' ? t.align : 'center',
      outlineWidth: typeof t.outlineWidth === 'number' ? Math.max(0, Math.min(20, t.outlineWidth)) : 3,
    };
    if (t.outline !== undefined) out.text.outline = color(t.outline, `${name}.text.outline`);
    const bg = hex8(t.background);
    if (bg) out.text.background = bg;
    // Effects are optional: a bad value just drops the effect
    const hex6 = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);
    for (const k of ['shadow', 'glow', 'gradient', 'depthColor'] as const) {
      const c = hex6(t[k]);
      if (c) out.text[k] = c;
    }
    if (typeof t.depth === 'number' && t.depth >= 1) out.text.depth = Math.min(30, Math.round(t.depth));
  }
  if (out.role === 'laser') {
    const l = obj(o.laser, `${name}.laser`);
    out.laser = { color: colorIndex(l.color, `${name}.laser.color`), angle: num(l.angle, `${name}.laser.angle`, -720, 720), on: l.on !== false };
    if (l.switchColor !== undefined) out.laser.switchColor = colorIndex(l.switchColor, `${name}.laser.switchColor`);
  }
  if (out.role === 'portal') {
    const p = obj(o.portal, `${name}.portal`);
    out.portal = {
      color: colorIndex(p.color, `${name}.portal.color`),
      order: num(p.order, `${name}.portal.order`, 0, 9999),
      mode: oneOf(p.mode, `${name}.portal.mode`, ['both', 'in', 'out'] as const),
    };
  }
  if (o.link !== undefined && (out.role === 'path' || out.role === 'wall' || out.role === 'coin' || out.role === 'dark' || out.role === 'mirror')) {
    const l = obj(o.link, `${name}.link`);
    out.link = { color: colorIndex(l.color, `${name}.link.color`), action: oneOf(l.action, `${name}.link.action`, ['start', 'stop', 'remove'] as const) };
  }
  return out;
}

function color(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) fail(t('validate.color', { name }));
  return v.toLowerCase();
}

const PATTERNS = ['stripes', 'diagonal', 'dots', 'grid', 'checker', 'wood', 'grass', 'sand', 'metal'] as const satisfies readonly PatternKind[];

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
  if (o.v !== MAP_VERSION) fail(t('validate.mapVersion', { version: String(o.v) }));
  const W = num(o.width, 'width', LIMITS.minSize, LIMITS.maxSize);
  const H = num(o.height, 'height', LIMITS.minSize, LIMITS.maxSize);
  const map: MapData = {
    v: MAP_VERSION,
    name: text(o.name, 'name') || t('map.untitled'),
    author: text(o.author, 'author'),
    width: W,
    height: H,
    start: rect(o.start, 'start', W, H),
    goal: rect(o.goal, 'goal', W, H),
    objects: arr(o.objects, 'objects', LIMITS.maxObjects).map((m, i) => mapObject(m, `objects[${i}]`, W, H)),
  };
  if (o.theme !== undefined) map.theme = theme(o.theme, 'theme');
  const title = text(o.title, 'title').trim();
  if (title) map.title = title;
  if (o.level !== undefined) {
    const level = num(o.level, 'level', 1, LIMITS.maxLevel);
    if (!Number.isInteger(level)) fail(t('validate.levelInteger'));
    map.level = level;
  }
  if (o.difficulty !== undefined) map.difficulty = Math.round(num(o.difficulty, 'difficulty', 1, 10) * 100) / 100;
  if (o.darkness !== undefined) {
    map.darkness = { light: num(obj(o.darkness, 'darkness').light, 'darkness.light', LIMITS.minLight, LIMITS.maxLight) };
  }
  if (o.stars !== undefined) {
    const s = obj(o.stars, 'stars');
    map.stars = {
      three: num(s.three, 'stars.three', 1, LIMITS.maxStarTime),
      two: num(s.two, 'stars.two', 1, LIMITS.maxStarTime),
      one: num(s.one, 'stars.one', 1, LIMITS.maxStarTime),
    };
  }
  return map;
}

/** Validate a map pack (file or share link); every level is validated like a single map */
export function validatePack(input: unknown): MapPack {
  const o = obj(input, 'pack');
  if (o.pack !== PACK_VERSION) fail(t('validate.packVersion', { version: String(o.pack) }));
  const levels = arr(o.levels, 'levels', LIMITS.maxPackLevels).map((m, i) => {
    try {
      return validateMap(m);
    } catch (err) {
      return fail(t('validate.packLevel', { n: i + 1, message: (err as Error).message }));
    }
  });
  if (levels.length === 0) fail(t('validate.packEmpty'));
  return { pack: PACK_VERSION, name: text(o.name, 'name') || t('map.untitledPack'), author: text(o.author, 'author'), levels };
}

/** Does the object (posed at time t) overlap the rect? Checks vertices both ways, good enough for warnings. */
/** Whether the object overlaps the rect's interior; merely touching its edge does not count */
function overlapsRect(m: MapObject, rect: Rect, t: number): boolean {
  const e = Math.min(0.5, rect.w / 4, rect.h / 4);
  const r = { x: rect.x + e, y: rect.y + e, w: rect.w - 2 * e, h: rect.h - 2 * e };
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

/**
 * Problems that make a map unplayable as intended. The editor shows them as errors and won't
 * share the map until they are fixed.
 */
export function mapErrors(map: MapData): string[] {
  const out: string[] = [];
  const colors = new Set(map.objects.filter((o) => o.trigger).map((o) => o.trigger!.color));
  map.objects.forEach((o, i) => {
    const c = o.link?.color ?? (o.door?.mode === 'switch' ? o.door.color : o.laser?.switchColor);
    if (c !== undefined && !colors.has(c)) {
      out.push(t('mapError.noSwitch', { n: i + 1, color: switchColor(c).name }));
    }
    if (o.portal) {
      const p = o.portal;
      const others = map.objects.filter((q, j) => j !== i && q.portal?.color === p.color);
      const name = switchColor(p.color).name;
      if (!others.length) out.push(t('mapError.portalAlone', { n: i + 1, color: name }));
      else if (p.mode !== 'out' && !others.some((q) => q.portal!.mode !== 'in')) out.push(t('mapError.portalNoExit', { n: i + 1, color: name }));
    }
  });
  return out;
}

/** Things that are structurally valid but may cause problems in play */
export function mapWarnings(map: MapData): string[] {
  const out: string[] = [];
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= map.width && r.y + r.h <= map.height;
  if (Math.abs(map.width / map.height - 16 / 9) > 0.01) out.push(t('mapWarn.aspect'));
  if (!inside(map.start)) out.push(t('mapWarn.startOutside'));
  if (!inside(map.goal)) out.push(t('mapWarn.goalOutside'));
  if (overlapsRect({ role: 'wall', shape: { type: 'rect', ...map.start } }, map.goal, 0)) out.push(t('mapWarn.startGoalOverlap'));
  map.objects.forEach((o, i) => {
    if (o.role !== 'wall') return;
    if (overlapsRect(o, map.start, 0)) out.push(t('mapWarn.wallOnStart', { n: i + 1 }));
    if (!o.motion && !o.rotation && overlapsRect(o, map.goal, 0)) out.push(t('mapWarn.wallOnGoal', { n: i + 1 }));
  });
  map.objects.forEach((o, i) => {
    if (o.motion && o.motion.points.length === 0) out.push(t('mapWarn.noMarkers', { n: i + 1 }));
  });
  const s = map.stars;
  if (s && !(s.three <= s.two && s.two <= s.one)) out.push(t('mapWarn.starOrder'));
  map.objects.forEach((o, i) => {
    if (o.role === 'coin' && overlapsRect(o, map.goal, 0)) out.push(t('mapWarn.coinInGoal', { n: i + 1 }));
    if (o.boulder && !o.motion) out.push(t('mapWarn.boulderNoRoute', { n: i + 1 }));
    if (o.link && o.link.action !== 'remove' && !o.motion && !o.rotation && !o.spike) {
      out.push(t(o.link.action === 'start' ? 'mapWarn.linkStartStill' : 'mapWarn.linkStopStill', { n: i + 1 }));
    }
  });
  return out;
}

export function createEmptyMap(): MapData {
  return {
    v: MAP_VERSION,
    name: t('map.new'),
    author: '',
    width: 1920,
    height: 1080,
    start: { x: 60, y: 480, w: 120, h: 120 },
    goal: { x: 1740, y: 480, w: 120, h: 120 },
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
    // A sector spins around its apex like a radar sweep; everything else around its center
    pivot: o.shape.type === 'sector' ? { x: o.shape.cx, y: o.shape.cy } : shapeCenter(o.shape),
    speed: 90,
    angle: 360,
    clockwise: true,
    repeat: 'loop',
    easing: 'none',
    delay: 0,
  };
}
