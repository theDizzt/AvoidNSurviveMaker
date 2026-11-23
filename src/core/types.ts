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
  | { type: 'sector'; cx: number; cy: number; r: number; start: number; sweep: number; /** Ring sector (#53/#54): inner radius, 0 < inner < r */ inner?: number };

/**
 * path: safe floor (once a map has any path, everything outside paths is deadly). wall: deadly.
 * coin: must all be collected (touched) before GOAL counts. dark: hides the cursor and its trail.
 * trigger: a switch or event zone (see `trigger`). door: a sliding door, deadly like a wall (see `door`).
 * laser: an emitter whose beam is deadly (see `laser`). mirror: reflects laser beams.
 * portal: teleports the cursor to the next portal of its color (see `portal`).
 * text: words drawn on the map, no effect on play (see `text`).
 * safe: a safe zone — nothing can kill the cursor while it is inside (it also counts as floor).
 * fog: fog or sand dust drifting over the area, covering the cursor, obstacles and walls (see `fog`).
 * torch: a harmless light source (#57 / #58, see `torch` and `light`).
 * secret: a secret wall (#55): covers what lies under it like a wall, harmless (see `secret`).
 * pulley: a pulley (#52) in a switch color: circling the cursor inside it turns it, which drives the
 *   objects linked to its color with the 'pulley' action (see `pulley`).
 * crystal: a crystal star (#59), at most one per map: picked up like a coin, it earns a bonus star
 *   when the cursor carries it to GOAL.
 * turret: a gun turret (#60) or homing missile launcher (#61), always 60×60, whose body is deadly
 *   like a wall and which shoots at the cursor once it comes within range (see `turret`).
 * conveyor: a conveyor belt (#69): safe floor like a path (without turning the rest of the map into
 *   wall) that carries the cursor and luggage along its centerline (see `conveyor`).
 * luggage: a wooden crate (#70), deadly like a wall, carried along the conveyor belt it sits on;
 *   it stops against walls, doors and luggage that doesn't move, and at the end of a one-way belt.
 * liquid: a pond (#86) or radioactive water (#87), deadly except on a lily pad (see `liquid`).
 * lily: a lily pad (#85) floating on a liquid: safe floor (like a belt, it doesn't turn the rest
 *   of the map into wall) that also keeps the cursor out of the liquid under it.
 * spot: a spotlight (#88–90), a harmless cone of light (see `spot`).
 * wire: an electric wire (#91): deadly while it carries power (see `wire`).
 * power: an electric device (#94–97): switch, pulley, timer or inverter feeding the wires touching
 *   it (see `power`).
 */
export type Role = 'path' | 'wall' | 'coin' | 'dark' | 'trigger' | 'door' | 'laser' | 'mirror' | 'portal' | 'text' | 'safe' | 'fog' | 'torch' | 'secret' | 'crystal' | 'pulley' | 'turret' | 'conveyor' | 'luggage'
  | 'liquid' | 'lily' | 'spot' | 'wire' | 'power';

/** Pond water (#86) or glowing radioactive water (#87). Touching liquids blend where they meet. */
export interface Liquid {
  kind: 'pond' | 'toxic';
}

/**
 * Spotlight (#88–90): a cone of light from the fixture's center along `angle` (degrees, map space,
 * turning with the object's rotation), `sweep` degrees wide and `range` px long.
 */
export interface Spot {
  angle: number;
  sweep: number;
  range: number;
  /** 0–100 (omitted = 100) */
  intensity?: number;
}

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

/**
 * Turret (#60, `gun`): turns its barrel toward the cursor while it is within `range` and fires a
 * bullet every `fireMs` once the barrel points at it. Missile launcher (#61, `missile`): fires a
 * homing missile every `fireMs` while the cursor is within `range`; the missile leaves along
 * `angle`, then steers toward the cursor in a smooth curve and explodes on a wall or the cursor.
 * Angles are degrees in map space (0 = right, 90 = down) and turn with the object's rotation.
 */
export interface Turret {
  kind: 'gun' | 'missile';
  /** Detection radius from the center (px) */
  range: number;
  /** Time between shots (ms) */
  fireMs: number;
  /** Bullet / missile speed (px/s) */
  speed: number;
  /** gun: the barrel's rest direction, the middle of its arc · missile: launch direction */
  angle: number;
  /** gun: how far the barrel can swing in all, centered on `angle` (360 = all the way round) */
  arc: number;
  /** gun: barrel turn speed (deg/s) · missile: how hard the missile steers (deg/s) */
  turnSpeed: number;
  /** missile: flight time before it blows up by itself (ms) */
  lifeMs: number;
  /** Anti-materiel rounds: bullets / missiles fly through walls */
  pierce: boolean;
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
/** pulley: the object's motion / rotation runs only as a pulley (#52) of its color is turned */
export type LinkAction = 'start' | 'stop' | 'remove' | 'pulley';

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

/**
 * Falling rock (#51), a wall: waits `waitMs` (not there), then drops from `height` px above its
 * resting place to it in `fallMs` (speeding up like gravity), shatters and is gone; repeats.
 * `delay`: ms before the first wait starts.
 */
export interface Fall {
  height: number;
  fallMs: number;
  waitMs: number;
  delay: number;
}

/**
 * Pulley (#52): turned by circling the cursor inside it. One clockwise turn moves the objects
 * linked to its color (action 'pulley') `turnMs` ms forward along their motion; counter-clockwise
 * moves them back (never before the start). `hold`: they stay put when it isn't turned; `unwind`:
 * they slowly run back to the start, at `unwind` % of real time.
 */
export interface Pulley {
  color: SwitchColor;
  mode: 'hold' | 'unwind';
  turnMs: number;
  unwind: number;
}

/**
 * Blinking path / wall (#75–82): there for `onMs`, gone for `offMs`, over and over. Before `delay`
 * ms it is there (a negative delay starts partway through the cycle).
 */
export interface Blink {
  onMs: number;
  offMs: number;
  delay: number;
}

/**
 * Ice (#71–74, #100–110), on a path: while the cursor is on it, it keeps sliding — its velocity only slowly
 * follows the mouse's, so it drifts on after the mouse stops and lags behind a change of direction.
 * `grip` 1–100: how quickly it catches up (higher = less slippery).
 */
export interface Ice {
  grip: number;
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
}

export interface MapObject {
  /**
   * The object's own number, unique in its map (shown as "#id" in the editor). Given when it is
   * placed and kept through edits, reordering and the removal of other objects; copies get a new one.
   */
  id?: number;
  role: Role;
  shape: Shape;
  /**
   * Static tilt in degrees, clockwise on screen, -180–180 (omitted = 0): the shape is placed turned
   * about its center (`shapeCenter`). Route markers, the rotation pivot and laser / spike angles
   * are in map space and are not turned by it.
   */
  tilt?: number;
  motion?: Motion;
  rotation?: Rotation;
  /** Editor-only grouping: objects sharing a group id are selected and moved together */
  group?: number;
  /** role 'path': cuts through static walls, which are harmless (and hidden) inside it */
  pierce?: boolean;
  /** role 'path': slippery ice (#71–74) */
  ice?: Ice;
  /** role 'trigger' */
  trigger?: Trigger;
  /** role 'door' */
  door?: Door;
  /** Reacts to a switch color (paths, walls, coins, darkness / fog areas, liquids, lily pads, spotlights) */
  link?: Link;
  /** Wall that thrusts like a spear (#29) */
  spike?: Spike;
  /** Wall that rolls (spins with the distance it travels) along its route (#30) */
  boulder?: boolean;
  /** Falling rock (#51): drops from `height` above its resting (landing) place, then shatters */
  fall?: Fall;
  /** Blinking path / wall (#75–82): appears and disappears on a cycle */
  blink?: Blink;
  /** role 'pulley' (#52) */
  pulley?: Pulley;
  /** role 'laser' */
  laser?: Laser;
  /** role 'portal' */
  portal?: Portal;
  /** role 'turret' (#60 / #61) */
  turret?: Turret;
  /** role 'conveyor' (#69) */
  conveyor?: Conveyor;
  /** Grinder / saw blade (#43–46), on a wall */
  saw?: Saw;
  /** role 'text' */
  text?: TextBox;
  /** role 'fog' */
  fog?: Fog;
  /** role 'torch' (#57): a harmless light source (see `light`); `carry` (#58): the cursor picks it up and carries it */
  torch?: { carry?: boolean };
  /** role 'secret' (#55): looks like a wall, harmless; only `radius` px around the cursor shows what lies under it */
  secret?: { radius: number };
  /** Future light-source objects: clear global darkness around the moving shape center. */
  light?: { radius: number; intensity?: number };
  /** Thorn vine (#83 / #84), on a wall: thorns all around its outline (part of its shape) */
  vine?: boolean;
  /** role 'liquid' (#86 / #87) */
  liquid?: Liquid;
  /** role 'spot' (#88–90) */
  spot?: Spot;
  /** role 'wire' (#91) */
  wire?: Wire;
  /** role 'power' (#94–97) */
  power?: Power;
  /** How the object reacts to a powered wire ending on it (omitted = a default for its kind) */
  elec?: { action: ElecAction };
}

export type PatternKind = 'stripes' | 'diagonal' | 'dots' | 'grid' | 'checker' | 'wood' | 'grass' | 'sand' | 'metal' | 'egyptian' | 'sandBrick' | 'bark' | 'woodGrain' | 'thicket' | 'mud' | 'soil' | 'snow' | 'snowDirt' | 'snowPile' | 'ice' | 'iceCrystal' | 'concrete' | 'epoxy';

/** Colors are '#rrggbb'. Gradients and patterns are laid out in the object's own frame, so they move and rotate with it. */
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; style: 'linear' | 'radial'; from: string; to: string; /** degrees, linear only */ angle: number }
  | { type: 'pattern'; pattern: PatternKind; color: string; background: string; /** tile size in px */ size: number };

export interface SurfaceStyle {
  fill: Fill;
  /** Outline color */
  edge: string;
  /** Animated look (drawn over the surface every frame) */
  anim?: SurfaceAnim;
  /**
   * Paths only: a line painted on the floor along its edge with the walls, `inset` px in from the
   * wall and `width` px wide (like the safety lines on a factory floor)
   */
  line?: { color: string; width: number; inset: number };
}

/**
 * Surface animation: 'pulse' brightens and dims (toward `color`, white by default), 'color' fades
 * to `color` and back, 'scroll' slides a pattern fill along `angle` (degrees).
 */
export interface SurfaceAnim {
  type: 'pulse' | 'color' | 'scroll';
  /** Cycles per second (pulse, color) or px per second (scroll) */
  speed: number;
  /** Strength 0–1 (pulse, color) */
  amount: number;
  color?: string;
  angle?: number;
}

/** Per-map look. `wall` covers walls and all moving/rotating walls (obstacles); `path` covers all paths. */
export interface Theme {
  wall: SurfaceStyle;
  path: SurfaceStyle;
}

/**
 * Shape of a START / GOAL zone (#63–68), laid out inside the zone's rectangle in 0–1 coordinates
 * (0, 0 = its top-left corner, 1, 1 = its bottom-right): a circle / ellipse filling it, or a
 * polygon / freeform (`smooth` vertices bend into curves).
 */
export type ZoneShape = { type: 'ellipse' } | { type: 'poly'; points: PolyPoint[]; free?: boolean };

export const MAP_VERSION = 2;

/** Clear times (ms) for star ratings: at or under `three` earns 3 stars, and so on. Slower than `one` = no star */
export interface StarTimes {
  three: number;
  two: number;
  one: number;
}

export interface MapData {
  /** Stable within its theme. Retain when moving slots; change when replacing a level. */
  id?: string;
  v: typeof MAP_VERSION;
  /** File name (used for exports); the in-game title is `title` */
  name: string;
  author: string;
  width: number;
  height: number;
  start: Rect;
  goal: Rect;
  /** A round / polygon / freeform START (#63 / #65 / #67) inside `start`; omitted = the rectangle */
  startShape?: ZoneShape;
  /** A round / polygon / freeform GOAL (#64 / #66 / #68) inside `goal`; omitted = the rectangle */
  goalShape?: ZoneShape;
  objects: MapObject[];
  /** Omitted = the built-in default look */
  theme?: Theme;
  /** Named maze design from the containing theme pack. */
  themeDesign?: string;
  /**
   * A bundled theme (official chapter or custom theme preset, by its id) the map wears when played
   * on its own: its badge and music (its maze colors are copied into `theme` when picked).
   * Ignored inside a theme pack, whose own settings apply.
   */
  themeId?: string;
  /** Level title shown in game (falls back to `name`) */
  title?: string;
  /** Level number shown in game, 1–9999 */
  level?: number;
  stars?: StarTimes;
  /** Global darkness (#42). `light` is the optional cursor light radius (0 disables it). */
  darkness?: { light: number; /** 0 = visible, 100 = black outside light sources; legacy default 100 */ intensity?: number };
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
