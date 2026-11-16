export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Polygon vertex. `smooth` vertices bend the outline into a curve (freeform shapes). */
export interface PolyPoint extends Point {
  smooth?: boolean;
}

export type Shape =
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'poly'; points: PolyPoint[] };

/** path: safe floor (once a map has any path, everything outside paths is deadly). wall: deadly. */
export type Role = 'path' | 'wall';

export type Repeat = 'loop' | 'pingpong' | 'once';
export type Easing = 'none' | 'in' | 'out' | 'inOut';
export type MotionType = 'linear' | 'curve' | 'circle';

/**
 * Movement of the whole object. The object's anchor is its shape center at rest.
 * - linear / curve: `points` are markers the anchor travels through after leaving its rest position.
 * - circle: `points[0]` is the orbit center; the anchor circles it at its current distance.
 */
export interface Motion {
  type: MotionType;
  points: Point[];
  /** px/s */
  speed: number;
  repeat: Repeat;
  /** Applied to every leg between markers (or every lap for circle) */
  easing: Easing;
  /** ms before the motion starts. Negative = start already partway through the motion */
  delay: number;
  /** circle only */
  clockwise: boolean;
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
}

export interface MapObject {
  role: Role;
  shape: Shape;
  motion?: Motion;
  rotation?: Rotation;
}

export type PatternKind = 'stripes' | 'diagonal' | 'dots' | 'grid' | 'checker';

/** Colors are '#rrggbb'. Gradients and patterns are laid out in the object's own frame, so they move and rotate with it. */
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; style: 'linear' | 'radial'; from: string; to: string; /** degrees, linear only */ angle: number }
  | { type: 'pattern'; pattern: PatternKind; color: string; background: string; /** tile size in px */ size: number };

export interface SurfaceStyle {
  fill: Fill;
  /** Outline color */
  edge: string;
}

/** Per-map look. `wall` covers walls and all moving/rotating walls (obstacles); `path` covers all paths. */
export interface Theme {
  wall: SurfaceStyle;
  path: SurfaceStyle;
}

export const MAP_VERSION = 2;

export interface MapData {
  v: typeof MAP_VERSION;
  name: string;
  author: string;
  width: number;
  height: number;
  start: Rect;
  goal: Rect;
  objects: MapObject[];
  /** Omitted = the built-in default look */
  theme?: Theme;
}
