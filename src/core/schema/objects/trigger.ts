import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';

/**
 * Switch colors 0–15 (SWITCH_COLORS). Every trigger drives the channel of its color, and objects
 * linked to that color react to the channel being ON or OFF.
 */
export type SwitchColor = number;

/**
 * - switch: each activation toggles its color ON / OFF
 * - timer: activation turns its color ON for `duration` ms, then OFF
 * - hold: toggles its color after the cursor stays on it for `duration` ms
 * - startZone / stopZone: entering it turns its color ON / OFF
 */
export type TriggerKind = 'switch' | 'timer' | 'hold' | 'startZone' | 'stopZone';

export interface Trigger {
  kind: TriggerKind;
  color: SwitchColor;
  /** switch / timer: activate by clicking on it (instead of touching it) */
  click?: boolean;
  /** switch: a pressure plate, its color ON only while the cursor is on it (no click / initial / once) */
  momentary?: boolean;
  /** switch / hold: the color starts ON */
  initial?: boolean;
  /** Works only once (can't be switched back) */
  once?: boolean;
  /**
   * When its color turns OFF, objects that move only while ON play their motion backwards to
   * where they started (instead of stopping where they are)
   */
  revert?: boolean;
  /** timer: how long the color stays ON; hold: how long to stay on it (ms) */
  duration?: number;
}

/** What a linked object does while its color is ON */

export function createTriggerSchema(context: ValidationContext) {
  const { obj, num, oneOf, colorIndex } = context;

  const TRIGGER_KINDS = ['switch', 'timer', 'hold', 'startZone', 'stopZone'] as const satisfies readonly TriggerKind[];

  function trigger(v: unknown, name: string): Trigger {
    const o = obj(v, name);
    const kind = oneOf(o.kind, `${name}.kind`, TRIGGER_KINDS);
    const t: Trigger = { kind, color: colorIndex(o.color, `${name}.color`) };
    const momentary = o.momentary === true && kind === 'switch';
    if (momentary) t.momentary = true;
    if (o.click === true && (kind === 'switch' || kind === 'timer') && !momentary) t.click = true;
    if (o.initial === true && (kind === 'switch' || kind === 'hold') && !momentary) t.initial = true;
    if (o.once === true && kind !== 'startZone' && kind !== 'stopZone' && !momentary) t.once = true;
    if (o.revert === true) t.revert = true;
    if (kind === 'timer' || kind === 'hold') t.duration = num(o.duration, `${name}.duration`, 50, LIMITS.maxDelay);
    return t;
  }

  function validateTrigger(o: Record<string, unknown>, out: MapObject, name: string): void {
    if (out.role === 'trigger') out.trigger = trigger(o.trigger, `${name}.trigger`);
  }

  return { validateTrigger };
}
