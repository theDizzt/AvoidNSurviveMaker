import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeBounds } from '../../shape';

/**
 * Round radioactive area around a piece of waste (#116 / #117), centered on it: `min` px wide
 * (radius) at rest, it grows to `max` over `growMs`, stays `holdMs`, shrinks back over `shrinkMs`
 * and rests `restMs`, over and over. Before `delay` ms it rests (a negative delay starts partway).
 */
export interface Aura {
  min: number;
  max: number;
  growMs: number;
  holdMs: number;
  shrinkMs: number;
  restMs: number;
  delay: number;
}

/** Radioactive zone (#115, any shape) or waste: a box (#116) or a drum (#117) with an `aura` */
export interface Rad {
  kind: 'zone' | 'box' | 'drum';
  /** box / drum only */
  aura?: Aura;
}

export function createRadiationSchema(context: ValidationContext) {
  const { obj, num, oneOf } = context;

  function validateRadiation(o: Record<string, unknown>, out: MapObject, name: string): void {
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
  }

  return { validateRadiation };
}
