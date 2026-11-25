import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { shapeBounds } from '../../shape';

export function createLilySchema(_context: ValidationContext) {
  function validateLily(out: MapObject): void {
    if (out.role === 'lily') {
      // Always round
      const b = shapeBounds(out.shape);
      const r = Math.max(1, Math.min(b.w, b.h) / 2);
      out.shape = { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: r, ry: r };
    }
  }

  return { validateLily };
}
