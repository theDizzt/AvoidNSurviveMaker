import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeCenter } from '../../shape';

export function createCrystalSchema(_context: ValidationContext) {
  function validateCrystal(out: MapObject): void {
    if (out.role === 'crystal') {
      // Crystal stars are always 48×48, centered where the shape was
      const c = shapeCenter(out.shape);
      const h = LIMITS.crystalSize / 2;
      out.shape = { type: 'rect', x: c.x - h, y: c.y - h, w: LIMITS.crystalSize, h: LIMITS.crystalSize };
    }
  }

  return { validateCrystal };
}
