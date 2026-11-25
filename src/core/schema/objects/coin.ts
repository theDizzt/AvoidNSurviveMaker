import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeCenter } from '../../shape';

export function createCoinSchema(_context: ValidationContext) {
  function validateCoin(out: MapObject): void {
    if (out.role === 'coin') {
      // Coins are always a 24×24 circle, centered where the shape was
      const c = shapeCenter(out.shape);
      out.shape = { type: 'ellipse', cx: c.x, cy: c.y, rx: LIMITS.coinSize / 2, ry: LIMITS.coinSize / 2 };
    }
  }

  return { validateCoin };
}
