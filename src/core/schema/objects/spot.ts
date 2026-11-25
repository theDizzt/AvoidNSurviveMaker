import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Spotlight (#88–90): a cone of light from the fixture's center along `angle` (degrees, map space,
 * turning with the object's rotation), `sweep` degrees wide and `range` px long.
 */
export interface Spot {
  angle: number;
  sweep: number;
  range: number;
  /** 0–100 (omitted = 100) */
  intensity?: number;
}

export function createSpotSchema(context: ValidationContext) {
  const { obj, num } = context;

  /** A new spotlight (#88–90): pointing down, 50° wide, 320 px long */
  const DEFAULT_SPOT: Readonly<Spot> = { angle: 90, sweep: 50, range: 320 };
  function validateSpot(o: Record<string, unknown>, out: MapObject, name: string): void {
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
  }

  return { validateSpot, DEFAULT_SPOT };
}
