import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

/**
 * Ice (#71–74, #100–110), on a path: while the cursor is on it, it keeps sliding — its velocity only slowly
 * follows the mouse's, so it drifts on after the mouse stops and lags behind a change of direction.
 * `grip` 1–100: how quickly it catches up (higher = less slippery).
 */
export interface Ice {
  grip: number;
}

export function createPathSchema(context: ValidationContext) {
  const { obj, num } = context;

  /** A new ice floor (#71–74) */
  const DEFAULT_ICE_GRIP = 25;
  function validatePath(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'path' && o.pierce === true) out.pierce = true;
    if (out.role === 'path' && o.ice !== undefined) out.ice = { grip: num(obj(o.ice, `${name}.ice`).grip, `${name}.ice.grip`, 1, 100) };
  }

  return { validatePath, DEFAULT_ICE_GRIP };
}
