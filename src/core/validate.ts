import { t as defaultTranslate, type Translator } from './i18n';
import { contentHash, uniqueLevelIds } from './record-identity';
import { pointInPoly, pointInRect } from './geometry';
import { compileObject, toWorld, transformAt, type Transform } from './object';
import { createColorsApi } from './colors';
import { normalizeTilt, rotatePoint, shapeBounds, shapeCenter } from './shape';
import { beltPoints, conveyorOutline } from './conveyor';
import { wireOutline } from './electric';
import { GEAR_TEETH, handPivot } from './machines';
import { assignObjectIds, MAX_OBJECT_ID, objectNumber } from './object-ids';
import {
  MAP_VERSION, PACK_VERSION,
  type Door, type Easing, type Fill, type MapData, type MapPack, type Trigger, type TriggerKind, type MapObject, type Motion, type PatternKind, type Point, type PolyPoint, type Rect,
  type Repeat, type Rotation, type RotationTick, type Shape, type SurfaceAnim, type SurfaceStyle, type Theme, type Wave, type Fall, type Pulley, type Turret, type Blink, type ZoneShape, type Conveyor, type Spot, type Power,
} from './types';

export class MapValidationError extends Error {}

/** Independent localized API; no process-wide locale or browser dependencies. */
export function createValidateApi(t: Translator = defaultTranslate) {
  const { switchColor } = createColorsApi(t);


  const LIMITS = {
    minSize: 200,
    maxSize: 4000,
    maxObjects: 2000,
    maxPolyPoints: 256,
    maxMarkers: 64,
    maxSpeed: 5000,
    /** Wavy routes (#30 boulder) */
    maxWaveAmplitude: 500,
    minWavelength: 16,
    maxWavelength: 4000,
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
    /** Crystal stars (#59) are always this size, and a map has at most this many */
    crystalSize: 48,
    maxCrystals: 1,
    /** Turrets (#60) and missile launchers (#61) are always this size (square) */
    turretSize: 60,
    /** Conveyor belts (#69): centerline points, belt width (px) */
    maxBeltPoints: 64,
    /** Wires (#91): points along the cable */
    maxWirePoints: 64,
    minBeltWidth: 20,
    maxBeltWidth: 300,
    maxTurretRange: 4000,
    minFireMs: 50,
    /** Global darkness light radius */
    minLight: 0,
    maxLight: 2000,
    /** Radioactive waste (#116 / #117): largest aura radius (px) */
    maxAura: 2000,
    /** Magnets (#99): farthest pull (px) */
    maxMagnetRange: 2000,
  } as const;

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

  const REPEATS = ['loop', 'pingpong', 'once', 'restart', 'slam'] as const satisfies readonly Repeat[];
  /** 'slam' is for routes only */
  const ROTATION_REPEATS = ['loop', 'pingpong', 'once', 'restart'] as const satisfies readonly Repeat[];
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
      const r = num(o.r, `${name}.r`, 1, Math.max(W, H));
      return {
        type,
        cx: num(o.cx, `${name}.cx`, -W, W * 2),
        cy: num(o.cy, `${name}.cy`, -H, H * 2),
        r,
        start: num(o.start, `${name}.start`, -720, 720),
        sweep: num(o.sweep, `${name}.sweep`, 1, 360),
        ...(o.inner !== undefined ? { inner: num(o.inner, `${name}.inner`, 0.5, Math.max(0.5, r - 0.5)) } : {}),
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
      ...(o.segmentTypes !== undefined ? {
        segmentTypes: arr(o.segmentTypes, `${name}.segmentTypes`, LIMITS.maxMarkers + 1)
          .map((v, i) => oneOf(v, `${name}.segmentTypes[${i}]`, ['linear', 'curve'] as const)),
      } : {}),
      speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxSpeed),
      repeat: oneOf(o.repeat, `${name}.repeat`, REPEATS),
      ...(o.returnSpeed !== undefined ? { returnSpeed: num(o.returnSpeed, `${name}.returnSpeed`, 1, LIMITS.maxSpeed) } : {}),
      easing: oneOf(o.easing, `${name}.easing`, EASINGS),
      delay: num(o.delay, `${name}.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      clockwise: bool(o.clockwise, `${name}.clockwise`),
      ...(o.showPath === true ? { showPath: true } : {}),
      ...(o.wave !== undefined ? { wave: wave(o.wave, `${name}.wave`) } : {}),
    };
  }

  function wave(v: unknown, name: string): Wave {
    const o = obj(v, name);
    return {
      amplitude: num(o.amplitude, `${name}.amplitude`, 0, LIMITS.maxWaveAmplitude),
      wavelength: num(o.wavelength, `${name}.wavelength`, LIMITS.minWavelength, LIMITS.maxWavelength),
    };
  }

  function rotation(v: unknown, name: string, W: number, H: number): Rotation {
    const o = obj(v, name);
    return {
      pivot: point(o.pivot, `${name}.pivot`, W, H),
      speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxRotSpeed),
      angle: num(o.angle, `${name}.angle`, 0, LIMITS.maxAngle),
      clockwise: bool(o.clockwise, `${name}.clockwise`),
      repeat: oneOf(o.repeat, `${name}.repeat`, ROTATION_REPEATS),
      easing: oneOf(o.easing, `${name}.easing`, EASINGS),
      delay: num(o.delay, `${name}.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      ...(o.showPivot === true ? { showPivot: true } : {}),
      ...(o.tick !== undefined ? { tick: tick(o.tick, `${name}.tick`) } : {}),
    };
  }

  function tick(v: unknown, name: string): RotationTick {
    const o = obj(v, name);
    return {
      angle: num(o.angle, `${name}.angle`, 0.1, 360),
      moveMs: num(o.moveMs, `${name}.moveMs`, 0, LIMITS.maxDelay),
      waitMs: num(o.waitMs, `${name}.waitMs`, 0, LIMITS.maxDelay),
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
    const momentary = o.momentary === true && kind === 'switch';
    if (momentary) t.momentary = true;
    if (o.click === true && (kind === 'switch' || kind === 'timer') && !momentary) t.click = true;
    if (o.initial === true && (kind === 'switch' || kind === 'hold') && !momentary) t.initial = true;
    if (o.once === true && kind !== 'startZone' && kind !== 'stopZone' && !momentary) t.once = true;
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

  /** A START / GOAL shape (#63–68): in 0–1 coordinates inside the zone's rectangle */
  function zoneShapeOf(v: unknown, name: string): ZoneShape {
    const o = obj(v, name);
    const type = oneOf(o.type, `${name}.type`, ['ellipse', 'poly'] as const);
    if (type === 'ellipse') return { type };
    const points = arr(o.points, `${name}.points`, LIMITS.maxPolyPoints).map((p, i) => {
      const q = obj(p, `${name}.points[${i}]`);
      const out: PolyPoint = { x: num(q.x, `${name}.points[${i}].x`, 0, 1), y: num(q.y, `${name}.points[${i}].y`, 0, 1) };
      if (q.smooth === true) out.smooth = true;
      return out;
    });
    if (points.length < 3) fail(t('validate.polyPoints', { name }));
    return { type, points, ...(o.free === true ? { free: true } : {}) };
  }

  function mapObject(v: unknown, name: string, W: number, H: number): MapObject {
    const o = obj(v, name);
    const out: MapObject = {
      role: oneOf(o.role, `${name}.role`, ['path', 'wall', 'coin', 'dark', 'trigger', 'door', 'laser', 'mirror', 'portal', 'text', 'safe', 'fog', 'torch', 'secret', 'crystal', 'pulley', 'turret', 'conveyor', 'luggage', 'liquid', 'lily', 'spot', 'wire', 'power', 'rad', 'metal', 'magnet'] as const),
      shape: shape(o.shape, `${name}.shape`, W, H),
    };
    if (o.motion !== undefined) out.motion = motion(o.motion, `${name}.motion`, W, H);
    if (o.rotation !== undefined) out.rotation = rotation(o.rotation, `${name}.rotation`, W, H);
    if (o.tilt !== undefined) {
      const tilt = normalizeTilt(num(o.tilt, `${name}.tilt`, -720, 720));
      if (tilt) out.tilt = tilt;
    }
    if (o.group !== undefined) {
      const g = num(o.group, `${name}.group`, 1, 1e9);
      if (Number.isInteger(g)) out.group = g;
    }
    // A bad or repeated id is replaced (assignObjectIds), not an error
    if (typeof o.id === 'number' && Number.isInteger(o.id) && o.id >= 1 && o.id <= MAX_OBJECT_ID) out.id = o.id;
    if (out.role === 'coin') {
      // Coins are always a 24×24 circle, centered where the shape was
      const c = shapeCenter(out.shape);
      out.shape = { type: 'ellipse', cx: c.x, cy: c.y, rx: LIMITS.coinSize / 2, ry: LIMITS.coinSize / 2 };
    }
    if (out.role === 'crystal') {
      // Crystal stars are always 48×48, centered where the shape was
      const c = shapeCenter(out.shape);
      const h = LIMITS.crystalSize / 2;
      out.shape = { type: 'rect', x: c.x - h, y: c.y - h, w: LIMITS.crystalSize, h: LIMITS.crystalSize };
    }
    if (out.role === 'turret') {
      // Always a 60×60 square, centered where the shape was
      const c = shapeCenter(out.shape);
      const h = LIMITS.turretSize / 2;
      out.shape = { type: 'rect', x: c.x - h, y: c.y - h, w: LIMITS.turretSize, h: LIMITS.turretSize };
      const tu = obj(o.turret, `${name}.turret`);
      const kind = oneOf(tu.kind, `${name}.turret.kind`, ['gun', 'missile'] as const);
      const d = kind === 'gun' ? DEFAULT_GUN : DEFAULT_MISSILE;
      const opt = (k: keyof Turret, min: number, max: number) => (tu[k] === undefined ? d[k] as number : num(tu[k], `${name}.turret.${k}`, min, max));
      out.turret = {
        kind,
        range: opt('range', 1, LIMITS.maxTurretRange),
        fireMs: opt('fireMs', LIMITS.minFireMs, LIMITS.maxDelay),
        speed: opt('speed', 1, LIMITS.maxSpeed),
        angle: opt('angle', -720, 720),
        arc: opt('arc', 0, 360),
        turnSpeed: opt('turnSpeed', 0, LIMITS.maxRotSpeed),
        lifeMs: opt('lifeMs', 100, LIMITS.maxDelay),
        pierce: tu.pierce === true,
      };
    }
    if (out.role === 'conveyor') {
      const c = obj(o.conveyor, `${name}.conveyor`);
      const conveyor: Conveyor = {
        points: arr(c.points, `${name}.conveyor.points`, LIMITS.maxBeltPoints).map((p, i) => point(p, `${name}.conveyor.points[${i}]`, W, H)),
        loop: c.loop === true,
        width: num(c.width, `${name}.conveyor.width`, LIMITS.minBeltWidth, LIMITS.maxBeltWidth),
        speed: num(c.speed, `${name}.conveyor.speed`, 1, LIMITS.maxSpeed),
        ...(c.reverse === true ? { reverse: true } : {}),
      };
      if (beltPoints(conveyor).length < 2) fail(t('validate.beltPoints', { name }));
      out.conveyor = conveyor;
      // The belt's shape always comes from its centerline; it stays where it is drawn
      out.shape = { type: 'poly', points: conveyorOutline(conveyor) };
      delete out.motion;
      delete out.rotation;
      delete out.tilt;
    }
    // A crate's only movement is the belt carrying it
    if (out.role === 'luggage') {
      delete out.motion;
      delete out.rotation;
    }
    if (out.role === 'wire') {
      const w = obj(o.wire, `${name}.wire`);
      const points = arr(w.points, `${name}.wire.points`, LIMITS.maxWirePoints).map((p, i) => point(p, `${name}.wire.points[${i}]`, W, H));
      if (beltPoints({ points, loop: false }).length < 2) fail(t('validate.beltPoints', { name }));
      out.wire = { points };
      // The cable's shape always comes from its points; wires don't move
      out.shape = { type: 'poly', points: wireOutline(out.wire) };
      delete out.motion;
      delete out.rotation;
      delete out.tilt;
    }
    if (out.role === 'power') {
      const p = obj(o.power, `${name}.power`);
      const kind = oneOf(p.kind, `${name}.power.kind`, ['switch', 'timer', 'pulley', 'inverter'] as const);
      const power: Power = { kind };
      const momentary = p.momentary === true && kind === 'switch';
      if (momentary) power.momentary = true;
      if (p.click === true && (kind === 'switch' || kind === 'timer') && !momentary) power.click = true;
      if (p.initial === true && kind === 'switch' && !momentary) power.initial = true;
      if (p.once === true && (kind === 'switch' || kind === 'timer') && !momentary) power.once = true;
      if (kind === 'timer') power.duration = num(p.duration, `${name}.power.duration`, 50, LIMITS.maxDelay);
      out.power = power;
      // Electric devices stay where they are placed (the wires are joined to them there)
      delete out.motion;
      delete out.rotation;
    }
    if (out.role === 'liquid') {
      out.liquid = { kind: oneOf(obj(o.liquid, `${name}.liquid`).kind, `${name}.liquid.kind`, ['pond', 'toxic'] as const) };
      delete out.motion;
      delete out.rotation;
    }
    if (out.role === 'lily') {
      // Always round
      const b = shapeBounds(out.shape);
      const r = Math.max(1, Math.min(b.w, b.h) / 2);
      out.shape = { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: r, ry: r };
    }
    if (out.role === 'metal') {
      // Magnets move it; it has no route or rotation of its own
      out.shape = (() => {
        const b = shapeBounds(out.shape);
        return { type: 'rect' as const, x: b.x, y: b.y, w: b.w, h: b.h };
      })();
      delete out.motion;
      delete out.rotation;
    }
    if (out.role === 'magnet') {
      const g = obj(o.magnet, `${name}.magnet`);
      out.magnet = {
        range: num(g.range, `${name}.magnet.range`, 1, LIMITS.maxMagnetRange),
        strength: num(g.strength, `${name}.magnet.strength`, 0, LIMITS.maxSpeed),
        cursor: g.cursor !== false,
        metal: g.metal !== false,
      };
    }
    if (out.role === 'rad') {
      const r = obj(o.rad, `${name}.rad`);
      const kind = oneOf(r.kind, `${name}.rad.kind`, ['zone', 'box', 'drum'] as const);
      out.rad = { kind };
      if (kind !== 'zone') {
        const a = obj(r.aura, `${name}.rad.aura`);
        const ms = (v: unknown, key: string, min = 0) => num(v, `${name}.rad.aura.${key}`, min, LIMITS.maxDelay);
        out.rad.aura = {
          min: num(a.min, `${name}.rad.aura.min`, 0, LIMITS.maxAura),
          max: num(a.max, `${name}.rad.aura.max`, 0, LIMITS.maxAura),
          growMs: ms(a.growMs, 'growMs'),
          holdMs: ms(a.holdMs, 'holdMs'),
          shrinkMs: ms(a.shrinkMs, 'shrinkMs'),
          restMs: ms(a.restMs, 'restMs'),
          delay: num(a.delay, `${name}.rad.aura.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
        };
        const b = shapeBounds(out.shape);
        // A box is a rectangle, a drum is round
        if (kind === 'box' && out.shape.type !== 'rect') out.shape = { type: 'rect', x: b.x, y: b.y, w: b.w, h: b.h };
        if (kind === 'drum') {
          const rr = Math.max(1, Math.min(b.w, b.h) / 2);
          out.shape = { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: rr, ry: rr };
        }
      }
    }
    if (out.role === 'spot') {
      const s = obj(o.spot, `${name}.spot`);
      const spot: Spot = {
        angle: num(s.angle, `${name}.spot.angle`, -720, 720),
        sweep: num(s.sweep, `${name}.spot.sweep`, 1, 360),
        range: num(s.range, `${name}.spot.range`, 1, LIMITS.maxLight),
      };
      if (s.intensity !== undefined) spot.intensity = num(s.intensity, `${name}.spot.intensity`, 0, 100);
      out.spot = spot;
    }
    if (out.role === 'path' && o.pierce === true) out.pierce = true;
    if (out.role === 'path' && o.ice !== undefined) out.ice = { grip: num(obj(o.ice, `${name}.ice`).grip, `${name}.ice.grip`, 1, 100) };
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
    if (out.role === 'wall' && o.fall !== undefined && !out.spike) {
      const f = obj(o.fall, `${name}.fall`);
      out.fall = {
        height: num(f.height, `${name}.fall.height`, 1, Math.max(W, H) * 2),
        fallMs: num(f.fallMs, `${name}.fall.fallMs`, 50, LIMITS.maxDelay),
        waitMs: num(f.waitMs, `${name}.fall.waitMs`, 0, LIMITS.maxDelay),
        delay: num(f.delay, `${name}.fall.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      // It only drops: no route or rotation of its own
      delete out.motion;
      delete out.rotation;
    }
    if ((out.role === 'path' || out.role === 'wall') && o.blink !== undefined) {
      const b = obj(o.blink, `${name}.blink`);
      out.blink = {
        onMs: num(b.onMs, `${name}.blink.onMs`, 50, LIMITS.maxDelay),
        offMs: num(b.offMs, `${name}.blink.offMs`, 0, LIMITS.maxDelay),
        delay: num(b.delay, `${name}.blink.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      // Ice never blinks (#71–74, #100–110)
      if (out.ice) delete out.blink;
    }
    if (out.role === 'pulley') {
      const pl = obj(o.pulley, `${name}.pulley`);
      out.pulley = {
        color: colorIndex(pl.color, `${name}.pulley.color`),
        mode: oneOf(pl.mode, `${name}.pulley.mode`, ['hold', 'unwind'] as const),
        turnMs: num(pl.turnMs, `${name}.pulley.turnMs`, 50, LIMITS.maxDelay),
        unwind: num(pl.unwind, `${name}.pulley.unwind`, 0, 100),
      };
    }
    if (out.role === 'wall' && o.boulder === true && !out.spike && !out.fall) {
      out.boulder = true;
      delete out.rotation; // it spins by rolling
    }
    if (out.role === 'wall' && o.saw !== undefined && !out.spike && !out.boulder && !out.fall) {
      const s = obj(o.saw, `${name}.saw`);
      const kind = oneOf(s.kind, `${name}.saw.kind`, ['disc', 'blade'] as const);
      out.saw = {
        kind,
        clockwise: s.clockwise !== false,
        spin: kind === 'disc' ? num(s.spin, `${name}.saw.spin`, 0, LIMITS.maxRotSpeed) : 0,
        stroke: kind === 'blade' ? num(s.stroke, `${name}.saw.stroke`, 0, Math.max(W, H)) : 0,
        strokeMs: kind === 'blade' ? num(s.strokeMs, `${name}.saw.strokeMs`, 50, LIMITS.maxDelay) : 0,
      };
      const b = shapeBounds(out.shape);
      if (kind === 'disc') {
        // Always a circle
        const r = Math.max(1, Math.min(b.w, b.h) / 2);
        out.shape = { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: r, ry: r };
      } else if (out.shape.type !== 'rect') {
        out.shape = { type: 'rect', ...b };
      }
    }
    // Thorn vine (#83 / #84): an area shape whose outline grows thorns
    if (out.role === 'wall' && o.vine === true && !out.spike && !out.boulder && !out.fall && !out.saw && out.shape.type !== 'sector') out.vine = true;
    // Machines (#111–114): walls built from their box, one kind at a time
    const plainWall = out.role === 'wall' && !out.spike && !out.boulder && !out.fall && !out.saw && !out.vine;
    const box = () => {
      const b = shapeBounds(out.shape);
      return { type: 'rect' as const, x: b.x, y: b.y, w: b.w, h: b.h };
    };
    if (plainWall && o.gear !== undefined) {
      const g = obj(o.gear, `${name}.gear`);
      out.gear = { teeth: Math.round(num(g.teeth, `${name}.gear.teeth`, GEAR_TEETH.min, GEAR_TEETH.max)), depth: num(g.depth, `${name}.gear.depth`, 1, 80) };
      // Always square
      const b = box();
      const s = Math.min(b.w, b.h);
      out.shape = { type: 'rect', x: b.x + (b.w - s) / 2, y: b.y + (b.h - s) / 2, w: s, h: s };
    } else if (plainWall && o.hand === true) {
      out.hand = true;
      out.shape = box();
    } else if (plainWall && o.pendulum !== undefined) {
      const p = obj(o.pendulum, `${name}.pendulum`);
      out.pendulum = {
        amplitude: num(p.amplitude, `${name}.pendulum.amplitude`, 0, 180),
        periodMs: num(p.periodMs, `${name}.pendulum.periodMs`, 50, LIMITS.maxDelay),
        delay: num(p.delay, `${name}.pendulum.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      out.shape = box();
      // It swings on its own (its pivot can still travel along a route)
      delete out.rotation;
    } else if (plainWall && o.press !== undefined) {
      const p = obj(o.press, `${name}.press`);
      const ms = (v: unknown, key: string) => num(v, `${name}.press.${key}`, 0, LIMITS.maxDelay);
      out.press = {
        reach: num(p.reach, `${name}.press.reach`, 1, Math.max(W, H)),
        downMs: ms(p.downMs, 'downMs'),
        holdMs: ms(p.holdMs, 'holdMs'),
        upMs: ms(p.upMs, 'upMs'),
        waitMs: ms(p.waitMs, 'waitMs'),
        delay: num(p.delay, `${name}.press.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      out.shape = box();
      // Its slam is its movement; its cylinder stays put
      delete out.motion;
      delete out.rotation;
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
    if (out.role === 'fog') {
      const f = obj(o.fog, `${name}.fog`);
      out.fog = { kind: oneOf(f.kind, `${name}.fog.kind`, ['fog', 'sand'] as const), density: num(f.density, `${name}.fog.density`, 0, 100) };
    }
    if (o.link !== undefined && (out.role === 'path' || out.role === 'wall' || out.role === 'coin' || out.role === 'dark' || out.role === 'fog' || out.role === 'mirror' || out.role === 'laser' || out.role === 'turret'
      || out.role === 'liquid' || out.role === 'lily' || out.role === 'spot' || out.role === 'rad' || out.role === 'magnet')) {
      const l = obj(o.link, `${name}.link`);
      out.link = { color: colorIndex(l.color, `${name}.link.color`), action: oneOf(l.action, `${name}.link.action`, ['start', 'stop', 'remove', 'pulley'] as const) };
    }
    if (o.elec !== undefined && out.role !== 'wire' && out.role !== 'power') {
      out.elec = { action: oneOf(obj(o.elec, `${name}.elec`).action, `${name}.elec.action`, ['start', 'stop', 'remove', 'show'] as const) };
    }
    if (o.light !== undefined) {
      const light = obj(o.light, `${name}.light`);
      out.light = {
        radius: num(light.radius, `${name}.light.radius`, 0, LIMITS.maxLight),
        ...(light.intensity !== undefined ? { intensity: num(light.intensity, `${name}.light.intensity`, 0, 100) } : {}),
      };
    }
    if (out.role === 'torch') {
      if (o.torch !== undefined && obj(o.torch, `${name}.torch`).carry === true) out.torch = { carry: true };
      // A torch always gives light
      out.light ??= { radius: DEFAULT_TORCH_LIGHT };
    }
    if (out.role === 'secret') {
      const sw = o.secret === undefined ? {} : obj(o.secret, `${name}.secret`);
      out.secret = { radius: sw.radius === undefined ? DEFAULT_SECRET_RADIUS : num(sw.radius, `${name}.secret.radius`, 1, LIMITS.maxLight) };
    }
    return out;
  }

  function color(v: unknown, name: string): string {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) fail(t('validate.color', { name }));
    return v.toLowerCase();
  }

  const PATTERNS = ['stripes', 'diagonal', 'dots', 'grid', 'checker', 'wood', 'grass', 'sand', 'metal', 'egyptian', 'sandBrick', 'bark', 'woodGrain', 'thicket', 'mud', 'soil', 'snow', 'snowDirt', 'snowPile', 'ice', 'iceCrystal', 'concrete', 'epoxy', 'clouds', 'cloudBank', 'basalt', 'hotrock', 'magma'] as const satisfies readonly PatternKind[];

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
      size: num(o.size, `${name}.size`, 4, 256),
    };
  }

  function surface(v: unknown, name: string): SurfaceStyle {
    const o = obj(v, name);
    const out: SurfaceStyle = { fill: fill(o.fill, `${name}.fill`), edge: color(o.edge, `${name}.edge`) };
    const anim = surfaceAnim(o.anim);
    if (anim) out.anim = anim;
    if (o.line !== undefined) {
      const l = obj(o.line, `${name}.line`);
      out.line = { color: color(l.color, `${name}.line.color`), width: num(l.width, `${name}.line.width`, 1, 40), inset: num(l.inset, `${name}.line.inset`, 0, 80) };
    }
    if (o.glow !== undefined) {
      const gl = obj(o.glow, `${name}.glow`);
      out.glow = { color: color(gl.color, `${name}.glow.color`), width: num(gl.width, `${name}.glow.width`, 1, 200) };
    }
    return out;
  }

  /** A surface animation, read leniently (unknown = none) */
  function surfaceAnim(v: unknown): SurfaceAnim | undefined {
    if (typeof v !== 'object' || v === null) return undefined;
    const a = v as Record<string, unknown>;
    if (a.type !== 'pulse' && a.type !== 'color' && a.type !== 'scroll') return undefined;
    const n = (x: unknown, min: number, max: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d);
    const out: SurfaceAnim = {
      type: a.type,
      speed: a.type === 'scroll' ? n(a.speed, 1, 400, 30) : n(a.speed, 0.05, 5, 0.5),
      amount: n(a.amount, 0, 1, 0.5),
    };
    if (typeof a.color === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(a.color)) out.color = a.color.toLowerCase();
    if (a.type === 'scroll') out.angle = n(a.angle, -360, 360, 0);
    return out;
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

  const DEFAULT_MOTION: Readonly<Motion> = {
    type: 'linear',
    points: [],
    speed: 150,
    repeat: 'pingpong',
    easing: 'inOut',
    delay: 0,
    clockwise: true,
  };

  /** A new #30 boulder's route weaves like this (the size of the default 26 px boulder) */
  const DEFAULT_BOULDER_WAVE: Readonly<Wave> = { amplitude: 14, wavelength: 120 };
  /** A new falling rock (#51) */
  const DEFAULT_FALL: Readonly<Fall> = { height: 300, fallMs: 600, waitMs: 1200, delay: 0 };
  /** A new pulley's settings, besides its color (#52) */
  const DEFAULT_PULLEY: Readonly<Omit<Pulley, 'color'>> = { mode: 'hold', turnMs: 1000, unwind: 50 };
  /** A new ice floor (#71–74) */
  const DEFAULT_ICE_GRIP = 25;
  /** A new blinking path / wall (#75–82) */
  const DEFAULT_BLINK: Readonly<Blink> = { onMs: 1500, offMs: 1000, delay: 0 };
  /** A new turret (#60) / missile launcher (#61) */
  const DEFAULT_GUN: Readonly<Turret> = { kind: 'gun', range: 300, fireMs: 800, speed: 320, angle: 0, arc: 360, turnSpeed: 180, lifeMs: 5000, pierce: false };
  const DEFAULT_MISSILE: Readonly<Turret> = { kind: 'missile', range: 400, fireMs: 2500, speed: 200, angle: -90, arc: 360, turnSpeed: 120, lifeMs: 5000, pierce: false };
  /** A new spotlight (#88–90): pointing down, 50° wide, 320 px long */
  const DEFAULT_SPOT: Readonly<Spot> = { angle: 90, sweep: 50, range: 320 };
  /** Light radius of a new torch (#57 / #58) */
  const DEFAULT_TORCH_LIGHT = 120;
  /** How far around the cursor a secret wall (#55) shows what lies under it */
  const DEFAULT_SECRET_RADIUS = 60;

  function defaultRotation(o: MapObject): Rotation {
    return {
      // A sector spins around its apex like a radar sweep, a clock hand around its hub; everything else around its center
      pivot: o.shape.type === 'sector' ? { x: o.shape.cx, y: o.shape.cy }
        : o.hand && o.shape.type === 'rect' ? rotatePoint(handPivot(o.shape), shapeCenter(o.shape), o.tilt ?? 0) : shapeCenter(o.shape),
      speed: 90,
      angle: 360,
      clockwise: true,
      repeat: 'loop',
      easing: 'none',
      delay: 0,
    };
  }
  return { LIMITS, validateMap, validatePack, mapErrors, mapWarnings, createEmptyMap, DEFAULT_MOTION, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_ICE_GRIP, DEFAULT_BLINK, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS, DEFAULT_SPOT, defaultRotation };
}

export const { LIMITS, validateMap, validatePack, mapErrors, mapWarnings, createEmptyMap, DEFAULT_MOTION, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_ICE_GRIP, DEFAULT_BLINK, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS, DEFAULT_SPOT, defaultRotation } = createValidateApi();
