import { type MapObject } from '../object';
import { type SwitchColor } from './trigger';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Pulley (#52): turned by circling the cursor inside it. One clockwise turn moves the objects
 * linked to its color (action 'pulley') `turnMs` ms forward along their motion; counter-clockwise
 * moves them back (never before the start). `hold`: they stay put when it isn't turned; `unwind`:
 * they slowly run back to the start, at `unwind` % of real time.
 */
export interface Pulley {
  color: SwitchColor;
  mode: 'hold' | 'unwind';
  turnMs: number;
  unwind: number;
}

export function createPulleySchema(context: ValidationContext) {
  const { obj, num, oneOf, colorIndex } = context;

  /** A new pulley's settings, besides its color (#52) */
  const DEFAULT_PULLEY: Readonly<Omit<Pulley, 'color'>> = { mode: 'hold', turnMs: 1000, unwind: 50 };
  function validatePulley(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'pulley') {
      const pl = obj(o.pulley, `${name}.pulley`);
      out.pulley = {
        color: colorIndex(pl.color, `${name}.pulley.color`),
        mode: oneOf(pl.mode, `${name}.pulley.mode`, ['hold', 'unwind'] as const),
        turnMs: num(pl.turnMs, `${name}.pulley.turnMs`, 50, LIMITS.maxDelay),
        unwind: num(pl.unwind, `${name}.pulley.unwind`, 0, 100),
      };
    }
  }

  return { validatePulley, DEFAULT_PULLEY };
}
