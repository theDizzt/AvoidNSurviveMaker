import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Falling rock (#51), a wall: waits `waitMs` (not there), then drops from `height` px above its
 * resting place to it in `fallMs` (speeding up like gravity), shatters and is gone; repeats.
 * `delay`: ms before the first wait starts.
 */
export interface Fall {
  height: number;
  fallMs: number;
  waitMs: number;
  delay: number;
}

export function createFallSchema(context: ValidationContext) {
  const { obj, num } = context;

  /** A new falling rock (#51) */
  const DEFAULT_FALL: Readonly<Fall> = { height: 300, fallMs: 600, waitMs: 1200, delay: 0 };
  function validateFall(o: Record<string, unknown>, out: MapObject, name: string, W: number, H: number): void {
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
  }

  return { validateFall, DEFAULT_FALL };
}
