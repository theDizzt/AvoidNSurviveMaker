import { pointInPoly, pointInRect, segmentPolyCrossings, segmentRectEntry } from './geometry';
import { compileMap, compileZone, toLocal, transformAt, type CompiledObject, type Transform } from './object';
import type { MapData, Point } from './types';

export type SimStatus = 'ready' | 'playing' | 'dead' | 'cleared';
export type AbortReason = 'left' | 'blur' | 'pointer';
/** wall: static wall · mover: moving/rotating wall · void: left the paths · bounds: left the map */
export type EndReason = 'wall' | 'mover' | 'void' | 'bounds' | AbortReason;

/** t: ms since the run started (START click), sub-millisecond precision preserved */
export interface ReplaySample {
  t: number;
  x: number;
  y: number;
}

export interface Replay {
  v: 1;
  samples: ReplaySample[];
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
 *   interval by interval: safe = (inside some path, or the map has no paths) and inside no wall.
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

  private readonly hasPaths: boolean;
  /** Objects used for collision: map objects + START/GOAL as safe floor when the map has paths */
  private readonly solids: readonly CompiledObject[];
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
    this.solids = this.hasPaths ? [...this.objects, compileZone(map.start), compileZone(map.goal)] : this.objects;
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
    this.samples = [{ t: 0, x, y }];
    // Check whether we already overlap something at the moment of starting
    this.checkSegment(0, x, y, 0, x, y);
    return true;
  }

  /** Feed one input sample. Samples at or before the already-processed time are ignored. */
  feed(t: number, x: number, y: number): void {
    if (this.status !== 'playing' || !(t > this.time)) return;
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.samples.push({ t, x, y });

    const st = this.time;
    const sx = this.x;
    const sy = this.y;
    const dt = t - st;

    while (this.status === 'playing') {
      const boundary = this.tick + 1;
      if (t < boundary) {
        this.checkSegment(this.time, this.x, this.y, t, x, y);
        if (this.status === 'playing') {
          this.time = t;
          this.x = x;
          this.y = y;
        }
        return;
      }
      // Cut the segment at the next 1 ms boundary and check that piece
      const f = (boundary - st) / dt;
      const bx = sx + (x - sx) * f;
      const by = sy + (y - sy) * f;
      this.checkSegment(this.time, this.x, this.y, boundary, bx, by);
      if (this.status !== 'playing') return;
      this.time = boundary;
      this.x = bx;
      this.y = by;
      this.tick = boundary;
      if (t === boundary) return;
    }
  }

  /** When the mouse is idle and no events arrive, advance time assuming the cursor stayed put */
  advanceTo(t: number): void {
    this.feed(t, this.x, this.y);
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
      let ax = xa;
      let ay = ya;
      let bx = xb;
      let by = yb;
      if (o.dynamic) {
        toLocal(o, transformAt(o, ta, tfA), xa, ya, pA);
        toLocal(o, transformAt(o, tb, tfB), xb, yb, pB);
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

  /** What the cursor is touching at fraction u of the prepared segment: null = safe */
  private hazardAt(u: number): 'wall' | 'mover' | 'void' | null {
    const { solids, local, relevant } = this;
    let onPath = !this.hasPaths;
    for (let k = 0; k < this.relevantCount; k++) {
      const i = relevant[k];
      const o = solids[i];
      if (o.role === 'path' && onPath) continue;
      const x = local[i * 4] + (local[i * 4 + 2] - local[i * 4]) * u;
      const y = local[i * 4 + 1] + (local[i * 4 + 3] - local[i * 4 + 1]) * u;
      if (!pointInPoly(x, y, o.poly)) continue;
      if (o.role === 'wall') return o.dynamic ? 'mover' : 'wall';
      onPath = true;
    }
    return onPath ? null : 'void';
  }

  /** Check the cursor's movement over [ta,tb] (within one 1 ms tick) */
  private checkSegment(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { map } = this;
    this.prepare(ta, xa, ya, tb, xb, yb);

    let deathU = Infinity;
    let reason: 'wall' | 'mover' | 'void' | 'bounds' | null = this.hazardAt(0);
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

    const g = map.goal;
    const goal = segmentRectEntry(xa, ya, xb, yb, g.x, g.y, g.w, g.h);
    // On a tie, death wins
    if (goal >= 0 && goal < deathU) {
      this.finish('cleared', null, goal, ta, xa, ya, tb, xb, yb);
    } else if (reason) {
      this.finish('dead', reason, deathU, ta, xa, ya, tb, xb, yb);
    }
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
export function runReplay(map: MapData, replay: Replay): Simulation {
  const sim = new Simulation(map);
  const [first, ...rest] = replay.samples;
  if (!first || first.t !== 0 || !sim.start(first.x, first.y)) return sim;
  for (const s of rest) sim.feed(s.t, s.x, s.y);
  if (replay.abort) sim.abort(replay.abort.reason);
  return sim;
}

/** ms → "12.345" (1 ms resolution, truncated) */
export function formatTime(ms: number): string {
  return (Math.floor(Math.max(0, ms)) / 1000).toFixed(3);
}
