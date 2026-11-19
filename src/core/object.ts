import { BladeMotion, FallMover, FallSpin, Roller, SawSpin, SpikeMover } from './hazards';
import { CompiledMotion, CompiledRotation } from './motion';
import { flattenShape, ringBounds, rotateRing, shapeCenter, type FlatShape } from './shape';
import type { MapData, MapObject, Point, Rect, Role } from './types';

/**
 * Object pose at time t:  world = R(θ)·(local − pivot) + pivot + d
 * "local" = the shape as placed in the editor (rest pose).
 */
export interface Transform {
  dx: number;
  dy: number;
  cos: number;
  sin: number;
}

export interface CompiledObject {
  readonly src: MapObject | null;
  readonly role: Role;
  /** Closed ring in local (rest) coordinates, with the object's tilt applied */
  readonly poly: Float64Array;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Moves the object over time (a route, or a spike's thrust) */
  readonly motion: { offsetAt(t: number, out: Point): Point } | null;
  /** Turns the object over time (a rotation, or a boulder rolling) */
  readonly rotation: { angleAt(t: number): number } | null;
  readonly px: number;
  readonly py: number;
  /** Static tilt in radians (0 = none), about (cx, cy) */
  readonly tilt: number;
  /** Shape center: the tilt center, the motion anchor */
  readonly cx: number;
  readonly cy: number;
  /** The shape before its tilt (same as the tilted ring when there is none). Draw it in `tiltFrame`. */
  readonly box: FlatShape;
  readonly dynamic: boolean;
  /** Conservative full-motion bounds for non-rotating objects. */
  readonly travelBounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

const tmp: Point = { x: 0, y: 0 };

export function compileObject(o: MapObject): CompiledObject {
  return compileTiltedAbout(o);
}

/** `tiltCenter` overrides the point the tilt turns about (door panels turn about their whole door) */
export function compileTiltedAbout(o: MapObject, tiltCenter?: Point): CompiledObject {
  const box = flattenShape(o.shape);
  const center = shapeCenter(o.shape);
  const tc = tiltCenter ?? center;
  const tilt = o.tilt ? (o.tilt * Math.PI) / 180 : 0;
  const flat = tilt ? ringBounds(rotateRing(box.poly, tc, o.tilt!)) : box;
  const route = o.motion ? new CompiledMotion(o.motion, center) : null;
  const saw = o.role === 'wall' ? o.saw : undefined;
  // A saw blade saws along its long side (turned with the tilt)
  const long = box.maxX - box.minX >= box.maxY - box.minY;
  const axis = long ? { x: Math.cos(tilt), y: Math.sin(tilt) } : { x: -Math.sin(tilt), y: Math.cos(tilt) };
  const motion = o.fall ? new FallMover(o.fall)
    : o.spike ? new SpikeMover(o.spike)
    : saw?.kind === 'blade' ? new BladeMotion(route?.moves ? route : null, axis, saw)
      : route;
  // A boulder spins about its own center by the distance it has rolled; a grinder spins steadily
  const rotation = o.fall ? new FallSpin(o.fall)
    : o.boulder && route?.moves
    ? new Roller(route, Math.min(box.maxX - box.minX, box.maxY - box.minY) / 2)
    : saw?.kind === 'disc' ? new SawSpin(saw)
      : saw ? null
        : o.rotation ? new CompiledRotation(o.rotation) : null;
  const pivot = o.boulder || saw || o.fall ? center : o.rotation?.pivot ?? { x: 0, y: 0 };
  let travelBounds: CompiledObject['travelBounds'];
  if (!rotation || rotation.dur <= 0) {
    let minDX = 0, minDY = 0, maxDX = 0, maxDY = 0;
    if (o.fall) minDY = -o.fall.height;
    else if (o.spike) {
      const a = o.spike.angle * Math.PI / 180;
      const dx = Math.cos(a) * o.spike.reach;
      const dy = Math.sin(a) * o.spike.reach;
      minDX = Math.min(0, dx); maxDX = Math.max(0, dx);
      minDY = Math.min(0, dy); maxDY = Math.max(0, dy);
    } else {
      if (route) for (const leg of route.legs) for (let k = 0; k < leg.pts.length; k += 2) {
        const dx = leg.pts[k] - center.x, dy = leg.pts[k + 1] - center.y;
        minDX = Math.min(minDX, dx); maxDX = Math.max(maxDX, dx);
        minDY = Math.min(minDY, dy); maxDY = Math.max(maxDY, dy);
      }
      if (saw?.kind === 'blade') {
        const x = Math.abs(axis.x * saw.stroke / 2), y = Math.abs(axis.y * saw.stroke / 2);
        minDX -= x; maxDX += x; minDY -= y; maxDY += y;
      }
    }
    // Padding keeps floating-point boundary contacts in the exact collision path.
    travelBounds = { minX: flat.minX + minDX - 1e-7, minY: flat.minY + minDY - 1e-7,
      maxX: flat.maxX + maxDX + 1e-7, maxY: flat.maxY + maxDY + 1e-7 };
  }
  return {
    src: o,
    role: o.role,
    ...flat,
    motion: motion?.moves ? motion : null,
    rotation: rotation && rotation.dur > 0 ? rotation : null,
    px: pivot.x,
    py: pivot.y,
    tilt,
    cx: tc.x,
    cy: tc.y,
    box,
    // Switch-linked objects can move, stop or vanish during a run, so they are drawn on their own
    dynamic: !!motion?.moves || (!!rotation && rotation.dur > 0) || !!o.link || !!saw,
    travelBounds,
  };
}

/** A static rectangular safe area (START / GOAL count as floor when the map has paths) */
export function compileZone(r: Rect): CompiledObject {
  return compileObject({ role: 'path', shape: { type: 'rect', ...r } });
}

export function compileMap(map: MapData): CompiledObject[] {
  return map.objects.map(compileObject);
}

export function transformAt(o: CompiledObject, t: number, out: Transform): Transform {
  if (o.motion) {
    o.motion.offsetAt(t, tmp);
    out.dx = tmp.x;
    out.dy = tmp.y;
  } else {
    out.dx = 0;
    out.dy = 0;
  }
  const a = o.rotation ? o.rotation.angleAt(t) : 0;
  out.cos = Math.cos(a);
  out.sin = Math.sin(a);
  return out;
}

export function toWorld(o: CompiledObject, tf: Transform, x: number, y: number, out: Point): Point {
  const lx = x - o.px;
  const ly = y - o.py;
  out.x = tf.cos * lx - tf.sin * ly + o.px + tf.dx;
  out.y = tf.sin * lx + tf.cos * ly + o.py + tf.dy;
  return out;
}

/** A point of the untilted shape (`box`) where it sits in the rest pose (tilt applied) */
export function tiltPoint(o: CompiledObject, x: number, y: number, out: Point): Point {
  if (!o.tilt) {
    out.x = x;
    out.y = y;
    return out;
  }
  const cos = Math.cos(o.tilt);
  const sin = Math.sin(o.tilt);
  const dx = x - o.cx;
  const dy = y - o.cy;
  out.x = o.cx + cos * dx - sin * dy;
  out.y = o.cy + sin * dx + cos * dy;
  return out;
}

export function toLocal(o: CompiledObject, tf: Transform, x: number, y: number, out: Point): Point {
  const wx = x - tf.dx - o.px;
  const wy = y - tf.dy - o.py;
  out.x = tf.cos * wx + tf.sin * wy + o.px;
  out.y = -tf.sin * wx + tf.cos * wy + o.py;
  return out;
}

export function hasPaths(map: MapData): boolean {
  return map.objects.some((o) => o.role === 'path');
}
