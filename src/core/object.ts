import { BladeMotion, FallMover, FallSpin, Roller, SawSpin, SpikeMover } from './hazards';
import { CompiledMotion, CompiledRotation } from './motion';
import { flattenShape, shapeCenter } from './shape';
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
  /** Closed ring in local (rest) coordinates */
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
  readonly dynamic: boolean;
}

const tmp: Point = { x: 0, y: 0 };

export function compileObject(o: MapObject): CompiledObject {
  const flat = flattenShape(o.shape);
  const center = shapeCenter(o.shape);
  const route = o.motion ? new CompiledMotion(o.motion, center) : null;
  const saw = o.role === 'wall' ? o.saw : undefined;
  // A saw blade saws along its long side
  const axis = flat.maxX - flat.minX >= flat.maxY - flat.minY ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const motion = o.fall ? new FallMover(o.fall)
    : o.spike ? new SpikeMover(o.spike)
    : saw?.kind === 'blade' ? new BladeMotion(route?.moves ? route : null, axis, saw)
      : route;
  // A boulder spins about its own center by the distance it has rolled; a grinder spins steadily
  const rotation = o.fall ? new FallSpin(o.fall)
    : o.boulder && route?.moves
    ? new Roller(route, Math.min(flat.maxX - flat.minX, flat.maxY - flat.minY) / 2)
    : saw?.kind === 'disc' ? new SawSpin(saw)
      : saw ? null
        : o.rotation ? new CompiledRotation(o.rotation) : null;
  const pivot = o.boulder || saw || o.fall ? center : o.rotation?.pivot ?? { x: 0, y: 0 };
  return {
    src: o,
    role: o.role,
    ...flat,
    motion: motion?.moves ? motion : null,
    rotation: rotation && rotation.dur > 0 ? rotation : null,
    px: pivot.x,
    py: pivot.y,
    // Switch-linked objects can move, stop or vanish during a run, so they are drawn on their own
    dynamic: !!motion?.moves || (!!rotation && rotation.dur > 0) || !!o.link || !!saw,
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
