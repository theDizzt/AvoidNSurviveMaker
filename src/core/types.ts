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
  /** `free`: a freeform shape (drawn with the freeform tool or made by merging shapes), even if it has no curved vertices */
  | { type: 'poly'; points: PolyPoint[]; free?: boolean }
  /**
   * Pie slice: apex (cx, cy), radius r, from angle `start` sweeping `sweep` degrees clockwise on
   * screen (0° = right, 90° = down). sweep 360 = a full circle.
   */
  | { type: 'sector'; cx: number; cy: number; r: number; start: number; sweep: number };

/**
 * path: safe floor (once a map has any path, everything outside paths is deadly). wall: deadly.
 * coin: must all be collected (touched) before GOAL counts. dark: hides the cursor and its trail.
 * trigger: a switch or event zone (see `trigger`). door: a sliding door, deadly like a wall (see `door`).
 * laser: an emitter whose beam is deadly (see `laser`). mirror: reflects laser beams.
 * portal: teleports the cursor to the next portal of its color (see `portal`).
 * text: words drawn on the map, no effect on play (see `text`).
 * safe: a safe zone — nothing can kill the cursor while it is inside (it also counts as floor).
 * fog: fog or sand dust drifting over the area, covering the cursor, obstacles and walls (see `fog`).
 */
export type Role = 'path' | 'wall' | 'coin' | 'dark' | 'trigger' | 'door' | 'laser' | 'mirror' | 'portal' | 'text' | 'safe' | 'fog';

/** fog: grey-white fog (#49) · sand: blowing sand dust (#50) */
export type FogKind = 'fog' | 'sand';

/** Fog / sand dust area: no effect on play, only hides what lies under it */
export interface Fog {
  kind: FogKind;
  /** How much it hides, 0–100 (100 = nothing under it shows) */
  density: number;
}

/**
 * Saw (a wall): `disc` is a round grinder that spins (#43, #45 on a route), `blade` a rectangular
 * saw blade that saws back and forth along its long side (#44, #46 on a route).
 */
export interface Saw {
  kind: 'disc' | 'blade';
  /** disc: spin direction */
  clockwise: boolean;
  /** disc: spin speed, deg/s */
  spin: number;
  /** blade: how far it saws back and forth (px, end to end) */
  stroke: number;
  /** blade: time for one back-and-forth (ms) */
  strokeMs: number;
}

/** Text box (#47): `shape` is its rectangle */
export interface TextBox {
  text: string;
  /** '#rrggbb' */
  color: string;
  /** Font name (title, main, serif, heavy, timer, mono, hand) or a library font id */
  font: string;
  size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  /** Outline color '#rrggbb' (none when omitted) */
  outline?: string;
  outlineWidth: number;
  /** Box color with opacity, '#rrggbbaa' (transparent when omitted) */
  background?: string;
  /** Drop shadow color '#rrggbb' (none when omitted) */
  shadow?: string;
  /** Neon glow color '#rrggbb' (none when omitted) */
  glow?: string;
  /** Gradient: the letters fade from `color` at the top to this color at the bottom */
  gradient?: string;
  /** 3D extrusion depth in px toward the bottom right (none when omitted) */
  depth?: number;
  /** Color of the 3D sides '#rrggbb' */
  depthColor?: string;
}

/** Spike stake (a wall): waits, thrusts out fast along `angle`, then slowly slides back */
export interface Spike {
  /** Thrust direction in degrees (0 = right, 90 = down) */
  angle: number;
  /** How far it thrusts */
  reach: number;
  thrustMs: number;
  returnMs: number;
  /** Rest time between thrusts */
  waitMs: number;
  /** ms before the first thrust (negative = start partway through) */
  delay: number;
}

export interface Laser {
  /** Beam color (SWITCH_COLORS index) */
  color: number;
  /** Beam direction in degrees (0 = right, 90 = down); turns with the emitter's rotation */
  angle: number;
  /** Beam on at the start */
  on: boolean;
  /** While this switch color is ON, the beam is flipped (on ↔ off) */
  switchColor?: number;
}

export interface Portal {
  color: number;
  /** Teleports go to the next portal of the same color in this order (then back to the first) */
  order: number;
  /** both · in: entrance only · out: exit only */
  mode: 'both' | 'in' | 'out';
}

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
export type LinkAction = 'start' | 'stop' | 'remove';

export interface Link {
  color: SwitchColor;
  /** start: moves only while ON · stop: moves only while OFF · remove: gone while ON */
  action: LinkAction;
}

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
  /** Draw the route as a dotted line in game */
  showPath?: boolean;
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
}

export interface MapObject {
  role: Role;
  shape: Shape;
  motion?: Motion;
  rotation?: Rotation;
  /** Editor-only grouping: objects sharing a group id are selected and moved together */
  group?: number;
  /** role 'path': cuts through static walls, which are harmless (and hidden) inside it */
  pierce?: boolean;
  /** role 'trigger' */
  trigger?: Trigger;
  /** role 'door' */
  door?: Door;
  /** Reacts to a switch color (paths, walls, coins, darkness / fog areas) */
  link?: Link;
  /** Wall that thrusts like a spear (#29) */
  spike?: Spike;
  /** Wall that rolls (spins with the distance it travels) along its route (#30) */
  boulder?: boolean;
  /** role 'laser' */
  laser?: Laser;
  /** role 'portal' */
  portal?: Portal;
  /** Grinder / saw blade (#43–46), on a wall */
  saw?: Saw;
  /** role 'text' */
  text?: TextBox;
  /** role 'fog' */
  fog?: Fog;
}

export type PatternKind = 'stripes' | 'diagonal' | 'dots' | 'grid' | 'checker' | 'wood' | 'grass' | 'sand' | 'metal';

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

/** Clear times (ms) for star ratings: at or under `three` earns 3 stars, and so on. Slower than `one` = no star */
export interface StarTimes {
  three: number;
  two: number;
  one: number;
}

export interface MapData {
  v: typeof MAP_VERSION;
  /** File name (used for exports); the in-game title is `title` */
  name: string;
  author: string;
  width: number;
  height: number;
  start: Rect;
  goal: Rect;
  objects: MapObject[];
  /** Omitted = the built-in default look */
  theme?: Theme;
  /** Level title shown in game (falls back to `name`) */
  title?: string;
  /** Level number shown in game, 1–9999 */
  level?: number;
  stars?: StarTimes;
  /** Global darkness: the whole map is dark during a run except a light around the cursor */
  darkness?: { light: number };
  /** Difficulty rating 1.00–10.00 shown on level select */
  difficulty?: number;
}

export const PACK_VERSION = 1;

/** Several levels played in order, shared as one file or link */
export interface MapPack {
  pack: typeof PACK_VERSION;
  name: string;
  author: string;
  levels: MapData[];
}
