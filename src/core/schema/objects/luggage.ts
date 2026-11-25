import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

export function createLuggageSchema(_context: ValidationContext) {
  function validateLuggage(out: MapObject): void {
    // A crate's only movement is the belt carrying it
    if (out.role === 'luggage') {
      delete out.motion;
      delete out.rotation;
    }
  }

  return { validateLuggage };
}
