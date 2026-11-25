import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

export function createSecretSchema(context: ValidationContext) {
  const { obj, num } = context;

  /** How far around the cursor a secret wall (#55) shows what lies under it */
  const DEFAULT_SECRET_RADIUS = 60;

  function validateSecret(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'secret') {
      const sw = o.secret === undefined ? {} : obj(o.secret, `${name}.secret`);
      out.secret = { radius: sw.radius === undefined ? DEFAULT_SECRET_RADIUS : num(sw.radius, `${name}.secret.radius`, 1, LIMITS.maxLight) };
    }
  }

  return { validateSecret, DEFAULT_SECRET_RADIUS };
}
