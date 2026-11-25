import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Magnet (#99): while on, it pulls what lies within `range` px of its center toward it, at up to
 * `strength` px/s (strongest next to it, nothing at the edge of its range). The cursor is pulled
 * like on ice (it drifts off the mouse); metal boxes (#98) slide until something stops them.
 * On unless a switch link or a wire says otherwise.
 */
export interface Magnet {
  range: number;
  strength: number;
  cursor: boolean;
  metal: boolean;
}

export function createMagnetSchema(context: ValidationContext) {
  const { obj, num } = context;

  function validateMagnet(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'magnet') {
      const g = obj(o.magnet, `${name}.magnet`);
      out.magnet = {
        range: num(g.range, `${name}.magnet.range`, 1, LIMITS.maxMagnetRange),
        strength: num(g.strength, `${name}.magnet.strength`, 0, LIMITS.maxSpeed),
        cursor: g.cursor !== false,
        metal: g.metal !== false,
      };
    }
  }

  return { validateMagnet };
}
