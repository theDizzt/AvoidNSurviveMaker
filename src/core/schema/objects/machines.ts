import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { shapeBounds } from '../../shape';
import { GEAR_TEETH } from '../../machines';

/** Gear (#111), on a wall: a toothed wheel filling its square, `teeth` teeth `depth` % of its radius tall */
export interface Gear {
  teeth: number;
  depth: number;
}

/**
 * Pendulum (#114), on a wall: a rod hanging from the top of its box with a round bob at the bottom
 * (as wide as the box), swinging `amplitude` degrees to each side, one full swing there and back
 * every `periodMs`. `delay`: ms before it starts (negative = partway).
 */
export interface Pendulum {
  amplitude: number;
  periodMs: number;
  delay: number;
}

/**
 * Hydraulic press (#112), on a wall: its box is the press head, driven by a rod out of a fixed
 * cylinder behind it (above, turned with the tilt). Each beat on its own: it waits open `waitMs`,
 * slams `reach` px down in `downMs`, stays shut `holdMs` and rises back in `upMs`.
 */
export interface Press {
  reach: number;
  downMs: number;
  holdMs: number;
  upMs: number;
  waitMs: number;
  delay: number;
}

export function createMachinesSchema(context: ValidationContext) {
  const { obj, num } = context;

  function validateMachines(o: Record<string, unknown>, out: MapObject, name: string, W: number, H: number): void {
    // Machines (#111–114): walls built from their box, one kind at a time
    const plainWall = out.role === 'wall' && !out.spike && !out.boulder && !out.fall && !out.saw && !out.vine;
    const box = () => {
      const b = shapeBounds(out.shape);
      return { type: 'rect' as const, x: b.x, y: b.y, w: b.w, h: b.h };
    };
    if (plainWall && o.gear !== undefined) {
      const g = obj(o.gear, `${name}.gear`);
      out.gear = { teeth: Math.round(num(g.teeth, `${name}.gear.teeth`, GEAR_TEETH.min, GEAR_TEETH.max)), depth: num(g.depth, `${name}.gear.depth`, 1, 80) };
      // Always square
      const b = box();
      const s = Math.min(b.w, b.h);
      out.shape = { type: 'rect', x: b.x + (b.w - s) / 2, y: b.y + (b.h - s) / 2, w: s, h: s };
    } else if (plainWall && o.hand === true) {
      out.hand = true;
      out.shape = box();
    } else if (plainWall && o.pendulum !== undefined) {
      const p = obj(o.pendulum, `${name}.pendulum`);
      out.pendulum = {
        amplitude: num(p.amplitude, `${name}.pendulum.amplitude`, 0, 180),
        periodMs: num(p.periodMs, `${name}.pendulum.periodMs`, 50, LIMITS.maxDelay),
        delay: num(p.delay, `${name}.pendulum.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      out.shape = box();
      // It swings on its own (its pivot can still travel along a route)
      delete out.rotation;
    } else if (plainWall && o.press !== undefined) {
      const p = obj(o.press, `${name}.press`);
      const ms = (v: unknown, key: string) => num(v, `${name}.press.${key}`, 0, LIMITS.maxDelay);
      out.press = {
        reach: num(p.reach, `${name}.press.reach`, 1, Math.max(W, H)),
        downMs: ms(p.downMs, 'downMs'),
        holdMs: ms(p.holdMs, 'holdMs'),
        upMs: ms(p.upMs, 'upMs'),
        waitMs: ms(p.waitMs, 'waitMs'),
        delay: num(p.delay, `${name}.press.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      };
      out.shape = box();
      // Its slam is its movement; its cylinder stays put
      delete out.motion;
      delete out.rotation;
    }
  }

  return { validateMachines };
}
