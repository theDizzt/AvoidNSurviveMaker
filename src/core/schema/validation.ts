import { type Point, type Rect, type PolyPoint, type Shape, type ZoneShape } from './common';
import { type Translator } from '../i18n';
import { LIMITS } from './limits';

export class MapValidationError extends Error {}

export function createValidationContext(t: Translator) {
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

  function colorIndex(v: unknown, name: string): number {
    const c = num(v, name, 0, 15);
    if (!Number.isInteger(c)) fail(t('validate.colorIndex', { name }));
    return c;
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

  function color(v: unknown, name: string): string {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) fail(t('validate.color', { name }));
    return v.toLowerCase();
  }

  return { t, fail, obj, num, text, arr, oneOf, bool, rect, point, shape, colorIndex, zoneShapeOf, color };
}

export type ValidationContext = ReturnType<typeof createValidationContext>;
