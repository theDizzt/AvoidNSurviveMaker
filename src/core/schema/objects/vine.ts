import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

export function createVineSchema(_context: ValidationContext) {
  function validateVine(o: Record<string, unknown>, out: MapObject): void {
    // Thorn vine (#83 / #84): an area shape whose outline grows thorns
    if (out.role === 'wall' && o.vine === true && !out.spike && !out.boulder && !out.fall && !out.saw && out.shape.type !== 'sector') out.vine = true;
  }

  return { validateVine };
}
