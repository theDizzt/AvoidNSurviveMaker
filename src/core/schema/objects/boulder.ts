import { type Wave } from '../motion';
import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

export function createBoulderSchema(_context: ValidationContext) {
  /** A new #30 boulder's route weaves like this (the size of the default 26 px boulder) */
  const DEFAULT_BOULDER_WAVE: Readonly<Wave> = { amplitude: 14, wavelength: 120 };
  function validateBoulder(o: Record<string, unknown>, out: MapObject): void {
    if (out.role === 'wall' && o.boulder === true && !out.spike && !out.fall) {
      out.boulder = true;
      delete out.rotation; // it spins by rolling
    }
  }

  return { validateBoulder, DEFAULT_BOULDER_WAVE };
}
