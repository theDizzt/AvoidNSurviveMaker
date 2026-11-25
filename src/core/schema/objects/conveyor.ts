import { type Point } from '../common';
import { type MapObject } from '../object';
import { type ValidationContext } from '../validation';
import { LIMITS } from '../limits';
import { beltPoints, conveyorOutline } from '../../conveyor';

/**
 * Conveyor belt (#69): straight runs between `points` (map space; the belt's shape is generated
 * from them), `width` px wide. `loop`: the last point joins back to the first. It runs from the
 * first point toward the last (`reverse`: the other way) at `speed` px/s.
 */
export interface Conveyor {
  points: Point[];
  loop: boolean;
  width: number;
  speed: number;
  reverse?: boolean;
}

export function createConveyorSchema(context: ValidationContext) {
  const { t, fail, obj, num, arr, point } = context;

  function validateConveyor(o: Record<string, unknown>, out: MapObject, name: string, W: number, H: number): void {
    if (out.role === 'conveyor') {
      const c = obj(o.conveyor, `${name}.conveyor`);
      const conveyor: Conveyor = {
        points: arr(c.points, `${name}.conveyor.points`, LIMITS.maxBeltPoints).map((p, i) => point(p, `${name}.conveyor.points[${i}]`, W, H)),
        loop: c.loop === true,
        width: num(c.width, `${name}.conveyor.width`, LIMITS.minBeltWidth, LIMITS.maxBeltWidth),
        speed: num(c.speed, `${name}.conveyor.speed`, 1, LIMITS.maxSpeed),
        ...(c.reverse === true ? { reverse: true } : {}),
      };
      if (beltPoints(conveyor).length < 2) fail(t('validate.beltPoints', { name }));
      out.conveyor = conveyor;
      // The belt's shape always comes from its centerline; it stays where it is drawn
      out.shape = { type: 'poly', points: conveyorOutline(conveyor) };
      delete out.motion;
      delete out.rotation;
      delete out.tilt;
    }
  }

  return { validateConveyor };
}
