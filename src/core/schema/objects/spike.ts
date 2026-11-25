import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/** Spike stake (a wall): waits, thrusts out fast along `angle`, then slowly slides back */
export interface Spike {
  /** Thrust direction in degrees (0 = right, 90 = down) */
  angle: number;
  /** How far it thrusts */
  reach: number;
  thrustMs: number;
  returnMs: number;
  /** Rest time between thrusts */
  waitMs: number;
  /** ms before the first thrust (negative = start partway through) */
  delay: number;
}

export function createSpikeSchema(context: ValidationContext) {
  const { obj, num } = context;

  function validateSpike(o: Record<string, unknown>, out: MapObject, name: string, W: number, H: number): void {
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
  }

  return { validateSpike };
}
