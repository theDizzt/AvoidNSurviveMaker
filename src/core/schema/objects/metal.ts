import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { shapeBounds } from '../../shape';

export function createMetalSchema(_context: ValidationContext) {
  function validateMetal(out: MapObject): void {
    if (out.role === 'metal') {
      // Magnets move it; it has no route or rotation of its own
      out.shape = (() => {
        const b = shapeBounds(out.shape);
        return { type: 'rect' as const, x: b.x, y: b.y, w: b.w, h: b.h };
      })();
      delete out.motion;
      delete out.rotation;
    }
  }

  return { validateMetal };
}
