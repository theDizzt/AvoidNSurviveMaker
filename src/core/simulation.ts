import { pointInPoly, pointInRect, segmentPolyCrossings, segmentRectEntry } from './geometry';
import { displayTime } from './time';
import { compileMap, compileObject, compileZone, toLocal, toWorld, transformAt, type CompiledObject, type Transform } from './object';
import { autoDoorOpen, doorPanels, initialChannels } from './switches';
import { BeamCaster, beamHit, type Beam } from './laser';
import { fallState } from './hazards';
import { CompiledMotion, CompiledRotation } from './motion';
import { shapeCenter } from './shape';

/** How long a portal pulls the cursor to its center before teleporting (ms) */
export const PORTAL_PULL_MS = 160;
/** A coin is collected once the cursor comes this close to its center (map units; the coin's radius is 12) */
export const COIN_MAGNET = 36;
/** How long a collected coin takes to fly into the cursor (ms, drawing only) */
export const COIN_PULL_MS = 180;
/** A crystal star (#59, 48×48) is picked up this close to its center */
export const CRYSTAL_MAGNET = 48;
/** An unwinding pulley (#52) starts running back this long (ms) after it was last turned */
export const PULLEY_UNWIND_AFTER = 150;
/** Turning only counts this far (map units) from a pulley's center, where the angle is stable */
const PULLEY_DEAD_ZONE = 3;
import type { MapData, Point } from './types';

export type SimStatus = 'ready' | 'playing' | 'dead' | 'cleared';
export type AbortReason = 'left' | 'blur' | 'pointer';
/** wall: static wall · mover: moving/rotating wall · void: outside the paths (counts as wall) · bounds: left the map */
export type EndReason = 'wall' | 'mover' | 'void' | 'bounds' | 'laser' | AbortReason;

/** t: ms since the run started (START click), sub-millisecond precision preserved */
export interface ReplaySample {
  t: number;
  x: number;
  y: number;
}

export interface Replay {
  v: 1;
  samples: ReplaySample[];
  /** Clicks during the run (click-activated switches), in time order */
  clicks?: ReplaySample[];
  abort?: { reason: AbortReason };
}

const tfA: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const tfB: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const pA: Point = { x: 0, y: 0 };
const pB: Point = { x: 0, y: 0 };

/**
 * Deterministic fixed 1 ms tick simulation.
 *
 * - The cursor path between input samples is treated as line segments, split at every 1 ms boundary.
 * - Each piece is tested against every object in that object's own local frame: the cursor
 *   endpoints are mapped through the inverse of the object's pose at the start and end of the
 *   piece. That turns moving and rotating objects into static polygons and the cursor's motion
 *   into a relative-motion segment, so nothing can be skipped over no matter how fast either moves.
 * - All boundary crossings along the segment are collected and the segment is checked
 *   interval by interval: safe = (inside some path, or the map has no paths) and inside no wall,
 *   where static walls don't count inside a path that cuts through walls (`pierce`).
 * - The same sample list always produces the same result, so replays can be verified on a server.
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

  // ── Lasers ──
  /** Beams at the current time (for drawing and the next tick's sweep test) */
  beams: Beam[] = [];
  private pendingBeams: Beam[] = [];
  private readonly caster: BeamCaster;

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

  private tick = 0;
  private samples: ReplaySample[] = [];
  private abortReason: AbortReason | null = null;

  constructor(map: MapData) {
    this.map = map;
    this.objects = compileMap(map);
    this.hasPaths = this.objects.some((o) => o.role === 'path');
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
      if (o.role === 'path' || o.role === 'wall' || o.role === 'laser') {
        // A laser emitter's body is as deadly as a wall
        solids.push(o.role === 'laser' ? { ...o, role: 'wall' } : o);
        src.push(i);
        doorOf.push(-1);
        slide.push(0, 0);
      } else if (o.role === 'door' && map.objects[i].shape.type === 'rect') {
        const s = map.objects[i].shape as { x: number; y: number; w: number; h: number };
        for (const half of doorPanels(s)) {
          solids.push({ ...compileObject({ role: 'wall', shape: { type: 'rect', ...half.rect } }), dynamic: true });
          src.push(i);
          doorOf.push(i);
          slide.push(half.slide.x, half.slide.y);
        }
      }
    });
    if (this.hasPaths) {
      solids.push(compileZone(map.start), compileZone(map.goal));
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
    this.linked = map.objects.flatMap((o, i) => (o.link ? [i] : []));
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
    this.resetSwitches();
    this.local = new Float64Array(this.solids.length * 4);
    this.relevant = new Int32Array(this.solids.length);
  }

  /** Number of 1 ms ticks processed */
  get ticks(): number {
    return this.tick;
  }

  /** Only starts when the click is inside the START area. */
  start(x: number, y: number): boolean {
    if (!pointInRect(x, y, this.map.start)) return false;
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
    this.resetSwitches();
    this.offX = 0;
    this.offY = 0;
    this.teleports = 0;
    this.pull = null;
    this.portalCooldown = -1;
    this.samples = [{ t: 0, x, y }];
    this.clicks = [];
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
        const end = Math.min(t, pull.end, this.tick + 1);
        const f = (end - pull.start) / (pull.end - pull.start);
        const px = pull.fromX + (pull.toX - pull.fromX) * f;
        const py = pull.fromY + (pull.toY - pull.fromY) * f;
        this.checkSegment(this.time, this.x, this.y, end, px, py);
        if (this.status !== 'playing') return;
        if (end === this.tick + 1) this.tick = end;
        this.time = end;
        this.x = px;
        this.y = py;
        if (end === pull.end) this.teleport(rx, ry);
        st = this.time;
        sx = this.x;
        sy = this.y;
        continue;
      }
      // Where the cursor is heading: the mouse plus the teleport offset
      const tx = rx + this.offX;
      const ty = ry + this.offY;
      const boundary = this.tick + 1;
      if (t < boundary) {
        this.checkSegment(this.time, this.x, this.y, t, tx, ty);
        if (this.status === 'playing') {
          this.time = t;
          this.x = tx;
          this.y = ty;
        }
        return;
      }
      // Cut the segment at the next 1 ms boundary and check that piece
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

  /** End of a portal pull: appear at the destination portal's center */
  private teleport(rx: number, ry: number): void {
    const pull = this.pull!;
    this.pull = null;
    const o = this.objects[pull.dest];
    transformAt(o, this.clock[pull.dest], tfA);
    toWorld(o, tfA, (o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2, pA);
    this.x = pA.x;
    this.y = pA.y;
    this.offX = this.x - rx;
    this.offY = this.y - ry;
    this.portalCooldown = pull.dest;
    this.teleports++;
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
    this.updateDerived(this.time);
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
    if (this.clicks.length) r.clicks = this.clicks.slice();
    if (this.abortReason) r.abort = { reason: this.abortReason };
    return r;
  }

  /** Map the segment into every object's local frame and gather boundary crossings */
  private prepare(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { solids, local, relevant, crossings } = this;
    crossings.length = 0;
    this.relevantCount = 0;
    for (let i = 0; i < solids.length; i++) {
      const o = solids[i];
      const srcIdx = this.solidSrc[i];
      if (srcIdx >= 0 && this.hidden[srcIdx]) continue; // removed by a switch
      let ax = xa;
      let ay = ya;
      let bx = xb;
      let by = yb;
      const door = this.solidDoor[i];
      if (door >= 0) {
        // Door half: its local frame is its closed position
        const sx = this.solidSlide[i * 2];
        const sy = this.solidSlide[i * 2 + 1];
        ax -= sx * this.doorOpen[door];
        ay -= sy * this.doorOpen[door];
        bx -= sx * this.openB[door];
        by -= sy * this.openB[door];
      } else if (o.dynamic) {
        toLocal(o, transformAt(o, this.clock[srcIdx] ?? ta, tfA), xa, ya, pA);
        toLocal(o, transformAt(o, this.clockB[srcIdx] ?? tb, tfB), xb, yb, pB);
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
  private hazardAt(u: number): 'wall' | 'mover' | 'void' | null {
    const { solids, local, relevant } = this;
    let onPath = !this.hasPaths;
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
      if (o.role === 'wall') {
        // Moving / switch-linked walls, doors and laser emitters are never pierced
        if (o.dynamic) return 'mover';
        if (o.src?.role !== 'wall') return 'wall';
        wallHit = true;
        continue;
      }
      onPath = true;
      if (o.src?.pierce) pierced = true;
    }
    if (wallHit && !pierced) return 'wall';
    return onPath ? null : 'void';
  }

  /** Check the cursor's movement over [ta,tb] (within one 1 ms tick) */
  private checkSegment(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { map } = this;
    this.beginSegment(ta, tb);
    this.prepare(ta, xa, ya, tb, xb, yb);

    let deathU = Infinity;
    let reason: 'wall' | 'mover' | 'void' | 'bounds' | 'laser' | null = this.hazardAt(0);
    if (reason) {
      deathU = 0;
    } else {
      // Between consecutive crossings the state can't change, so test one point per interval
      let prev = 0;
      const cs = this.crossings;
      for (let k = 0; k <= cs.length; k++) {
        const c = k < cs.length ? cs[k] : 1;
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

    // Laser beams (where they are at the end of this tick; swept area since its start)
    if (this.caster.any) {
      this.pendingBeams = this.caster.beams({
        timeOf: (i) => this.clockB[i], hidden: this.hidden, doorOpen: this.openB, channels: this.channels,
      });
      const u = beamHit(this.pendingBeams, this.beams, xa, ya, xb, yb);
      if (u >= 0 && u < deathU && !this.inSafeZone(xa + (xb - xa) * u, ya + (yb - ya) * u, tb)) {
        deathU = u;
        reason = 'laser';
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

    const g = map.goal;
    let goal = segmentRectEntry(xa, ya, xb, yb, g.x, g.y, g.w, g.h);
    if (this.coinsLeft > 0) {
      goal = -1; // GOAL stays locked until every coin is collected
    } else if (goal >= 0 && lastCoinU > goal) {
      // The last coin was collected after entering GOAL: it counts if the cursor is still inside then
      const px = xa + (xb - xa) * lastCoinU;
      const py = ya + (yb - ya) * lastCoinU;
      goal = pointInRect(px, py, g) ? lastCoinU : -1;
    }
    // On a tie, death wins
    if (goal >= 0 && goal < deathU) {
      this.finish('cleared', null, goal, ta, xa, ya, tb, xb, yb);
    } else if (reason) {
      this.finish('dead', reason, deathU, ta, xa, ya, tb, xb, yb);
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
    for (const d of this.doors) {
      const door = this.map.objects[d].door!;
      this.doorOpen[d] = door.mode === 'auto' ? autoDoorOpen(door, 0) : this.channels[door.color];
    }
    this.updateDerived(0);
    // caster is created after the first reset in the constructor
    this.beams = this.caster?.any
      ? this.caster.beams({ timeOf: () => 0, hidden: this.hidden, doorOpen: this.doorOpen, channels: this.channels })
      : [];
  }

  /** Does the linked object's motion run with the current switch states? */
  private runs(i: number): boolean {
    const link = this.map.objects[i].link;
    if (!link || link.action === 'remove') return true;
    const on = this.channels[link.color] === 1;
    return link.action === 'start' ? on : !on;
  }

  /** Does the (stopped) linked object play its motion backwards to its starting point? */
  private rewinds(i: number): boolean {
    const link = this.map.objects[i].link!;
    return link.action === 'start' && (this.revertColors & (1 << link.color)) !== 0;
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
      const link = this.map.objects[i].link!;
      if (link.action === 'pulley') this.clockB[i] = this.pulleyTime[link.color];
      else if (this.runs(i)) this.clockB[i] = this.clock[i] + dt;
      else if (this.rewinds(i)) this.clockB[i] = Math.max(0, this.clock[i] - dt);
      else this.clockB[i] = this.clock[i];
    }
    for (const d of this.doors) {
      const door = this.map.objects[d].door!;
      if (door.mode === 'auto') this.openB[d] = autoDoorOpen(door, tb);
      else {
        const dir = this.channels[door.color] ? 1 : -1;
        this.openB[d] = Math.min(1, Math.max(0, this.doorOpen[d] + (dir * dt) / door.moveMs));
      }
    }
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
    this.updateDerived(tb);
  }

  /**
   * Circling the cursor inside a pulley turns it by the angle swept around its center (both ends of
   * the segment inside it); that winds its color's linked objects forward (clockwise) or back.
   */
  private turnPulleys(xa: number, ya: number, xb: number, yb: number, tb: number): void {
    for (const i of this.pulleys) {
      if (this.hidden[i]) continue;
      const o = this.objects[i];
      const p = this.map.objects[i].pulley!;
      transformAt(o, this.clock[i], tfA);
      toWorld(o, tfA, (o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2, pA);
      const r = Math.min(o.maxX - o.minX, o.maxY - o.minY) / 2;
      const da = Math.hypot(xa - pA.x, ya - pA.y);
      const db = Math.hypot(xb - pA.x, yb - pA.y);
      if (da > r || db > r || da < PULLEY_DEAD_ZONE || db < PULLEY_DEAD_ZONE) continue;
      let d = Math.atan2(yb - pA.y, xb - pA.x) - Math.atan2(ya - pA.y, xa - pA.x);
      if (d > Math.PI) d -= Math.PI * 2;
      else if (d < -Math.PI) d += Math.PI * 2;
      if (d === 0) continue;
      this.lastTurn[i] = tb;
      this.windPulley(i, (d / (Math.PI * 2)) * p.turnMs);
    }
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
      toWorld(o, tfA, (o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2, pA);
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
    for (const i of this.linked) {
      const link = this.map.objects[i].link!;
      this.hidden[i] = (link.action === 'remove' && this.channels[link.color] === 1) || this.collected[i] === 1 ? 1 : 0;
    }
    for (const i of this.coins) if (this.collected[i]) this.hidden[i] = 1;
    for (const i of this.crystals) if (this.collected[i]) this.hidden[i] = 1;
    // Falling rocks are only there while falling (a switch can still remove them)
    for (const i of this.falls) {
      const falling = fallState(this.map.objects[i].fall!, this.clock[i]).falling;
      if (!falling) this.hidden[i] = 1;
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
        toLocal(o, transformAt(o, this.clock[i], tfA), xa, ya, pA);
        toLocal(o, transformAt(o, this.clockB[i], tfB), xb, yb, pB);
        ax = pA.x;
        ay = pA.y;
        bx = pB.x;
        by = pB.y;
      }
      // Earliest point of the segment within the magnet range of the coin's center (local frame)
      const cx = (o.minX + o.maxX) / 2;
      const cy = (o.minY + o.maxY) / 2;
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
  const sim = new Simulation(map);
  const [first, ...rest] = replay.samples;
  if (!first || first.t !== 0 || !sim.start(first.x, first.y)) return sim;
  const clicks = replay.clicks ?? [];
  let k = 0;
  for (const s of rest) {
    checkBudget();
    // Clicks happen after the samples up to their time
    while (k < clicks.length && clicks[k].t < s.t) {
      checkBudget();
      sim.click(clicks[k].t, clicks[k].x, clicks[k].y); k++;
    }
    sim.feed(s.t, s.x, s.y);
  }
  while (k < clicks.length) {
    checkBudget();
    sim.click(clicks[k].t, clicks[k].x, clicks[k].y); k++;
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
