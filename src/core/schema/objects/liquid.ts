import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

/** Pond water (#86) or glowing radioactive water (#87). Touching liquids blend where they meet. */
export interface Liquid {
  kind: 'pond' | 'toxic';
}

export function createLiquidSchema(context: ValidationContext) {
  const { obj, oneOf } = context;

  function validateLiquid(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'liquid') {
      out.liquid = { kind: oneOf(obj(o.liquid, `${name}.liquid`).kind, `${name}.liquid.kind`, ['pond', 'toxic'] as const) };
      delete out.motion;
      delete out.rotation;
    }
  }

  return { validateLiquid };
}
