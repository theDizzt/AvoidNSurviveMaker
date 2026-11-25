import { type Point } from '../common';
import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { beltPoints } from '../../conveyor';
import { wireOutline } from '../../electric';

/**
 * Electric wire (#91): a cable along `points` (map space; its shape is generated from them). Each
 * end connects to the device, wire or object it lies on; power flows through connected wires.
 */
export interface Wire {
  points: Point[];
}

/**
 * Electric devices (#94–97): `switch` toggles its power when touched (or clicked); `timer` powers
 * for `duration` ms once touched (or clicked); `pulley` powers while the cursor turns it;
 * `inverter` powers the wires on its output side (right, turning with its tilt) while the wires on
 * its input side (left) carry no power.
 */
export type PowerKind = 'switch' | 'timer' | 'pulley' | 'inverter';

export interface Power {
  kind: PowerKind;
  /** switch / timer: activated by clicking on it instead of touching it */
  click?: boolean;
  /** switch: a pressure plate, powering only while the cursor is on it (no click / initial / once) */
  momentary?: boolean;
  /** switch: starts ON */
  initial?: boolean;
  /** switch / timer: works only once */
  once?: boolean;
  /** timer: how long it powers (ms) */
  duration?: number;
}

/**
 * What an object a wire ends on does while the wire carries power: start / stop moving, be removed,
 * or appear (it is gone while unpowered; a light only goes dark).
 */
export type ElecAction = 'start' | 'stop' | 'remove' | 'show';

export function createElectricSchema(context: ValidationContext) {
  const { t, fail, obj, num, arr, oneOf, point } = context;

  function validateElectric(o: Record<string, unknown>, out: MapObject, name: string, W: number, H: number): void {
    if (out.role === 'wire') {
      const w = obj(o.wire, `${name}.wire`);
      const points = arr(w.points, `${name}.wire.points`, LIMITS.maxWirePoints).map((p, i) => point(p, `${name}.wire.points[${i}]`, W, H));
      if (beltPoints({ points, loop: false }).length < 2) fail(t('validate.beltPoints', { name }));
      out.wire = { points };
      // The cable's shape always comes from its points; wires don't move
      out.shape = { type: 'poly', points: wireOutline(out.wire) };
      delete out.motion;
      delete out.rotation;
      delete out.tilt;
    }
    if (out.role === 'power') {
      const p = obj(o.power, `${name}.power`);
      const kind = oneOf(p.kind, `${name}.power.kind`, ['switch', 'timer', 'pulley', 'inverter'] as const);
      const power: Power = { kind };
      const momentary = p.momentary === true && kind === 'switch';
      if (momentary) power.momentary = true;
      if (p.click === true && (kind === 'switch' || kind === 'timer') && !momentary) power.click = true;
      if (p.initial === true && kind === 'switch' && !momentary) power.initial = true;
      if (p.once === true && (kind === 'switch' || kind === 'timer') && !momentary) power.once = true;
      if (kind === 'timer') power.duration = num(p.duration, `${name}.power.duration`, 50, LIMITS.maxDelay);
      out.power = power;
      // Electric devices stay where they are placed (the wires are joined to them there)
      delete out.motion;
      delete out.rotation;
    }
  }

  return { validateElectric };
}
