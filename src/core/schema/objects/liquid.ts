import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

/**
 * Pond water (#86), glowing radioactive water (#87), lava (#118), a boiling sulfur spring (#119)
 * or crude oil (#120). All deadly; touching liquids blend where they meet.
 */
export interface Liquid {
  kind: LiquidKind;
}

export const LIQUID_KINDS = ['pond', 'toxic', 'lava', 'sulfur', 'oil'] as const;
export type LiquidKind = (typeof LIQUID_KINDS)[number];

export function createLiquidSchema(context: ValidationContext) {
  const { obj, oneOf } = context;

  function validateLiquid(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'liquid') {
      out.liquid = { kind: oneOf(obj(o.liquid, `${name}.liquid`).kind, `${name}.liquid.kind`, LIQUID_KINDS) };
      delete out.motion;
      delete out.rotation;
    }
  }

  return { validateLiquid };
}
