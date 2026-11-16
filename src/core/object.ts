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
  readonly motion: CompiledMotion | null;
  readonly rotation: CompiledRotation | null;
  readonly px: number;
  readonly py: number;
  readonly dynamic: boolean;
}

const tmp: Point = { x: 0, y: 0 };

export function compileObject(o: MapObject): CompiledObject {
  const flat = flattenShape(o.shape);
  const motion = o.motion ? new CompiledMotion(o.motion, shapeCenter(o.shape)) : null;
  const rotation = o.rotation ? new CompiledRotation(o.rotation) : null;
  const pivot = o.rotation?.pivot ?? { x: 0, y: 0 };
  return {
    src: o,
    role: o.role,
    ...flat,
    motion: motion?.moves ? motion : null,
    rotation: rotation && rotation.dur > 0 ? rotation : null,
    px: pivot.x,
    py: pivot.y,
    dynamic: !!motion?.moves || (!!rotation && rotation.dur > 0),
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
