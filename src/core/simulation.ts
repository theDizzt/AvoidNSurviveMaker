import { pointInPoly, segmentPolyCrossings } from './geometry';
import { displayTime } from './time';
import { compileMap, compileObject, compilePressCylinder, compileTiltedAbout, toLocal, toWorld, transformAt, type CompiledObject, type Transform } from './object';
import { autoDoorOpen, doorPanels, initialChannels } from './switches';
import { BeamCaster, beamHit, type Beam } from './laser';
import { TurretSystem, type Shot, type TurretSnapshot, type TurretState } from './turret';
import { ZoneArea, zoneShape } from './zone';
import { blinkState, fallState } from './hazards';
import { CompiledMotion, CompiledRotation } from './motion';
import { rotatePoint, shapeCenter } from './shape';
import { BeltPath, LuggageMover, polysOverlap } from './conveyor';
import { Circuit, elecEffect, GENERATOR_MS, isLightRole } from './electric';
import { auraRadius, segmentCircleEntry } from './radiation';

/** How long a portal pulls the cursor to its center before teleporting (ms) */
export const PORTAL_PULL_MS = 160;
/** A coin is collected once the cursor comes this close to its center (map units; the coin's radius is 12) */
export const COIN_MAGNET = 36;
/**
 * Simulation step budget, chosen to reduce CPU work (not a JavaScript timer limitation).
 * GOAL and swept collisions are interpolated within each step; record precision is independent.
 */
export const SIM_STEP_MS = 4;
/** How long a collected coin takes to fly into the cursor (ms, drawing only) */
export const COIN_PULL_MS = 180;
/** A crystal star (#59, 48×48) is picked up this close to its center */
export const CRYSTAL_MAGNET = 48;
/** An unwinding pulley (#52) starts running back this long (ms) after it was last turned */
export const PULLEY_UNWIND_AFTER = 150;
/** Ice (#71–74): per ms, the cursor's velocity closes this fraction of the gap to the mouse's, per point of grip */
export const ICE_GRIP_RATE = 0.0002;
/** Turning only counts this far (map units) from a pulley's center, where the angle is stable */
const PULLEY_DEAD_ZONE = 3;
/**
 * A pulley (#52 / #95) is grabbed by pressing the mouse button this close to its center (times its
 * radius); held, it turns as the cursor circles around its center, however wide, until released
 */
export const PULLEY_GRAB = 1.25;
import type { MapData, Point } from './types';

export type SimStatus = 'ready' | 'playing' | 'dead' | 'cleared';
export type AbortReason = 'left' | 'blur' | 'pointer';
/** wall: static wall · mover: moving/rotating wall · void: outside the paths (counts as wall) · bounds: left the map */
/** bullet / missile: shot by a turret (#60) or hit by a homing missile (#61) */
/** liquid: fell into a pond / radioactive water (#86 / #87) · shock: touched a live wire (#91) */
/** radiation: inside a radioactive zone, a piece of waste or its aura (#115–117) */
export type EndReason = 'wall' | 'mover' | 'void' | 'bounds' | 'laser' | 'bullet' | 'missile' | 'liquid' | 'shock' | 'radiation' | AbortReason;

/** t: ms since the run started (START click), sub-millisecond precision preserved */
export interface ReplaySample {
  t: number;
  x: number;
  y: number;
}

export interface Replay {
  v: 1;
  /** Omitted in legacy replays (1 ms). */
  simulationStepMs?: 4 | 8;
  /** Version 2 uses the recorded step for every mechanism; older replays retain map-specific fallbacks. */
  simulationVersion?: 2;
  samples: ReplaySample[];
  /** Clicks during the run (click-activated switches, grabbing a pulley), in time order */
  clicks?: ReplaySample[];
  /** Mouse button releases during the run that let go of a pulley (mouse position), in time order */
  releases?: ReplaySample[];
  abort?: { reason: AbortReason };
}

const tfA: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const tfB: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const pA: Point = { x: 0, y: 0 };
/** Scratch for magnet pulls (#99) */
const magnetStep: Point = { x: 0, y: 0 };
const pB: Point = { x: 0, y: 0 };
/** Crossing intervals narrower than this (fraction of a step's sweep) are floating-point seams between flush shapes */
const SEAM_U = 1e-9;

export interface SimSnapshot {
  readonly own: readonly [string, unknown][];
  readonly guns: TurretSnapshot;
  readonly circuit: Uint8Array | null;
  readonly movers: readonly number[][];
}

/** Simulation fields that never change after construction, or are scratch space: not snapshotted */
const SNAPSHOT_SKIP = new Set([
  'map', 'objects', 'hasPaths', 'ices', 'belts', 'crates', 'metals', 'magnets', 'cursorMagnets', 'startArea', 'goalArea',
  'solids', 'safeCount', 'coins', 'crystals', 'falls', 'wastes', 'blinks', 'pulleys', 'pulleyCap', 'triggers', 'linked',
  'doors', 'solidSrc', 'solidDoor', 'solidSlide', 'circuit', 'devices', 'caster', 'guns', 'gunState', 'shotHit', 'portals',
  'local', 'relevant', 'relevantCount', 'crossings', 'crateScratch', 'wallScratch', 'powerActive', 'coinTotal',
  'hasCrystal', 'simulationStepMs', 'legacyStepPolicy',
  // A cache of poses by time (pure): forgotten on restore instead
  'solidPose', 'solidPoseTime',
]);

/** Arrays of entries that are never changed once added: copied shallowly */
const SNAPSHOT_SHALLOW = new Set(['samples', 'clicks', 'releases', 'beams', 'pendingBeams']);

/** Deep copy of run state: numbers, strings, typed arrays, arrays and plain objects only */
function copyState(v: unknown, key: string): unknown {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function') throw new Error(`Simulation.snapshot: ${key} is a function`);
    return v;
  }
  if (ArrayBuffer.isView(v)) return (v as Float64Array).slice();
  if (Array.isArray(v)) return v.map((e) => copyState(e, key));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error(`Simulation.snapshot: ${key} holds a class instance`);
  const out: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(v)) out[k] = copyState(e, key);
  return out;
}

/**
 * Deterministic simulation, judged in 4 ms steps (SIM_STEP_MS). Each step is swept as a whole, so
 * the clear time, coin pickups and hits are interpolated inside it: records keep
 * 1 ms resolution independently of the simulation step. Stateful mechanisms use the same step.
 *
 * - Input samples define line segments, split at 4 ms boundaries (legacy replays may use 1 or 8 ms).
 * - Each piece is tested against every object in that object's own local frame: the cursor
 *   endpoints are mapped through the inverse of the object's pose at the start and end of the
 *   piece. That turns moving and rotating objects into static polygons and the cursor's motion
 *   into a relative-motion segment. Nonlinear motion within a step remains an approximation.
 * - All boundary crossings along the segment are collected and the segment is checked
 *   interval by interval: safe = (inside some path, or the map has no paths) and inside no wall,
 *   where static walls don't count inside a path that cuts through walls (`pierce`).
 * - The same samples and step mode produce the same result for replay verification.
 */
export class Simulation {
  readonly map: MapData;
  /** Map objects (for drawing) */
  readonly objects: readonly CompiledObject[];

  status: SimStatus = 'ready';
  /** Time (ms) up to which everything has been checked */
  time = 0;
  x = 0;
  y = 0;
  endReason: EndReason | null = null;
  /** Exact time (ms, fractional) of death or clear */
  endTime = 0;

  /** Per map object: 1 once that coin has been collected (always 0 for other objects) */
  readonly collected: Uint8Array;
  /** Per map object: when (ms) and where (map units, x/y pairs) that coin was collected, for the pull-in animation */
  readonly collectedAt: Float64Array;
  readonly collectedPos: Float64Array;
  /** Number of coins on the map */
  readonly coinTotal: number;
  coinsLeft: number;
  /** The map has a crystal star (#59) */
  readonly hasCrystal: boolean;
  /** The cursor has picked up the crystal star this run; a clear with it earns the bonus star */
  crystalHeld = false;

  private readonly hasPaths: boolean;
  /** Ice floors (#71–74) */
  private readonly ices: readonly number[];
  /** Conveyor belts (#69): object index and centerline */
  private readonly belts: readonly { i: number; path: BeltPath }[];
  /** Crates (#70): object index and the mover the simulation steps */
  private readonly crates: readonly { i: number; mover: LuggageMover }[];
  /** Metal boxes (#98) a magnet can pull (none when no magnet pulls metal) */
  private readonly metals: readonly { i: number; mover: LuggageMover }[];
  /** Magnets (#99), and those that pull the cursor */
  private readonly magnets: readonly number[];
  private readonly cursorMagnets: readonly number[];
  /** The cursor's velocity (map units / ms) while sliding on ice */
  vx = 0;
  vy = 0;
  /** START and GOAL (rectangles, or shaped zones #63–68) */
  private readonly startArea: ZoneArea;
  private readonly goalArea: ZoneArea;
  /** Objects used for collision: paths and walls + START/GOAL as safe floor when the map has paths */
  private readonly solids: readonly CompiledObject[];
  /** The first `safeCount` solids are safe zones */
  private readonly safeCount: number = 0;
  /** Indices (into `objects`) of the coins */
  private readonly coins: readonly number[];
  /** Indices (into `objects`) of the crystal stars (at most one on a valid map) */
  private readonly crystals: readonly number[];
  /** Falling rocks (#51): hidden while not falling */
  private readonly falls: readonly number[];
  /** Radioactive waste (#116 / #117): its round aura is checked on its own */
  private readonly wastes: readonly number[];
  /** Blinking paths / walls (#75–82): hidden while off */
  private readonly blinks: readonly number[];

  // ── Pulleys (#52) ──
  private readonly pulleys: readonly number[];
  /** Per object (pulleys): how far it has turned (radians, + = clockwise), for drawing */
  readonly pulleyAngle: Float64Array;
  /** Per color: the motion time (ms) its pulleys have wound the 'pulley'-linked objects to */
  readonly pulleyTime = new Float64Array(16);
  /** Per color: the furthest that time can go (end of 'once' motions; Infinity otherwise) */
  private readonly pulleyCap = new Float64Array(16);
  /** Per object (pulleys): when it was last turned */
  private readonly lastTurn: Float64Array;

  // ── Switches ──
  /** Per switch color: 1 while ON */
  readonly channels: Uint8Array;
  /** Per object: the time its motion is at (linked objects only move while allowed) */
  readonly clock: Float64Array;
  /** Per object: 1 while removed by its switch link (or a collected coin) */
  readonly hidden: Uint8Array;
  /** Per object (doors): how far open, 0–1 */
  readonly doorOpen: Float64Array;
  /** Per object (timer / hold switches): remaining time / hold progress, 0–1, for drawing */
  readonly progress: Float64Array;
  private readonly triggers: readonly number[];
  private readonly linked: readonly number[];
  /** Colors with a reverting trigger, as bits: their 'start' objects rewind while OFF */
  private revertColors = 0;
  private readonly doors: readonly number[];
  /** Per solid: map object index (−1 for START / GOAL), and the door it belongs to (−1 if none) */
  private readonly solidSrc: Int32Array;
  private readonly solidDoor: Int32Array;
  /** Per solid: slide vector of a door half when fully open */
  private readonly solidSlide: Float64Array;
  /** Per channel: time its timer runs out */
  private readonly timerEnd = new Float64Array(16);
  /** Per object: timer switch end time (drawing), trigger used (once), cursor inside, hold time, hold fired */
  private readonly timerObjEnd: Float64Array;
  private readonly used: Uint8Array;
  private readonly inside: Uint8Array;
  private readonly holdAcc: Float64Array;
  private readonly holdFired: Uint8Array;
  /** Per object / door: clock and openness at the end of the segment being checked */
  private readonly clockB: Float64Array;
  private readonly openB: Float64Array;
  private clicks: ReplaySample[] = [];
  private releases: ReplaySample[] = [];
  /** The pulley (#52) or electric pulley (#95) held by the mouse button; -1 = none */
  grabbed = -1;

  // ── Electricity (#91, #94–97) ──
  /** The wires, devices and the objects wired to them (null on maps without any) */
  readonly circuit: Circuit | null;
  /** Per object: 1 while a wire carries power, a device's output is on, or a wired object is powered */
  readonly power: Uint8Array;
  /** Electric devices */
  private readonly devices: readonly number[];
  /** Per object (electric switches): 1 while ON */
  private readonly powerOn: Uint8Array;
  /** Per object (electric timers): when it stops powering */
  private readonly powerEnd: Float64Array;
  /** Time the circuit is being worked out for */
  private powerT = 0;

  // ── Lasers ──
  /** Beams at the current time (for drawing and the next tick's sweep test) */
  beams: Beam[] = [];
  private pendingBeams: Beam[] = [];
  private readonly caster: BeamCaster;

  // ── Turrets (#60) / missile launchers (#61) ──
  /** Barrels, bullets, missiles and explosions */
  readonly guns: TurretSystem;
  private readonly gunState: TurretState;
  private readonly shotHit: { shot: Shot | null } = { shot: null };

  // ── Portals ──
  /**
   * The virtual cursor is the mouse position plus this offset: a browser can't move the real
   * mouse, so after a teleport the cursor keeps following the mouse from the new place.
   */
  offX = 0;
  offY = 0;
  /** Number of teleports so far (the trail breaks at each) */
  teleports = 0;
  /** Being pulled into a portal: from the touch point to its center, then on to `dest` */
  pull: { start: number; end: number; fromX: number; fromY: number; toX: number; toY: number; dest: number } | null = null;
  private readonly portals: readonly number[];
  /** Portal just arrived at: ignored until the cursor leaves it */
  private portalCooldown = -1;
  /** Per object: local segment endpoints [ax, ay, bx, by] for the segment being checked */
  private readonly local: Float64Array;
  private readonly relevant: Int32Array;
  private relevantCount = 0;
  private readonly crossings: number[] = [];
  /** Scratch rings for crate collision checks */
  private crateScratch = new Float64Array(0);
  private wallScratch = new Float64Array(0);
  /** Last endpoint pose per solid; reused as the next segment's start pose. */
  private readonly solidPoseTime: Float64Array;
  private readonly solidPose: Transform[];

  private tick = 0;
  private samples: ReplaySample[] = [];
  private abortReason: AbortReason | null = null;
  /** Maximum step for this run; fixed at construction so a replay always runs the same way. */
  readonly simulationStepMs: 1 | 4 | 8;

  /** New games use one step for all devices; legacy replays retain the old fine-step policy. */
  constructor(map: MapData, objects: readonly CompiledObject[] = compileMap(map), stepMs: 1 | 4 | 8 = SIM_STEP_MS,
    private readonly legacyStepPolicy = false) {
    this.map = map;
    this.objects = objects;
    const needsFineSteps = legacyStepPolicy && map.objects.some(o =>
      o.ice || o.link ||
      o.role === 'trigger' || o.role === 'door' || o.role === 'portal' ||
      o.role === 'pulley' || o.role === 'laser' || o.role === 'turret' || o.role === 'conveyor' ||
      o.role === 'wire' || o.role === 'power' || o.role === 'magnet');
    this.simulationStepMs = needsFineSteps ? 1 : stepMs;
    this.hasPaths = this.objects.some((o) => o.role === 'path');
    this.ices = map.objects.flatMap((o, i) => (o.role === 'path' && o.ice ? [i] : []));
    this.belts = map.objects.flatMap((o, i) => (o.role === 'conveyor' && o.conveyor ? [{ i, path: new BeltPath(o.conveyor) }] : []));
    this.crates = this.objects.flatMap((o, i) => (o.role === 'luggage' && o.motion instanceof LuggageMover ? [{ i, mover: o.motion }] : []));
    this.magnets = map.objects.flatMap((o, i) => (o.role === 'magnet' && o.magnet && o.magnet.strength > 0 ? [i] : []));
    this.cursorMagnets = this.magnets.filter((i) => map.objects[i].magnet!.cursor);
    // Metal boxes only move when some magnet pulls metal
    const pullsMetal = this.magnets.some((i) => map.objects[i].magnet!.metal);
    this.metals = pullsMetal ? this.objects.flatMap((o, i) => (o.role === 'metal' && o.motion instanceof LuggageMover ? [{ i, mover: o.motion }] : [])) : [];
    // Every run starts with the crates and metal boxes where they were placed
    for (const c of this.crates) c.mover.reset();
    for (const o of this.objects) if (o.role === 'metal' && o.motion instanceof LuggageMover) o.motion.reset();
    // Coins, triggers, darkness areas and text don't block or support the cursor. A door is two
    // sliding wall halves. Safe zones come first: inside one, nothing else matters.
    const solids: CompiledObject[] = [];
    const src: number[] = [];
    const doorOf: number[] = [];
    const slide: number[] = [];
    this.objects.forEach((o, i) => {
      if (o.role !== 'safe') return;
      solids.push(o);
      src.push(i);
      doorOf.push(-1);
      slide.push(0, 0);
    });
    this.safeCount = solids.length;
    this.objects.forEach((o, i) => {
      if (o.role === 'path' || o.role === 'wall' || o.role === 'laser' || o.role === 'turret' || o.role === 'conveyor' || o.role === 'luggage'
        || o.role === 'liquid' || o.role === 'lily' || o.role === 'wire' || o.role === 'rad' || o.role === 'metal' || o.role === 'magnet') {
        // The bodies of laser emitters, turrets, crates, metal boxes and magnets are as deadly as a wall; a belt is floor
        solids.push(o.role === 'laser' || o.role === 'turret' || o.role === 'luggage' || o.role === 'metal' || o.role === 'magnet' ? { ...o, role: 'wall' } : o);
        src.push(i);
        doorOf.push(-1);
        slide.push(0, 0);
        // A hydraulic press (#112): its cylinder is a wall of its own that stays put
        const cylinder = compilePressCylinder(map.objects[i]);
        if (cylinder) {
          solids.push(map.objects[i].link || map.objects[i].blink ? { ...cylinder, dynamic: true } : cylinder);
          src.push(i);
          doorOf.push(-1);
          slide.push(0, 0);
        }
      } else if (o.role === 'door' && map.objects[i].shape.type === 'rect') {
        const s = map.objects[i].shape as { x: number; y: number; w: number; h: number };
        // A tilted door's panels turn about the door's center, and slide along the tilt
        const tilt = map.objects[i].tilt;
        const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
        for (const half of doorPanels(s)) {
          solids.push({ ...compileTiltedAbout({ role: 'wall', shape: { type: 'rect', ...half.rect }, tilt }, c), dynamic: true });
          src.push(i);
          doorOf.push(i);
          const d = tilt ? rotatePoint(half.slide, { x: 0, y: 0 }, tilt) : half.slide;
          slide.push(d.x, d.y);
        }
      }
    });
    this.startArea = new ZoneArea(map.start, map.startShape);
    this.goalArea = new ZoneArea(map.goal, map.goalShape);
    if (this.hasPaths) {
      solids.push(
        compileObject({ role: 'path', shape: zoneShape(map.start, map.startShape) }),
        compileObject({ role: 'path', shape: zoneShape(map.goal, map.goalShape) }),
      );
      src.push(-1, -1);
      doorOf.push(-1, -1);
      slide.push(0, 0, 0, 0);
    }
    this.solids = solids;
    this.solidSrc = Int32Array.from(src);
    this.solidDoor = Int32Array.from(doorOf);
    this.solidSlide = Float64Array.from(slide);
    this.coins = this.objects.flatMap((o, i) => (o.role === 'coin' ? [i] : []));
    this.crystals = this.objects.flatMap((o, i) => (o.role === 'crystal' ? [i] : []));
    this.falls = map.objects.flatMap((o, i) => (o.fall ? [i] : []));
    this.wastes = map.objects.flatMap((o, i) => (o.role === 'rad' && o.rad?.aura ? [i] : []));
    this.blinks = map.objects.flatMap((o, i) => (o.blink ? [i] : []));
    this.pulleys = map.objects.flatMap((o, i) => (o.role === 'pulley' && o.pulley ? [i] : []));
    this.pulleyAngle = new Float64Array(this.objects.length);
    this.lastTurn = new Float64Array(this.objects.length);
    // How far a pulley can wind each color: until every linked 'once' motion / rotation has ended
    for (const m of map.objects) {
      if (m.link?.action !== 'pulley') continue;
      let end = 0;
      if (m.motion) {
        const route = new CompiledMotion(m.motion, shapeCenter(m.shape));
        end = Math.max(end, m.motion.repeat === 'once' ? route.pass + Math.max(0, m.motion.delay) : Infinity);
      }
      if (m.rotation) {
        const turn = new CompiledRotation(m.rotation);
        end = Math.max(end, m.rotation.repeat === 'once' ? turn.dur + Math.max(0, m.rotation.delay) : Infinity);
      }
      this.pulleyCap[m.link.color] = Math.max(this.pulleyCap[m.link.color], end);
    }
    this.hasCrystal = this.crystals.length > 0;
    this.triggers = this.objects.flatMap((o, i) => (o.role === 'trigger' ? [i] : []));
    const circuit = new Circuit(map, this.objects);
    this.circuit = circuit.any ? circuit : null;
    this.devices = map.objects.flatMap((o, i) => (o.role === 'power' && o.power ? [i] : []));
    this.power = new Uint8Array(this.objects.length);
    this.powerOn = new Uint8Array(this.objects.length);
    this.powerEnd = new Float64Array(this.objects.length);
    // Objects reacting to a switch color or to a wire's power
    this.linked = map.objects.flatMap((o, i) => (o.link || this.circuit?.isTarget[i] ? [i] : []));
    for (const o of map.objects) if (o.trigger?.revert) this.revertColors |= 1 << o.trigger.color;
    this.doors = this.objects.flatMap((o, i) => (o.role === 'door' ? [i] : []));
    const n = this.objects.length;
    this.channels = new Uint8Array(16);
    this.clock = new Float64Array(n);
    this.hidden = new Uint8Array(n);
    this.doorOpen = new Float64Array(n);
    this.progress = new Float64Array(n);
    this.timerObjEnd = new Float64Array(n);
    this.used = new Uint8Array(n);
    this.inside = new Uint8Array(n);
    this.holdAcc = new Float64Array(n);
    this.holdFired = new Uint8Array(n);
    this.clockB = new Float64Array(n);
    this.openB = new Float64Array(n);
    this.coinTotal = this.coins.length;
    this.coinsLeft = this.coinTotal;
    this.collected = new Uint8Array(this.objects.length);
    this.collectedAt = new Float64Array(this.objects.length);
    this.collectedPos = new Float64Array(this.objects.length * 2);
    this.portals = this.objects.flatMap((o, i) => (o.role === 'portal' ? [i] : []));
    this.caster = new BeamCaster(map, this.objects);
    this.guns = new TurretSystem(map, this.objects);
    this.gunState = { timeOf: (i) => this.clockB[i], hidden: this.hidden, doorOpen: this.openB };
    this.resetSwitches();
    this.local = new Float64Array(this.solids.length * 4);
    this.relevant = new Int32Array(this.solids.length);
    this.solidPoseTime = new Float64Array(this.solids.length).fill(NaN);
    this.solidPose = this.solids.map(() => ({ dx: 0, dy: 0, cos: 1, sin: 0 }));
  }

  /**
   * Everything a run changes, to come back to later with restore(): lets a route search branch
   * from the middle of a run instead of replaying it from the start.
   */
  snapshot(): SimSnapshot {
    const own: [string, unknown][] = [];
    for (const [k, v] of Object.entries(this)) {
      if (SNAPSHOT_SKIP.has(k)) continue;
      own.push([k, SNAPSHOT_SHALLOW.has(k) ? (v as unknown[]).slice() : copyState(v, k)]);
    }
    return {
      own,
      guns: this.guns.snapshot(),
      circuit: this.circuit?.snapshot() ?? null,
      movers: [...this.crates, ...this.metals].map(({ mover: m }) => [m.t0, m.x0, m.y0, m.t1, m.x1, m.y1]),
    };
  }

  restore(s: SimSnapshot): void {
    const self = this as unknown as Record<string, unknown>;
    for (const [k, v] of s.own) {
      const cur = self[k];
      // Typed arrays are shared with helpers (gunState, ...), so they are refilled in place
      if (ArrayBuffer.isView(cur) && ArrayBuffer.isView(v)) (cur as Float64Array).set(v as Float64Array);
      else self[k] = SNAPSHOT_SHALLOW.has(k) ? (v as unknown[]).slice() : copyState(v, k);
    }
    this.solidPoseTime.fill(NaN);
    this.guns.restore(s.guns);
    if (this.circuit && s.circuit) this.circuit.restore(s.circuit);
    [...this.crates, ...this.metals].forEach(({ mover: m }, i) => {
      [m.t0, m.x0, m.y0, m.t1, m.x1, m.y1] = s.movers[i];
    });
    this.caster.invalidate();
  }

  /** Last completed whole millisecond (not a count of segment checks). */
  get ticks(): number {
    return this.tick;
  }

  /** Only starts when the click is inside the START area. */
  start(x: number, y: number): boolean {
    if (!this.startArea.contains(x, y)) return false;
    this.status = 'playing';
    this.time = 0;
    this.tick = 0;
    this.x = x;
    this.y = y;
    this.endReason = null;
    this.endTime = 0;
    this.abortReason = null;
    this.collected.fill(0);
    this.coinsLeft = this.coinTotal;
    this.crystalHeld = false;
    // Coins taken in an earlier run on this instance come back; updateDerived() hides what it must
    this.hidden.fill(0);
    this.resetSwitches();
    this.guns.reset();
    this.offX = 0;
    this.offY = 0;
    this.vx = 0;
    this.vy = 0;
    this.teleports = 0;
    this.pull = null;
    this.portalCooldown = -1;
    this.samples = [{ t: 0, x, y }];
    this.clicks = [];
    this.releases = [];
    this.grabbed = -1;
    // Check whether we already overlap something at the moment of starting
    this.checkSegment(0, x, y, 0, x, y);
    return true;
  }

  /** Feed one input sample. Samples at or before the already-processed time are ignored. */
  feed(t: number, x: number, y: number): void {
    if (this.status !== 'playing' || !(t > this.time)) return;
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.samples.push({ t, x, y });
    const rx = x;
    const ry = y;

    let st = this.time;
    let sx = this.x;
    let sy = this.y;

    while (this.status === 'playing' && this.time < t) {
      const pull = this.pull;
      if (pull) {
        // Pulled toward the portal's center regardless of the mouse, then teleported
        const boundary = this.nextBoundary();
        const end = Math.min(t, pull.end, boundary);
        const f = (end - pull.start) / (pull.end - pull.start);
        const px = pull.fromX + (pull.toX - pull.fromX) * f;
        const py = pull.fromY + (pull.toY - pull.fromY) * f;
        this.checkSegment(this.time, this.x, this.y, end, px, py);
        if (this.status !== 'playing') return;
        if (end === boundary) this.tick = end;
        this.time = end;
        this.x = px;
        this.y = py;
        if (end === pull.end) this.teleport(rx, ry);
        st = this.time;
        sx = this.x;
        sy = this.y;
        continue;
      }
      if (this.ices.length || this.belts.length || this.cursorMagnets.length) {
        this.slideStep(t, rx, ry);
        if (this.status !== 'playing' || this.time === t) return;
        continue;
      }
      // Where the cursor is heading: the mouse plus the teleport offset
      const tx = rx + this.offX;
      const ty = ry + this.offY;
      const boundary = this.nextBoundary();
      if (t < boundary) {
        this.checkSegment(this.time, this.x, this.y, t, tx, ty);
        if (this.status === 'playing') {
          this.time = t;
          this.x = tx;
          this.y = ty;
        }
        return;
      }
      // Sweep the entire segment; finish() interpolates the crossing time, never quantizing to the step.
      const f = (boundary - st) / (t - st);
      const bx = sx + (tx - sx) * f;
      const by = sy + (ty - sy) * f;
      this.checkSegment(this.time, this.x, this.y, boundary, bx, by);
      if (this.status !== 'playing') return;
      this.time = boundary;
      this.x = bx;
      this.y = by;
      this.tick = boundary;
      if (t === boundary) return;
    }
  }

  /** End of the next step */
  private nextBoundary(): number {
    const step = this.simulationStepMs;
    return (Math.floor(this.time / step) + 1) * step;
  }

  /**
   * One piece (up to the next simulation boundary) of the cursor's way toward the mouse sample (rx, ry)
   * at time t, on a map with ice or conveyor belts. Off the ice the cursor follows the mouse (plus
   * the offset); on it, the cursor's velocity eases toward the mouse's and the difference builds up
   * in the offset. A belt under the cursor adds its own travel to the offset.
   */
  private slideStep(t: number, rx: number, ry: number): void {
    const boundary = this.nextBoundary();
    const end = Math.min(t, boundary);
    const dt = end - this.time;
    // Where the mouse is now and where it gets to by the end of this piece
    const mx0 = this.x - this.offX;
    const my0 = this.y - this.offY;
    const f = dt / (t - this.time);
    const mx1 = mx0 + (rx - mx0) * f;
    const my1 = my0 + (ry - my0) * f;
    const mvx = (mx1 - mx0) / dt;
    const mvy = (my1 - my0) / dt;
    const grip = this.iceGripAt(this.x, this.y);
    if (grip > 0) {
      const k = 1 - Math.exp(-dt * grip * ICE_GRIP_RATE);
      this.vx += (mvx - this.vx) * k;
      this.vy += (mvy - this.vy) * k;
      this.offX += (this.vx - mvx) * dt;
      this.offY += (this.vy - mvy) * dt;
    } else {
      this.vx = mvx;
      this.vy = mvy;
    }
    if (this.belts.length) this.beltPush(this.x, this.y, dt);
    if (this.cursorMagnets.length) this.magnetPull(this.x, this.y, dt);
    const bx = mx1 + this.offX;
    const by = my1 + this.offY;
    this.checkSegment(this.time, this.x, this.y, end, bx, by);
    if (this.status !== 'playing') return;
    this.time = end;
    this.x = bx;
    this.y = by;
    if (end === boundary) this.tick = end;
  }

  /** Is magnet `i` pulling now? Not while removed, nor while its switch link / wire holds it (like a motion that doesn't run) */
  private magnetOn(i: number): boolean {
    return !this.hidden[i] && this.runs(i);
  }

  /**
   * The pull of the magnets in `list` on (x, y) over `dt` ms, added to `out`: toward each one in
   * range, at its strength right by it, fading to nothing at the edge of its range.
   */
  private magnetForce(x: number, y: number, dt: number, list: readonly number[], kind: 'cursor' | 'metal', out: Point): void {
    for (const i of list) {
      const g = this.map.objects[i].magnet!;
      if (!g[kind] || !this.magnetOn(i)) continue;
      const o = this.objects[i];
      toWorld(o, transformAt(o, this.clockB[i] ?? this.time, tfA), o.cx, o.cy, pB);
      const dx = pB.x - x;
      const dy = pB.y - y;
      const d = Math.hypot(dx, dy);
      if (d >= g.range || d < 1e-6) continue;
      const step = Math.min(d, (g.strength / 1000) * (1 - d / g.range) * dt);
      out.x += (dx / d) * step;
      out.y += (dy / d) * step;
    }
  }

  /** Magnets (#99) drag the cursor off the mouse, like ice: their pull builds up in the offset */
  private magnetPull(x: number, y: number, dt: number): void {
    magnetStep.x = 0;
    magnetStep.y = 0;
    this.magnetForce(x, y, dt, this.cursorMagnets, 'cursor', magnetStep);
    this.offX += magnetStep.x;
    this.offY += magnetStep.y;
  }

  /**
   * Drag each metal box (#98) toward the magnets pulling it from ta to tb. It stops where a wall,
   * door, crate, magnet or another box (where they are at tb) is in the way, and slides along it
   * when only one direction is blocked.
   */
  private moveMetals(ta: number, tb: number): void {
    const dt = tb - ta;
    for (const c of this.metals) {
      const m = c.mover;
      m.begin(ta, tb);
      if (this.hidden[c.i] || dt <= 0) continue;
      const o = this.objects[c.i];
      magnetStep.x = 0;
      magnetStep.y = 0;
      this.magnetForce(o.cx + m.x1, o.cy + m.y1, dt, this.magnets, 'metal', magnetStep);
      const sx = magnetStep.x;
      const sy = magnetStep.y;
      if (sx === 0 && sy === 0) continue;
      for (const [dx, dy] of [[sx, sy], [sx, 0], [0, sy]]) {
        if (dx === 0 && dy === 0) continue;
        if (this.crateBlocked(c.i, o, m.x1 + dx, m.y1 + dy, null)) continue;
        m.x1 += dx;
        m.y1 += dy;
        break;
      }
    }
  }

  /** The belt (#69) under (x, y): the cursor travels with it for `dt` ms (the fastest one if belts overlap) */
  private beltPush(x: number, y: number, dt: number): void {
    let best: BeltPath | null = null;
    for (const b of this.belts) {
      if (this.hidden[b.i]) continue;
      const o = this.objects[b.i];
      if (x < o.minX || x > o.maxX || y < o.minY || y > o.maxY || !pointInPoly(x, y, o.poly)) continue;
      if (!best || b.path.speed > best.speed) best = b.path;
    }
    if (!best) return;
    best.project(x, y, pA);
    this.offX += pA.x * best.speed * dt;
    this.offY += pA.y * best.speed * dt;
  }

  /**
   * Carry each crate (#70) along the belt under its center from ta to tb: along the centerline,
   * turning at its corners (even where a real box as wide as the belt couldn't), while it drifts
   * onto the middle at the belt's speed. It stays put when it is wider than the belt, at the end of
   * a one-way belt, or when the move would run it into another crate, or into a wall or door
   * (where they are at tb) that lies across the belt.
   */
  private moveCrates(ta: number, tb: number): void {
    const dt = tb - ta;
    for (const c of this.crates) {
      const m = c.mover;
      m.begin(ta, tb);
      if (this.hidden[c.i] || dt <= 0) continue;
      const o = this.objects[c.i];
      const cx = o.cx + m.x1;
      const cy = o.cy + m.y1;
      let belt: BeltPath | null = null;
      for (const b of this.belts) {
        if (this.hidden[b.i]) continue;
        const bo = this.objects[b.i];
        if (cx >= bo.minX && cx <= bo.maxX && cy >= bo.minY && cy <= bo.maxY && pointInPoly(cx, cy, bo.poly)) {
          belt = b.path;
          break;
        }
      }
      if (!belt || belt.length <= 0) continue;
      // Wider than the belt: it doesn't fit, and isn't carried
      if (Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) > belt.width) continue;
      const s = belt.project(cx, cy);
      const step = belt.speed * dt;
      let to = s + belt.sign * step;
      if (!belt.loop) {
        // At the end of a one-way belt it stops, still on the belt
        const half = Math.max(o.maxX - o.minX, o.maxY - o.minY) / 2;
        to = belt.sign > 0 ? Math.min(to, belt.length - half) : Math.max(to, half);
        if (belt.sign > 0 ? to <= s : to >= s) continue;
      }
      // Where it is off the centerline, kept but shrinking by the distance traveled
      belt.pointAt(s, pA);
      const latX = cx - pA.x;
      const latY = cy - pA.y;
      const lat = Math.hypot(latX, latY);
      const keep = lat > 0 ? Math.max(0, lat - step) / lat : 0;
      belt.pointAt(to, pB);
      const nx = m.x1 + pB.x + latX * keep - cx;
      const ny = m.y1 + pB.y + latY * keep - cy;
      if (nx === m.x1 && ny === m.y1) continue;
      if (this.crateBlocked(c.i, o, nx, ny, belt)) continue;
      m.x1 = nx;
      m.y1 = ny;
    }
  }

  /**
   * Would crate `ci` overlap another crate, or a wall or door lying across its `belt`, if moved to
   * offset (dx, dy)? Walls beside the belt don't stop it: it turns corners past them.
   */
  private crateBlocked(ci: number, o: CompiledObject, dx: number, dy: number, belt: BeltPath | null): boolean {
    // The crate a hair smaller, so a crate resting against something can still slide along it
    if (this.crateScratch.length !== o.poly.length) this.crateScratch = new Float64Array(o.poly.length);
    const box = this.crateScratch;
    const shrink = 1e-3;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < o.poly.length; k += 2) {
      const x = o.poly[k] + dx + Math.sign(o.cx - o.poly[k]) * shrink;
      const y = o.poly[k + 1] + dy + Math.sign(o.cy - o.poly[k + 1]) * shrink;
      box[k] = x;
      box[k + 1] = y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (let k = this.safeCount; k < this.solids.length; k++) {
      const w = this.solids[k];
      const src = this.solidSrc[k];
      if (w.role !== 'wall' || src === ci || (src >= 0 && this.hidden[src])) continue;
      const door = this.solidDoor[k];
      let ring = w.poly;
      if (door >= 0 || w.dynamic) {
        if (this.wallScratch.length !== w.poly.length) this.wallScratch = new Float64Array(w.poly.length);
        const world = this.wallScratch;
        if (door >= 0) {
          const ox = this.solidSlide[k * 2] * this.openB[door];
          const oy = this.solidSlide[k * 2 + 1] * this.openB[door];
          for (let j = 0; j < w.poly.length; j += 2) {
            world[j] = w.poly[j] + ox;
            world[j + 1] = w.poly[j + 1] + oy;
          }
        } else {
          transformAt(w, this.clockB[src] ?? 0, tfA);
          for (let j = 0; j < w.poly.length; j += 2) {
            toWorld(w, tfA, w.poly[j], w.poly[j + 1], pA);
            world[j] = pA.x;
            world[j + 1] = pA.y;
          }
        }
        ring = world;
      }
      let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
      for (let j = 0; j < ring.length; j += 2) {
        wx0 = Math.min(wx0, ring[j]); wx1 = Math.max(wx1, ring[j]);
        wy0 = Math.min(wy0, ring[j + 1]); wy1 = Math.max(wy1, ring[j + 1]);
      }
      if (wx1 <= minX || wx0 >= maxX || wy1 <= minY || wy0 >= maxY) continue;
      if (!polysOverlap(box, ring)) continue;
      if (src >= 0 && (this.objects[src].role === 'luggage' || this.objects[src].role === 'metal')) return true;
      // A metal box (no belt) is stopped by anything solid
      if (!belt || belt.overlaps(ring)) return true;
    }
    return false;
  }

  /** Grip of the ice under (x, y), or 0 when it isn't on ice */
  private iceGripAt(x: number, y: number): number {
    let grip = 0;
    for (const i of this.ices) {
      if (this.hidden[i]) continue;
      const o = this.objects[i];
      let lx = x;
      let ly = y;
      if (o.dynamic) {
        toLocal(o, transformAt(o, this.clock[i], tfA), x, y, pA);
        lx = pA.x;
        ly = pA.y;
      }
      if (lx < o.minX || lx > o.maxX || ly < o.minY || ly > o.maxY || !pointInPoly(lx, ly, o.poly)) continue;
      // Overlapping ice: the grippiest one counts
      grip = Math.max(grip, this.map.objects[i].ice!.grip);
    }
    return grip;
  }

  /** End of a portal pull: appear at the destination portal's center */
  private teleport(rx: number, ry: number): void {
    const pull = this.pull!;
    this.pull = null;
    const o = this.objects[pull.dest];
    transformAt(o, this.clock[pull.dest], tfA);
    toWorld(o, tfA, o.cx, o.cy, pA);
    this.x = pA.x;
    this.y = pA.y;
    this.offX = this.x - rx;
    this.offY = this.y - ry;
    this.portalCooldown = pull.dest;
    this.teleports++;
    this.vx = 0;
    this.vy = 0;
  }

  /** The portal a teleport from portal `i` arrives at: the next one of its color (by order) that allows exits */
  private portalExit(i: number): number {
    const color = this.map.objects[i].portal!.color;
    const ring = this.portals
      .filter((j) => this.map.objects[j].portal!.color === color && !this.hidden[j])
      .sort((a, b) => this.map.objects[a].portal!.order - this.map.objects[b].portal!.order || a - b);
    const at = ring.indexOf(i);
    for (let k = 1; k < ring.length; k++) {
      const j = ring[(at + k) % ring.length];
      if (this.map.objects[j].portal!.mode !== 'in') return j;
    }
    return -1;
  }

  /**
   * A click during the run at time t (cursor at x, y): first catches up to t, then activates any
   * click-operated switch under the cursor.
   */
  click(t: number, x: number, y: number): void {
    if (this.status !== 'playing') return;
    if (t > this.time) this.feed(t, x, y);
    if (this.status !== 'playing') return;
    this.clicks.push({ t: this.time, x: this.x, y: this.y });
    for (const i of this.triggers) {
      const trig = this.map.objects[i].trigger!;
      if (!trig.click || this.hidden[i]) continue;
      const o = this.objects[i];
      let lx = this.x;
      let ly = this.y;
      if (o.dynamic) {
        toLocal(o, transformAt(o, this.clock[i], tfA), this.x, this.y, pA);
        lx = pA.x;
        ly = pA.y;
      }
      if (pointInPoly(lx, ly, o.poly)) this.activate(i, this.time);
    }
    for (const i of this.devices) {
      const p = this.map.objects[i].power!;
      if (p.click && (p.kind === 'switch' || p.kind === 'timer') && pointInPoly(this.x, this.y, this.objects[i].poly)) this.powerActivate(i, this.time);
    }
    // Pressing on a pulley grabs it
    for (const i of [...this.pulleys, ...this.devices]) {
      if (this.objects[i].role === 'power' && this.map.objects[i].power!.kind !== 'pulley') continue;
      if (this.hidden[i] || this.wheelDistance(i, this.x, this.y) > this.wheelRadius(i) * PULLEY_GRAB) continue;
      this.grabbed = i;
      break;
    }
    this.updateDerived(this.time);
  }

  /** The mouse button let go at time t (mouse at x, y): a held pulley is released */
  release(t: number, x: number, y: number): void {
    if (this.status !== 'playing' || this.grabbed < 0) return;
    if (t > this.time) this.feed(t, x, y);
    if (this.status !== 'playing') return;
    this.releases.push({ t: this.time, x: this.x - this.offX, y: this.y - this.offY });
    this.grabbed = -1;
  }

  /** When the mouse is idle and no events arrive, advance time assuming the cursor stayed put */
  advanceTo(t: number): void {
    // The mouse is where it last was (not the cursor, which may be offset by a teleport)
    this.feed(t, this.x - this.offX, this.y - this.offY);
  }

  /** Fail due to an external cause: cursor left the window, focus lost, etc. */
  abort(reason: AbortReason): void {
    if (this.status !== 'playing') return;
    this.status = 'dead';
    this.endReason = reason;
    this.endTime = this.time;
    this.abortReason = reason;
  }

  getReplay(): Replay {
    const r: Replay = { v: 1, samples: this.samples.slice() };
    if (!this.legacyStepPolicy) r.simulationVersion = 2;
    if (this.simulationStepMs !== 1) r.simulationStepMs = this.simulationStepMs;
    if (this.clicks.length) r.clicks = this.clicks.slice();
    if (this.releases.length) r.releases = this.releases.slice();
    if (this.abortReason) r.abort = { reason: this.abortReason };
    return r;
  }

  /** Map the segment into every object's local frame and gather boundary crossings */
  private prepare(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { solids, local, relevant, crossings } = this;
    crossings.length = 0;
    this.relevantCount = 0;
    const minX = Math.min(xa, xb), maxX = Math.max(xa, xb);
    const minY = Math.min(ya, yb), maxY = Math.max(ya, yb);
    for (let i = 0; i < solids.length; i++) {
      const o = solids[i];
      const srcIdx = this.solidSrc[i];
      if (srcIdx >= 0 && this.hidden[srcIdx]) continue; // removed by a switch
      if (o.role === 'wire' && !this.power[srcIdx]) continue; // a dead wire is harmless
      let ax = xa;
      let ay = ya;
      let bx = xb;
      let by = yb;
      const door = this.solidDoor[i];
      const bounds = o.travelBounds;
      // Doors slide independently of their compiled shape. Rotating objects retain the
      // original local-frame sweep, including its interpolation semantics.
      if (door < 0 && bounds && (maxX < bounds.minX || minX > bounds.maxX || maxY < bounds.minY || minY > bounds.maxY)) continue;
      if (door >= 0) {
        // Door half: its local frame is its closed position
        const sx = this.solidSlide[i * 2];
        const sy = this.solidSlide[i * 2 + 1];
        ax -= sx * this.doorOpen[door];
        ay -= sy * this.doorOpen[door];
        bx -= sx * this.openB[door];
        by -= sy * this.openB[door];
      } else if (o.dynamic) {
        const at = this.clock[srcIdx] ?? ta;
        const bt = this.clockB[srcIdx] ?? tb;
        const pose = this.solidPose[i];
        // An object jumping back to its start ('restart') is simply where it lands
        const from = o.jumps?.(at, bt) ? bt : at;
        if (this.solidPoseTime[i] !== from) transformAt(o, from, pose);
        toLocal(o, pose, xa, ya, pA);
        if (bt !== from) transformAt(o, bt, pose);
        this.solidPoseTime[i] = bt;
        toLocal(o, pose, xb, yb, pB);
        ax = pA.x;
        ay = pA.y;
        bx = pB.x;
        by = pB.y;
      }
      if (Math.max(ax, bx) < o.minX || Math.min(ax, bx) > o.maxX || Math.max(ay, by) < o.minY || Math.min(ay, by) > o.maxY) {
        continue; // segment never comes near this object
      }
      local[i * 4] = ax;
      local[i * 4 + 1] = ay;
      local[i * 4 + 2] = bx;
      local[i * 4 + 3] = by;
      relevant[this.relevantCount++] = i;
      if (ax !== bx || ay !== by) segmentPolyCrossings(ax, ay, bx, by, o.poly, crossings);
    }
    crossings.sort((p, q) => p - q);
  }

  /** Is (x, y) inside a safe zone at time t? */
  private inSafeZone(x: number, y: number, t: number): boolean {
    for (let i = 0; i < this.safeCount; i++) {
      const o = this.solids[i];
      const srcIdx = this.solidSrc[i];
      if (this.hidden[srcIdx]) continue;
      let lx = x;
      let ly = y;
      if (o.dynamic) {
        toLocal(o, transformAt(o, this.clockB[srcIdx] ?? t, tfA), x, y, pA);
        lx = pA.x;
        ly = pA.y;
      }
      if (pointInPoly(lx, ly, o.poly)) return true;
    }
    return false;
  }

  /** What the cursor is touching at fraction u of the prepared segment: null = safe */
  private hazardAt(u: number): 'wall' | 'mover' | 'void' | 'liquid' | 'shock' | 'radiation' | null {
    const { solids, local, relevant } = this;
    let onPath = !this.hasPaths;
    // Liquid only kills outside every lily pad (#85), so remember it until the end
    let wet = false;
    let onLily = false;
    // A static wall only kills outside every wall-piercing path, so remember it until the end
    let wallHit = false;
    let pierced = false;
    for (let k = 0; k < this.relevantCount; k++) {
      const i = relevant[k];
      const o = solids[i];
      if (o.role === 'path' && onPath && (pierced || !o.src?.pierce)) continue;
      const x = local[i * 4] + (local[i * 4 + 2] - local[i * 4]) * u;
      const y = local[i * 4 + 1] + (local[i * 4 + 3] - local[i * 4 + 1]) * u;
      if (!pointInPoly(x, y, o.poly)) continue;
      if (o.role === 'safe') return null;
      if (o.role === 'wire') return 'shock';
      if (o.role === 'rad') return 'radiation';
      if (o.role === 'liquid') {
        wet = true;
        continue;
      }
      if (o.role === 'lily') onLily = true;
      if (o.role === 'wall') {
        // Moving / switch-linked walls, doors and laser emitters are never pierced, nor thorn vines
        if (o.dynamic) return 'mover';
        if (o.src?.role !== 'wall' || o.src.vine) return 'wall';
        wallHit = true;
        continue;
      }
      onPath = true;
      if (o.src?.pierce) pierced = true;
    }
    if (wallHit && !pierced) return 'wall';
    if (wet && !onLily) return 'liquid';
    return onPath ? null : 'void';
  }

  /** Check the complete cursor sweep over [ta,tb], retaining fractional event times. */
  private checkSegment(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { map } = this;
    this.beginSegment(ta, tb);
    this.prepare(ta, xa, ya, tb, xb, yb);

    let deathU = Infinity;
    let reason: EndReason | null = this.hazardAt(0);
    if (reason) {
      deathU = 0;
    } else {
      // Between consecutive crossings the state can't change, so test one point per interval.
      // An interval shorter than SEAM_U is a rounding sliver where two flush shapes meet (e.g. a
      // ring sector's end against a straight path), not real ground, so it is skipped.
      let prev = 0;
      const cs = this.crossings;
      for (let k = 0; k <= cs.length; k++) {
        const c = k < cs.length ? cs[k] : 1;
        if (c - prev < SEAM_U && c < 1) continue;
        if (c > prev) {
          const hazard = this.hazardAt((prev + c) / 2);
          if (hazard) {
            deathU = prev;
            reason = hazard;
            break;
          }
          prev = c;
        }
      }
    }

    // Radioactive waste (#116 / #117): its aura, as large as it is at the end of this tick
    for (const i of this.wastes) {
      if (this.hidden[i]) continue;
      const o = this.objects[i];
      const at = this.clockB[i] ?? tb;
      toWorld(o, transformAt(o, at, tfA), o.cx, o.cy, pA);
      const u = segmentCircleEntry(xa, ya, xb, yb, pA.x, pA.y, auraRadius(this.map.objects[i].rad!.aura!, at));
      if (u >= 0 && u < deathU && !this.inSafeZone(xa + (xb - xa) * u, ya + (yb - ya) * u, tb)) {
        deathU = u;
        reason = 'radiation';
      }
    }

    // Laser beams (where they are at the end of this tick; swept area since its start)
    if (this.caster.any) {
      this.pendingBeams = this.caster.beams({
        timeOf: (i) => this.clockB[i], hidden: this.hidden, doorOpen: this.openB, channels: this.channels, power: this.power,
      });
      const u = beamHit(this.pendingBeams, this.beams, xa, ya, xb, yb);
      if (u >= 0 && u < deathU && !this.inSafeZone(xa + (xb - xa) * u, ya + (yb - ya) * u, tb)) {
        deathU = u;
        reason = 'laser';
      }
    }

    // Turrets aim and fire from where the cursor was; bullets and missiles fly this tick
    let shot: Shot | null = null;
    if (this.guns.any) {
      this.guns.step(ta, tb, xa, ya, this.gunState);
      const u = this.guns.cursorHit(xa, ya, xb, yb, this.shotHit);
      if (u >= 0 && u < deathU && !this.inSafeZone(xa + (xb - xa) * u, ya + (yb - ya) * u, tb)) {
        deathU = u;
        shot = this.shotHit.shot!;
        reason = shot.missile ? 'missile' : 'bullet';
      }
    }

    // Leaving the map bounds
    let exit = Infinity;
    if (xb < 0) exit = Math.min(exit, xa / (xa - xb));
    if (xb > map.width) exit = Math.min(exit, (map.width - xa) / (xb - xa));
    if (yb < 0) exit = Math.min(exit, ya / (ya - yb));
    if (yb > map.height) exit = Math.min(exit, (map.height - ya) / (yb - ya));
    if (exit < deathU) {
      deathU = Math.max(0, exit);
      reason = 'bounds';
    }

    // Coins touched before dying are collected; remember when the last one was picked up
    let lastCoinU = -Infinity;
    if (this.coinsLeft > 0) {
      const hits = this.coinHits(ta, xa, ya, tb, xb, yb, deathU, this.coins, COIN_MAGNET);
      if (this.coinsLeft === 0) lastCoinU = hits;
    }
    // The crystal star, picked up the same way (it doesn't lock GOAL)
    if (!this.crystalHeld && this.hasCrystal) this.coinHits(ta, xa, ya, tb, xb, yb, deathU, this.crystals, CRYSTAL_MAGNET);

    let goal = this.goalArea.entry(xa, ya, xb, yb);
    if (this.coinsLeft > 0) {
      goal = -1; // GOAL stays locked until every coin is collected
    } else if (goal >= 0 && lastCoinU > goal) {
      // The last coin was collected after entering GOAL: it counts if the cursor is still inside then
      const px = xa + (xb - xa) * lastCoinU;
      const py = ya + (yb - ya) * lastCoinU;
      goal = this.goalArea.contains(px, py) ? lastCoinU : -1;
    }
    // On a tie, death wins
    if (goal >= 0 && goal < deathU) {
      this.finish('cleared', null, goal, ta, xa, ya, tb, xb, yb);
    } else if (reason) {
      this.finish('dead', reason, deathU, ta, xa, ya, tb, xb, yb);
      if (shot && (reason === 'bullet' || reason === 'missile')) this.guns.explode(shot, this.x, this.y, this.endTime);
    } else {
      this.endSegment(ta, xa, ya, tb, xb, yb);
    }
  }

  // ───────────────────────── Switches ─────────────────────────

  private resetSwitches(): void {
    this.channels.set(initialChannels(this.map));
    this.timerEnd.fill(Infinity);
    this.timerObjEnd.fill(-Infinity);
    this.used.fill(0);
    this.inside.fill(0);
    this.holdAcc.fill(0);
    this.holdFired.fill(0);
    this.progress.fill(0);
    for (let i = 0; i < this.clock.length; i++) this.clock[i] = 0;
    this.pulleyTime?.fill(0);
    this.pulleyAngle?.fill(0);
    this.lastTurn?.fill(-Infinity);
    // Electric switches start as set, timers off; inverters settle from scratch
    this.powerOn?.fill(0);
    this.powerEnd?.fill(-Infinity);
    for (const i of this.devices ?? []) if (this.map.objects[i].power!.kind === 'switch' && this.map.objects[i].power!.initial) this.powerOn[i] = 1;
    this.circuit?.reset();
    this.evalPower(0);
    for (const d of this.doors) {
      const door = this.map.objects[d].door!;
      this.doorOpen[d] = this.circuit?.isTarget[d] ? this.power[d] : door.mode === 'auto' ? autoDoorOpen(door, 0) : this.channels[door.color];
    }
    this.updateDerived(0);
    // caster is created after the first reset in the constructor
    this.beams = this.caster?.any
      ? this.caster.beams({ timeOf: () => 0, hidden: this.hidden, doorOpen: this.doorOpen, channels: this.channels, power: this.power })
      : [];
  }

  /** Does the linked object's motion run with the current switch states? */
  private runs(i: number): boolean {
    const m = this.map.objects[i];
    const link = m.link;
    let ok = true;
    if (link && link.action !== 'remove' && link.action !== 'pulley') {
      const on = this.channels[link.color] === 1;
      ok = link.action === 'start' ? on : !on;
    }
    // A wired object (#91) that moves only while powered, or only while not
    if (this.circuit?.isTarget[i]) {
      const e = elecEffect(m);
      if (e === 'start') ok &&= this.power[i] === 1;
      else if (e === 'stop') ok &&= this.power[i] === 0;
    }
    return ok;
  }

  /** Does the (stopped) linked object play its motion backwards to its starting point? */
  private rewinds(i: number): boolean {
    const link = this.map.objects[i].link;
    return link?.action === 'start' && (this.revertColors & (1 << link.color)) !== 0;
  }

  /** Timers that ran out, then everybody's clock / door position at the end of the segment */
  private beginSegment(ta: number, tb: number): void {
    for (let c = 0; c < 16; c++) {
      if (this.timerEnd[c] <= ta) {
        this.timerEnd[c] = Infinity;
        this.channels[c] = 0;
      }
    }
    this.updateDerived(ta);
    const dt = tb - ta;
    this.unwindPulleys(tb, dt);
    for (let i = 0; i < this.clock.length; i++) this.clockB[i] = tb;
    for (const i of this.linked) {
      const link = this.map.objects[i].link;
      if (link?.action === 'pulley') this.clockB[i] = this.pulleyTime[link.color];
      else if (this.runs(i)) this.clockB[i] = this.clock[i] + dt;
      else if (this.rewinds(i)) this.clockB[i] = Math.max(0, this.clock[i] - dt);
      else this.clockB[i] = this.clock[i];
    }
    for (const d of this.doors) {
      const door = this.map.objects[d].door!;
      if (door.mode === 'auto' && !this.circuit?.isTarget[d]) this.openB[d] = autoDoorOpen(door, tb);
      else {
        // A wired door (#91) opens while powered
        const dir = (this.circuit?.isTarget[d] ? this.power[d] : this.channels[door.color]) ? 1 : -1;
        this.openB[d] = Math.min(1, Math.max(0, this.doorOpen[d] + (dir * dt) / door.moveMs));
      }
    }
    // Crates move against the walls and doors where they are at the end of this piece
    if (this.crates.length) this.moveCrates(ta, tb);
    // Metal boxes too, pulled by the magnets where they are now
    if (this.metals.length) this.moveMetals(ta, tb);
  }

  /** Commit the segment, then let triggers react to where the cursor went */
  private endSegment(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    this.clock.set(this.clockB);
    for (const d of this.doors) this.doorOpen[d] = this.openB[d];
    if (this.caster.any) this.beams = this.pendingBeams;
    this.checkPortals(xa, ya, xb, yb, tb);
    this.turnPulleys(xa, ya, xb, yb, tb);
    const dt = tb - ta;
    const out: number[] = [];
    /** Colors of pressure plates just stepped off */
    const plates: number[] = [];
    for (const i of this.triggers) {
      if (this.hidden[i]) continue;
      const trig = this.map.objects[i].trigger!;
      const o = this.objects[i];
      let ax = xa;
      let ay = ya;
      let bx = xb;
      let by = yb;
      if (o.dynamic) {
        // Clocks were already committed, so the start of the segment is approximated by its end
        toLocal(o, transformAt(o, this.clock[i], tfA), xa, ya, pA);
        toLocal(o, transformAt(o, this.clock[i], tfB), xb, yb, pB);
        ax = pA.x;
        ay = pA.y;
        bx = pB.x;
        by = pB.y;
      }
      const near = !(Math.max(ax, bx) < o.minX || Math.min(ax, bx) > o.maxX || Math.max(ay, by) < o.minY || Math.min(ay, by) > o.maxY);
      let touched = false;
      let insideB = false;
      let crossed = false;
      if (near) {
        insideB = pointInPoly(bx, by, o.poly);
        out.length = 0;
        if (ax !== bx || ay !== by) segmentPolyCrossings(ax, ay, bx, by, o.poly, out);
        crossed = out.length > 0;
        touched = insideB || crossed || pointInPoly(ax, ay, o.poly);
      }
      const was = this.inside[i] === 1;
      const entered = !was && touched;
      this.inside[i] = insideB ? 1 : 0;
      if (trig.momentary) {
        // Pressure plate: ON as it is stepped on, OFF once nothing of its color is pressed any more
        if (entered) {
          this.used[i] = 1;
          this.channels[trig.color] = 1;
        }
        // Stepped off (or only swept across it within this step)
        if (!insideB && (was || entered)) plates.push(trig.color);
        continue;
      }
      if (trig.kind === 'hold') {
        if (insideB && was && !crossed) this.holdAcc[i] += dt;
        else if (insideB) this.holdAcc[i] = dt * (1 - (out.length ? Math.max(...out) : 0));
        else {
          this.holdAcc[i] = 0;
          this.holdFired[i] = 0;
        }
        if (!this.holdFired[i] && this.holdAcc[i] >= (trig.duration ?? 1000)) {
          this.holdFired[i] = 1;
          this.activate(i, tb);
        }
      } else if (entered && !trig.click) {
        this.activate(i, tb);
      }
    }
    for (const c of plates) {
      const held = this.triggers.some((j) => {
        const t = this.map.objects[j].trigger!;
        return t.momentary && t.color === c && this.inside[j] === 1 && !this.hidden[j];
      });
      if (!held) {
        this.channels[c] = 0;
        this.timerEnd[c] = Infinity;
      }
    }
    // Electric switches and timers (#94 / #96) touched on the way: they never move
    for (const i of this.devices) {
      const p = this.map.objects[i].power!;
      if (p.kind !== 'switch' && p.kind !== 'timer') continue;
      const o = this.objects[i];
      const near = !(Math.max(xa, xb) < o.minX || Math.min(xa, xb) > o.maxX || Math.max(ya, yb) < o.minY || Math.min(ya, yb) > o.maxY);
      let touched = false;
      let insideB = false;
      if (near) {
        insideB = pointInPoly(xb, yb, o.poly);
        out.length = 0;
        if (xa !== xb || ya !== yb) segmentPolyCrossings(xa, ya, xb, yb, o.poly, out);
        touched = insideB || out.length > 0 || pointInPoly(xa, ya, o.poly);
      }
      const entered = this.inside[i] !== 1 && touched;
      this.inside[i] = insideB ? 1 : 0;
      // Electric pressure plate: powers while the cursor is on it
      if (p.momentary) this.powerOn[i] = touched ? 1 : 0;
      else if (entered && !p.click) this.powerActivate(i, tb);
    }
    this.updateDerived(tb);
  }

  /** An electric switch toggles, an electric timer starts powering */
  private powerActivate(i: number, t: number): void {
    const p = this.map.objects[i].power!;
    if (p.once && this.used[i]) return;
    this.used[i] = 1;
    if (p.kind === 'switch') this.powerOn[i] ^= 1;
    else if (p.kind === 'timer') this.powerEnd[i] = t + (p.duration ?? 3000);
  }

  /** Is electric device `i` a source that is on at `powerT`? (inverters are worked out by the circuit) */
  private readonly powerActive = (i: number): boolean => {
    const p = this.map.objects[i].power!;
    if (p.kind === 'switch') return this.powerOn[i] === 1;
    if (p.kind === 'timer') return this.powerEnd[i] > this.powerT;
    if (p.kind === 'pulley') return this.powerT - this.lastTurn[i] < GENERATOR_MS;
    return false;
  };

  /** Power everywhere at time t */
  private evalPower(t: number): void {
    if (!this.circuit) return;
    this.powerT = t;
    this.circuit.evaluate(this.powerActive, this.power);
  }

  /**
   * Circling the cursor inside a pulley turns it by the angle swept around its center (both ends of
   * the segment inside it); that winds its color's linked objects forward (clockwise) or back.
   */
  private turnPulleys(xa: number, ya: number, xb: number, yb: number, tb: number): void {
    const i = this.grabbed;
    if (i < 0) return;
    if (this.hidden[i]) {
      this.grabbed = -1;
      return;
    }
    // Electric pulleys (#95) power their wires while turned, either way
    if (this.objects[i].role === 'power') {
      const d = this.turnAngle(i, xa, ya, xb, yb);
      if (d === 0) return;
      this.lastTurn[i] = tb;
      this.pulleyAngle[i] += d;
      return;
    }
    const p = this.map.objects[i].pulley!;
    const d = this.turnAngle(i, xa, ya, xb, yb);
    if (d === 0) return;
    this.lastTurn[i] = tb;
    this.windPulley(i, (d / (Math.PI * 2)) * p.turnMs);
  }

  /** Where wheel `i`'s center is now (into pA) and how far (x, y) is from it */
  private wheelDistance(i: number, x: number, y: number): number {
    const o = this.objects[i];
    transformAt(o, this.clock[i], tfA);
    toWorld(o, tfA, o.cx, o.cy, pA);
    return Math.hypot(x - pA.x, y - pA.y);
  }

  private wheelRadius(i: number): number {
    const o = this.objects[i];
    return Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2;
  }

  /** The angle (radians, + = clockwise) the cursor swept around held wheel `i`'s center */
  private turnAngle(i: number, xa: number, ya: number, xb: number, yb: number): number {
    const db = this.wheelDistance(i, xb, yb);
    const da = Math.hypot(xa - pA.x, ya - pA.y);
    if (da < PULLEY_DEAD_ZONE || db < PULLEY_DEAD_ZONE) return 0;
    let d = Math.atan2(yb - pA.y, xb - pA.x) - Math.atan2(ya - pA.y, xa - pA.x);
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Move pulley `i`'s color `ms` along (clamped to the start and the end); the wheel turns with it */
  private windPulley(i: number, ms: number): void {
    const p = this.map.objects[i].pulley!;
    const before = this.pulleyTime[p.color];
    const after = Math.min(this.pulleyCap[p.color], Math.max(0, before + ms));
    this.pulleyTime[p.color] = after;
    this.pulleyAngle[i] += ((after - before) / p.turnMs) * Math.PI * 2;
  }

  /** Unwinding pulleys that haven't been turned lately run their objects back toward the start */
  private unwindPulleys(tb: number, dt: number): void {
    for (const i of this.pulleys) {
      const p = this.map.objects[i].pulley!;
      if (p.mode !== 'unwind' || p.unwind <= 0 || tb - this.lastTurn[i] < PULLEY_UNWIND_AFTER) continue;
      if (this.pulleyTime[p.color] > 0) this.windPulley(i, (-dt * p.unwind) / 100);
    }
  }

  /** Touching a portal starts the pull toward its center */
  private checkPortals(xa: number, ya: number, xb: number, yb: number, tb: number): void {
    if (!this.portals.length) return;
    const out: number[] = [];
    for (const i of this.portals) {
      if (this.hidden[i]) continue;
      const o = this.objects[i];
      let ax = xa;
      let ay = ya;
      let bx = xb;
      let by = yb;
      if (o.dynamic) {
        toLocal(o, transformAt(o, this.clock[i], tfA), xa, ya, pA);
        toLocal(o, transformAt(o, this.clock[i], tfB), xb, yb, pB);
        ax = pA.x;
        ay = pA.y;
        bx = pB.x;
        by = pB.y;
      }
      out.length = 0;
      if (ax !== bx || ay !== by) segmentPolyCrossings(ax, ay, bx, by, o.poly, out);
      const touching = pointInPoly(bx, by, o.poly) || out.length > 0;
      if (i === this.portalCooldown) {
        if (!touching) this.portalCooldown = -1; // left the arrival portal: it works again
        continue;
      }
      if (!touching || this.pull || this.map.objects[i].portal!.mode === 'out') continue;
      const dest = this.portalExit(i);
      if (dest < 0) continue;
      transformAt(o, this.clock[i], tfA);
      toWorld(o, tfA, o.cx, o.cy, pA);
      this.pull = { start: tb, end: tb + PORTAL_PULL_MS, fromX: xb, fromY: yb, toX: pA.x, toY: pA.y, dest };
    }
  }

  /** A trigger fires */
  private activate(i: number, t: number): void {
    const trig = this.map.objects[i].trigger!;
    if (trig.once && this.used[i]) return;
    this.used[i] = 1;
    const c = trig.color;
    switch (trig.kind) {
      case 'switch':
      case 'hold':
        this.channels[c] ^= 1;
        if (!this.channels[c]) this.timerEnd[c] = Infinity;
        break;
      case 'timer': {
        const end = t + (trig.duration ?? 3000);
        this.channels[c] = 1;
        this.timerEnd[c] = Math.max(this.timerEnd[c] === Infinity ? -Infinity : this.timerEnd[c], end);
        this.timerObjEnd[i] = end;
        break;
      }
      case 'startZone':
        this.channels[c] = 1;
        break;
      case 'stopZone':
        this.channels[c] = 0;
        this.timerEnd[c] = Infinity;
        break;
    }
  }

  /** Removal flags and drawing progress from the current switch states */
  private updateDerived(t: number): void {
    this.evalPower(t);
    for (const i of this.linked) {
      const m = this.map.objects[i];
      const link = m.link;
      // A spotlight switched off only goes dark (drawing and lights read the switch themselves)
      let hide = this.collected[i] === 1 || (link?.action === 'remove' && m.role !== 'spot' && this.channels[link.color] === 1);
      if (this.circuit?.isTarget[i] && !isLightRole(m)) {
        const e = elecEffect(m);
        if ((e === 'remove' && this.power[i]) || (e === 'show' && !this.power[i])) hide = true;
      }
      this.hidden[i] = hide ? 1 : 0;
    }
    for (const i of this.coins) if (this.collected[i]) this.hidden[i] = 1;
    for (const i of this.crystals) if (this.collected[i]) this.hidden[i] = 1;
    // Falling rocks are only there while falling (a switch can still remove them)
    for (const i of this.falls) {
      const falling = fallState(this.map.objects[i].fall!, this.clock[i]).falling;
      if (!falling) this.hidden[i] = 1;
      else if (!this.map.objects[i].link) this.hidden[i] = 0;
    }
    // Blinking paths / walls are only there while on (a switch can still remove them)
    for (const i of this.blinks) {
      if (!blinkState(this.map.objects[i].blink!, this.clock[i]).on) this.hidden[i] = 1;
      else if (!this.map.objects[i].link) this.hidden[i] = 0;
    }
    for (const i of this.triggers) {
      const trig = this.map.objects[i].trigger!;
      if (trig.kind === 'timer') {
        const end = this.timerObjEnd[i];
        this.progress[i] = this.channels[trig.color] && end > t ? (end - t) / (trig.duration ?? 3000) : 0;
      } else if (trig.kind === 'hold') {
        this.progress[i] = Math.min(1, this.holdAcc[i] / (trig.duration ?? 1000));
      }
    }
    // Electric timers (#96): the time left, for their display
    for (const i of this.devices ?? []) {
      const p = this.map.objects[i].power!;
      if (p.kind === 'timer') this.progress[i] = Math.max(0, this.powerEnd[i] - t) / (p.duration ?? 3000);
    }
  }

  /**
   * Collect every coin whose magnet range (COIN_MAGNET around its center) the segment enters
   * before `limit`. Returns the fraction at which the latest of them was reached (-Infinity if none).
   */
  /** Coins (or the crystal star) in `list` picked up along the segment, up to `limit`; returns the latest pickup */
  private coinHits(
    ta: number, xa: number, ya: number, tb: number, xb: number, yb: number, limit: number,
    list: readonly number[], magnet: number,
  ): number {
    let latest = -Infinity;
    for (const i of list) {
      if (this.collected[i]) continue;
      const o = this.objects[i];
      let ax = xa;
      let ay = ya;
      let bx = xb;
      let by = yb;
      if (this.hidden[i] && !this.collected[i]) continue; // removed by a switch
      if (o.dynamic) {
        const from = o.jumps?.(this.clock[i], this.clockB[i]) ? this.clockB[i] : this.clock[i];
        toLocal(o, transformAt(o, from, tfA), xa, ya, pA);
        toLocal(o, transformAt(o, this.clockB[i], tfB), xb, yb, pB);
        ax = pA.x;
        ay = pA.y;
        bx = pB.x;
        by = pB.y;
      }
      // Earliest point of the segment within the magnet range of the coin's center (local frame)
      const cx = o.cx;
      const cy = o.cy;
      const fx = ax - cx;
      const fy = ay - cy;
      const dx = bx - ax;
      const dy = by - ay;
      const c = fx * fx + fy * fy - magnet * magnet;
      let u = -1;
      if (c <= 0) u = 0;
      else {
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const disc = b * b - 4 * a * c;
        if (a > 0 && disc >= 0) {
          const r = (-b - Math.sqrt(disc)) / (2 * a);
          if (r >= 0 && r <= 1) u = r;
        }
      }
      if (u < 0 || u > limit) continue;
      this.collected[i] = 1;
      if (o.role === 'crystal') this.crystalHeld = true;
      else this.coinsLeft--;
      this.collectedAt[i] = ta + (tb - ta) * u;
      // Where the coin was at that moment, in map units
      const tf = transformAt(o, o.dynamic ? this.clock[i] : 0, tfA);
      toWorld(o, tf, cx, cy, pA);
      this.collectedPos[i * 2] = pA.x;
      this.collectedPos[i * 2 + 1] = pA.y;
      latest = Math.max(latest, u);
    }
    return latest;
  }

  private finish(
    status: 'dead' | 'cleared', reason: EndReason | null, f: number,
    ta: number, xa: number, ya: number, tb: number, xb: number, yb: number,
  ): void {
    this.status = status;
    this.endReason = reason;
    this.endTime = ta + (tb - ta) * f;
    this.time = this.endTime;
    this.x = xa + (xb - xa) * f;
    this.y = ya + (yb - ya) * f;
  }
}

/** Re-run a replay from scratch (for server-side record verification) */
export function runReplay(map: MapData, replay: Replay, checkBudget: () => void = () => {}): Simulation {
  // Replays without a step are from before steps were batched: 1 ms
  const sim = new Simulation(map, undefined, replay.simulationStepMs ?? 1, replay.simulationVersion !== 2);
  const [first, ...rest] = replay.samples;
  if (!first || first.t !== 0 || !sim.start(first.x, first.y)) return sim;
  // Button presses and releases, in time order (a press before a release at the same time)
  const buttons = [
    ...(replay.clicks ?? []).map((c) => ({ ...c, up: false })),
    ...(replay.releases ?? []).map((c) => ({ ...c, up: true })),
  ].sort((a, b) => a.t - b.t || Number(a.up) - Number(b.up));
  const press = (b: (typeof buttons)[number]) => (b.up ? sim.release(b.t, b.x, b.y) : sim.click(b.t, b.x, b.y));
  let k = 0;
  for (const s of rest) {
    checkBudget();
    // Buttons happen after the samples up to their time
    while (k < buttons.length && buttons[k].t < s.t) {
      checkBudget();
      press(buttons[k++]);
    }
    sim.feed(s.t, s.x, s.y);
  }
  while (k < buttons.length) {
    checkBudget();
    press(buttons[k++]);
  }
  if (replay.abort) sim.abort(replay.abort.reason);
  return sim;
}

/** ms → "12.345" (fractional milliseconds discarded, like saved records) */
export function formatTime(ms: number): string {
  return (displayTime(ms) / 1000).toFixed(3);
}

/** ms → "12.345s": the one way a run time is shown, in every language */
export function formatSeconds(ms: number): string {
  return `${formatTime(ms)}s`;
}
