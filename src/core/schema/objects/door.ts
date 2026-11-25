import { type MapObject } from '../object';
import { type SwitchColor } from './trigger';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Sliding door: the rectangle splits in two along its long side and both halves slide apart.
 * auto: opens and closes by itself on a cycle · switch: open while its color is ON.
 */
export interface Door {
  mode: 'auto' | 'switch';
  color: SwitchColor;
  /** Time to open or close fully (ms) */
  moveMs: number;
  /** auto: time spent fully open and fully closed (ms) */
  waitMs: number;
}

export function createDoorSchema(context: ValidationContext) {
  const { t, fail, obj, num, oneOf, colorIndex } = context;

  function door(v: unknown, name: string): Door {
    const o = obj(v, name);
    return {
      mode: oneOf(o.mode, `${name}.mode`, ['auto', 'switch'] as const),
      color: colorIndex(o.color, `${name}.color`),
      moveMs: num(o.moveMs, `${name}.moveMs`, 50, LIMITS.maxDelay),
      waitMs: num(o.waitMs, `${name}.waitMs`, 0, LIMITS.maxDelay),
    };
  }

  function validateDoor(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'door') {
      if (out.shape.type !== 'rect') fail(t('validate.doorRect', { name }));
      out.door = door(o.door, `${name}.door`);
    }
  }

  return { validateDoor };
}
