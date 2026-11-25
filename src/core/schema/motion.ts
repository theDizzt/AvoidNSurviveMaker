import { type Point } from './common';
import { type MapObject } from './object';
import { type ValidationContext } from './validation';
import { LIMITS } from './limits';
import { rotatePoint, shapeCenter } from '../shape';
import { handPivot } from '../machines';

/**
 * loop: round and round (a route returns to its start along a closing leg) · pingpong: back and
 * forth · once: stops at the end · restart: at the end it jumps back to the start and plays again ·
 * slam (routes only): rushes to the end speeding up, hits it hard, rests a moment, then slowly
 * eases back to the start at `returnSpeed`, and again
 */
export type Repeat = 'loop' | 'pingpong' | 'once' | 'restart' | 'slam';

export type Easing = 'none' | 'in' | 'out' | 'inOut';

export type MotionType = 'linear' | 'curve' | 'circle';

/**
 * Movement of the whole object. The object's anchor is its shape center at rest.
 * - linear / curve: `points` are markers the anchor travels through after leaving its rest position.
 * - circle: `points[0]` is the orbit center; the anchor circles it at its current distance.
 */
export interface Motion {
  type: MotionType;
  /** Per-leg overrides, starting at the anchor; final entry controls the loop return. */
  segmentTypes?: ('linear' | 'curve')[];
  points: Point[];
  /** px/s */
  speed: number;
  repeat: Repeat;
  /** repeat 'slam': speed of the slow way back (px/s); omitted = a quarter of `speed` */
  returnSpeed?: number;
  /** Applied to every leg between markers (or every lap for circle) */
  easing: Easing;
  /** ms before the motion starts. Negative = start already partway through the motion */
  delay: number;
  /** circle only */
  clockwise: boolean;
  /** Draw the route as a dotted line in game */
  showPath?: boolean;
  /**
   * Wavy route (#30 rolling boulder): the object weaves side to side across the route like a
   * sine wave. `amplitude` px to each side, `wavelength` px per full wave (adjusted a little per
   * leg so every leg holds whole half-waves and the wave is 0 at each marker).
   */
  wave?: Wave;
}

export interface Wave {
  amplitude: number;
  wavelength: number;
}

/** Rotation around `pivot` (rest position; the pivot travels with the object's motion). */
export interface Rotation {
  pivot: Point;
  /** deg/s */
  speed: number;
  /** Sweep per cycle in degrees (360 with loop = continuous spin) */
  angle: number;
  clockwise: boolean;
  repeat: Repeat;
  easing: Easing;
  /** ms before rotation starts. Negative = start partway through */
  delay: number;
  /** Draw a screw on the pivot in game */
  showPivot?: boolean;
  /**
   * Turn a beat at a time like a clock hand (#111 / #113): `angle` degrees over `moveMs` (with the
   * rotation's easing), then a stop of `waitMs`. Replaces `speed`; `angle` / `repeat` of the
   * rotation still bound the sweep.
   */
  tick?: RotationTick;
}

export interface RotationTick {
  angle: number;
  moveMs: number;
  waitMs: number;
}

export function createMotionSchema(context: ValidationContext) {
  const { obj, num, arr, oneOf, bool, point } = context;

  const REPEATS = ['loop', 'pingpong', 'once', 'restart', 'slam'] as const satisfies readonly Repeat[];
  /** 'slam' is for routes only */
  const ROTATION_REPEATS = ['loop', 'pingpong', 'once', 'restart'] as const satisfies readonly Repeat[];
  const EASINGS = ['none', 'in', 'out', 'inOut'] as const satisfies readonly Easing[];

  function motion(v: unknown, name: string, W: number, H: number): Motion {
    const o = obj(v, name);
    const type = oneOf(o.type, `${name}.type`, ['linear', 'curve', 'circle'] as const);
    return {
      type,
      points: arr(o.points, `${name}.points`, LIMITS.maxMarkers).map((p, i) => point(p, `${name}.points[${i}]`, W, H)),
      ...(o.segmentTypes !== undefined ? {
        segmentTypes: arr(o.segmentTypes, `${name}.segmentTypes`, LIMITS.maxMarkers + 1)
          .map((v, i) => oneOf(v, `${name}.segmentTypes[${i}]`, ['linear', 'curve'] as const)),
      } : {}),
      speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxSpeed),
      repeat: oneOf(o.repeat, `${name}.repeat`, REPEATS),
      ...(o.returnSpeed !== undefined ? { returnSpeed: num(o.returnSpeed, `${name}.returnSpeed`, 1, LIMITS.maxSpeed) } : {}),
      easing: oneOf(o.easing, `${name}.easing`, EASINGS),
      delay: num(o.delay, `${name}.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      clockwise: bool(o.clockwise, `${name}.clockwise`),
      ...(o.showPath === true ? { showPath: true } : {}),
      ...(o.wave !== undefined ? { wave: wave(o.wave, `${name}.wave`) } : {}),
    };
  }

  function wave(v: unknown, name: string): Wave {
    const o = obj(v, name);
    return {
      amplitude: num(o.amplitude, `${name}.amplitude`, 0, LIMITS.maxWaveAmplitude),
      wavelength: num(o.wavelength, `${name}.wavelength`, LIMITS.minWavelength, LIMITS.maxWavelength),
    };
  }

  function rotation(v: unknown, name: string, W: number, H: number): Rotation {
    const o = obj(v, name);
    return {
      pivot: point(o.pivot, `${name}.pivot`, W, H),
      speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxRotSpeed),
      angle: num(o.angle, `${name}.angle`, 0, LIMITS.maxAngle),
      clockwise: bool(o.clockwise, `${name}.clockwise`),
      repeat: oneOf(o.repeat, `${name}.repeat`, ROTATION_REPEATS),
      easing: oneOf(o.easing, `${name}.easing`, EASINGS),
      delay: num(o.delay, `${name}.delay`, -LIMITS.maxDelay, LIMITS.maxDelay),
      ...(o.showPivot === true ? { showPivot: true } : {}),
      ...(o.tick !== undefined ? { tick: tick(o.tick, `${name}.tick`) } : {}),
    };
  }

  function tick(v: unknown, name: string): RotationTick {
    const o = obj(v, name);
    return {
      angle: num(o.angle, `${name}.angle`, 0.1, 360),
      moveMs: num(o.moveMs, `${name}.moveMs`, 0, LIMITS.maxDelay),
      waitMs: num(o.waitMs, `${name}.waitMs`, 0, LIMITS.maxDelay),
    };
  }

  const DEFAULT_MOTION: Readonly<Motion> = {
    type: 'linear',
    points: [],
    speed: 150,
    repeat: 'pingpong',
    easing: 'inOut',
    delay: 0,
    clockwise: true,
  };

  function defaultRotation(o: MapObject): Rotation {
    return {
      // A sector spins around its apex like a radar sweep, a clock hand around its hub; everything else around its center
      pivot: o.shape.type === 'sector' ? { x: o.shape.cx, y: o.shape.cy }
        : o.hand && o.shape.type === 'rect' ? rotatePoint(handPivot(o.shape), shapeCenter(o.shape), o.tilt ?? 0) : shapeCenter(o.shape),
      speed: 90,
      angle: 360,
      clockwise: true,
      repeat: 'loop',
      easing: 'none',
      delay: 0,
    };
  }

  return { motion, rotation, DEFAULT_MOTION, defaultRotation };
}
