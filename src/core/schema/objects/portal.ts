import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';

export interface Portal {
  color: number;
  /** Teleports go to the next portal of the same color in this order (then back to the first) */
  order: number;
  /** both · in: entrance only · out: exit only */
  mode: 'both' | 'in' | 'out';
}

export function createPortalSchema(context: ValidationContext) {
  const { obj, num, oneOf, colorIndex } = context;

  function validatePortal(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'portal') {
      const p = obj(o.portal, `${name}.portal`);
      out.portal = {
        color: colorIndex(p.color, `${name}.portal.color`),
        order: num(p.order, `${name}.portal.order`, 0, 9999),
        mode: oneOf(p.mode, `${name}.portal.mode`, ['both', 'in', 'out'] as const),
      };
    }
  }

  return { validatePortal };
}
