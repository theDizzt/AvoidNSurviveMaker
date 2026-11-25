import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeBounds } from '../../shape';

/**
 * Saw (a wall): `disc` is a round grinder that spins (#43, #45 on a route), `blade` a rectangular
 * saw blade that saws back and forth along its long side (#44, #46 on a route).
 */
export interface Saw {
  kind: 'disc' | 'blade';
  /** disc: spin direction */
  clockwise: boolean;
  /** disc: spin speed, deg/s */
  spin: number;
  /** blade: how far it saws back and forth (px, end to end) */
  stroke: number;
  /** blade: time for one back-and-forth (ms) */
  strokeMs: number;
}

export function createSawSchema(context: ValidationContext) {
  const { obj, num, oneOf } = context;

  function validateSaw(o: Record<string, unknown>, out: MapObject, name: string, W: number, H: number): void {
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
  }

  return { validateSaw };
}
