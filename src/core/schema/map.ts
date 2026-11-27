import { type Point, type Rect, type ZoneShape } from './common';
import { type MapObject, createObjectSchema } from './object';
import { type Theme, createThemeSchema } from './theme';
import { type Translator, t as defaultTranslate } from '../i18n';
import { createValidationContext } from './validation';
import { LIMITS } from './limits';
import { contentHash, uniqueLevelIds } from '../record-identity';
import { pointInPoly, pointInRect } from '../geometry';
import { compileObject, toWorld, transformAt, type Transform } from '../object';
import { createColorsApi } from '../colors';
import { assignObjectIds, objectNumber } from '../object-ids';

export const MAP_VERSION = 2;

/** Clear times (ms) for star ratings: at or under `three` earns 3 stars, and so on. Slower than `one` = no star */
export interface StarTimes {
  three: number;
  two: number;
  one: number;
}

export interface MapData {
  /** Stable within its theme. Retain when moving slots; change when replacing a level. */
  id?: string;
  v: typeof MAP_VERSION;
  /** File name (used for exports); the in-game title is `title` */
  name: string;
  author: string;
  width: number;
  height: number;
  start: Rect;
  goal: Rect;
  /** A round / polygon / freeform START (#63 / #65 / #67) inside `start`; omitted = the rectangle */
  startShape?: ZoneShape;
  /** A round / polygon / freeform GOAL (#64 / #66 / #68) inside `goal`; omitted = the rectangle */
  goalShape?: ZoneShape;
  objects: MapObject[];
  /** Omitted = the built-in default look */
  theme?: Theme;
  /** Named maze design from the containing theme pack. */
  themeDesign?: string;
  /**
   * A bundled theme (official chapter or custom theme preset, by its id) the map wears when played
   * on its own: its badge and music (its maze colors are copied into `theme` when picked).
   * Ignored inside a theme pack, whose own settings apply.
   */
  themeId?: string;
  /** Level title shown in game (falls back to `name`) */
  title?: string;
  /** Level number shown in game, 1–9999 */
  level?: number;
  stars?: StarTimes;
  /** Global darkness (#42). `light` is the optional cursor light radius (0 disables it). */
  darkness?: { light: number; /** 0 = visible, 100 = black outside light sources; legacy default 100 */ intensity?: number };
  /** Difficulty rating 1.00–10.00 shown on level select */
  difficulty?: number;
}

export const PACK_VERSION = 1;

/** Several levels played in order, shared as one file or link */
export interface MapPack {
  pack: typeof PACK_VERSION;
  name: string;
  author: string;
  levels: MapData[];
}

/** Independent localized API; no process-wide locale or browser dependencies. */
export function createValidateApi(t: Translator = defaultTranslate) {
  const context = createValidationContext(t);
  const { obj, num, text, arr, rect, zoneShapeOf } = context;
  const fail: (message: string) => never = context.fail;
  const { switchColor } = createColorsApi(t);
  const { theme } = createThemeSchema(context);
  const { mapObject, DEFAULT_MOTION, defaultRotation, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_ICE_GRIP, DEFAULT_BLINK, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_FIXED, DEFAULT_SPIN, DEFAULT_SPOT, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS } = createObjectSchema(context);

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
  function validateMap(input: unknown): MapData {
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
      ...(o.startShape !== undefined ? { startShape: zoneShapeOf(o.startShape, 'startShape') } : {}),
      ...(o.goalShape !== undefined ? { goalShape: zoneShapeOf(o.goalShape, 'goalShape') } : {}),
      objects: arr(o.objects, 'objects', LIMITS.maxObjects).map((m, i) => mapObject(m, `objects[${i}]`, W, H)),
    };
    assignObjectIds(map.objects);
    if (o.theme !== undefined) map.theme = theme(o.theme, 'theme');
    if (o.themeDesign !== undefined) {
      if (typeof o.themeDesign !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(o.themeDesign)) fail('Invalid theme design id');
      map.themeDesign = o.themeDesign;
    }
    if (o.themeId !== undefined) {
      if (typeof o.themeId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(o.themeId)) fail('Invalid theme id');
      map.themeId = o.themeId;
    }
    if (o.id !== undefined) {
      if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(o.id)) fail('Invalid level id');
      map.id = o.id;
    }
    const title = text(o.title, 'title').trim();
    if (title) map.title = title;
    if (o.level !== undefined) {
      const level = num(o.level, 'level', 1, LIMITS.maxLevel);
      if (!Number.isInteger(level)) fail(t('validate.levelInteger'));
      map.level = level;
    }
    if (o.difficulty !== undefined) map.difficulty = Math.round(num(o.difficulty, 'difficulty', 1, 10) * 100) / 100;
    if (o.darkness !== undefined) {
      const darkness = obj(o.darkness, 'darkness');
      map.darkness = {
        light: num(darkness.light, 'darkness.light', LIMITS.minLight, LIMITS.maxLight),
        ...(darkness.intensity !== undefined ? { intensity: num(darkness.intensity, 'darkness.intensity', 0, 100) } : {}),
      };
    }
    if (o.stars !== undefined) {
      const s = obj(o.stars, 'stars');
      map.stars = {
        three: num(s.three, 'stars.three', 1, LIMITS.maxStarTime),
        two: num(s.two, 'stars.two', 1, LIMITS.maxStarTime),
        one: num(s.one, 'stars.one', 1, LIMITS.maxStarTime),
      };
    }
    map.id ??= map.level !== undefined ? String(map.level - 1) : contentHash(map).slice(0, 32);
    return map;
  }

  /** Validate a map pack (file or share link); every level is validated like a single map */
  function validatePack(input: unknown): MapPack {
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
    return { pack: PACK_VERSION, name: text(o.name, 'name') || t('map.untitledPack'), author: text(o.author, 'author'), levels: uniqueLevelIds(levels) };
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
  function mapErrors(map: MapData): string[] {
    const out: string[] = [];
    const colors = new Set(map.objects.filter((o) => o.trigger).map((o) => o.trigger!.color));
    const pulleys = new Set(map.objects.filter((o) => o.pulley).map((o) => o.pulley!.color));
    const crystals = map.objects.filter((o) => o.role === 'crystal').length;
    if (crystals > LIMITS.maxCrystals) out.push(t('mapError.crystalMany', { n: crystals, max: LIMITS.maxCrystals }));
    map.objects.forEach((o, i) => {
      if (o.link?.action === 'pulley') {
        if (!pulleys.has(o.link.color)) out.push(t('mapError.noPulley', { n: objectNumber(map.objects, i), color: switchColor(o.link.color).name }));
      } else {
        // A laser can both flip with one color and be linked to another; check each
        const used = [o.link?.color ?? (o.door?.mode === 'switch' ? o.door.color : undefined), o.laser?.switchColor];
        for (const c of new Set(used)) if (c !== undefined && !colors.has(c)) {
          out.push(t('mapError.noSwitch', { n: objectNumber(map.objects, i), color: switchColor(c).name }));
        }
      }
      if (o.portal) {
        const p = o.portal;
        const others = map.objects.filter((q, j) => j !== i && q.portal?.color === p.color);
        const name = switchColor(p.color).name;
        if (!others.length) out.push(t('mapError.portalAlone', { n: objectNumber(map.objects, i), color: name }));
        else if (p.mode !== 'out' && !others.some((q) => q.portal!.mode !== 'in')) out.push(t('mapError.portalNoExit', { n: objectNumber(map.objects, i), color: name }));
      }
    });
    return out;
  }

  /** Things that are structurally valid but may cause problems in play */
  function mapWarnings(map: MapData): string[] {
    const out: string[] = [];
    const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= map.width && r.y + r.h <= map.height;
    if (Math.abs(map.width / map.height - 16 / 9) > 0.01) out.push(t('mapWarn.aspect'));
    if (!inside(map.start)) out.push(t('mapWarn.startOutside'));
    if (!inside(map.goal)) out.push(t('mapWarn.goalOutside'));
    if (overlapsRect({ role: 'wall', shape: { type: 'rect', ...map.start } }, map.goal, 0)) out.push(t('mapWarn.startGoalOverlap'));
    map.objects.forEach((o, i) => {
      if (o.role !== 'wall') return;
      if (overlapsRect(o, map.start, 0)) out.push(t('mapWarn.wallOnStart', { n: objectNumber(map.objects, i) }));
      if (!o.motion && !o.rotation && overlapsRect(o, map.goal, 0)) out.push(t('mapWarn.wallOnGoal', { n: objectNumber(map.objects, i) }));
    });
    map.objects.forEach((o, i) => {
      if (o.motion && o.motion.points.length === 0) out.push(t('mapWarn.noMarkers', { n: objectNumber(map.objects, i) }));
    });
    const s = map.stars;
    if (s && !(s.three <= s.two && s.two <= s.one)) out.push(t('mapWarn.starOrder'));
    // Coins stacked on each other look like one but each counts toward the total
    const coinAt = (o: MapObject) => (o.shape.type === 'ellipse' ? { x: o.shape.cx, y: o.shape.cy } : null);
    map.objects.forEach((o, i) => {
      const a = o.role === 'coin' && !o.motion && !o.rotation ? coinAt(o) : null;
      if (!a) return;
      const j = map.objects.findIndex((p, k) => k < i && p.role === 'coin' && !p.motion && !p.rotation
        && ((c) => !!c && Math.hypot(c.x - a.x, c.y - a.y) < LIMITS.coinSize / 2)(coinAt(p)));
      if (j >= 0) out.push(t('mapWarn.coinStacked', { n: objectNumber(map.objects, i), m: objectNumber(map.objects, j) }));
    });
    map.objects.forEach((o, i) => {
      if (o.role === 'coin' && overlapsRect(o, map.goal, 0)) out.push(t('mapWarn.coinInGoal', { n: objectNumber(map.objects, i) }));
      if (o.boulder && !o.motion) out.push(t('mapWarn.boulderNoRoute', { n: objectNumber(map.objects, i) }));
      if (o.link && o.link.action !== 'remove' && !o.motion && !o.rotation && !o.spike) {
        out.push(t(o.link.action === 'start' ? 'mapWarn.linkStartStill' : 'mapWarn.linkStopStill', { n: objectNumber(map.objects, i) }));
      }
    });
    return out;
  }

  function createEmptyMap(): MapData {
    const map: MapData = {
      v: MAP_VERSION,
      name: t('map.new'),
      author: '',
      width: 1920,
      height: 1080,
      start: { x: 60, y: 480, w: 120, h: 120 },
      goal: { x: 1740, y: 480, w: 120, h: 120 },
      objects: [],
    };
    map.id = contentHash(map).slice(0, 32);
    return map;
  }

  return { LIMITS, validateMap, validatePack, mapErrors, mapWarnings, createEmptyMap, DEFAULT_MOTION, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_ICE_GRIP, DEFAULT_BLINK, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_FIXED, DEFAULT_SPIN, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS, DEFAULT_SPOT, defaultRotation };
}
