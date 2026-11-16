import { pointInRect, segmentRectEntry } from './geometry';
import { compileMover, moverPos, type CompiledMover } from './mover';
import type { MapData, Point } from './types';

export type SimStatus = 'ready' | 'playing' | 'dead' | 'cleared';
export type AbortReason = 'left' | 'blur' | 'pointer';
export type EndReason = 'wall' | 'mover' | 'bounds' | AbortReason;

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

const tmp: Point = { x: 0, y: 0 };

/**
 * Deterministic fixed 1 ms tick simulation.
 *
 * - The cursor path between input samples (time + position) is treated as line segments
 *   and split at every 1 ms boundary before checking.
 * - Static walls: exact intersection against each sub-segment, so no move is ever fast
 *   enough to skip over a wall.
 * - Moving obstacles: positions are interpolated linearly between tick k and k+1 and checked
 *   as a relative-motion segment in the obstacle's frame, so even when the cursor and the
 *   obstacle both move and pass through each other, the hit is caught.
 * - The same sample list always produces the same result, so replays can be used for
 *   verification and leaderboard anti-cheat.
 */
export class Simulation {
  readonly map: MapData;
  readonly movers: readonly CompiledMover[];

  status: SimStatus = 'ready';
  /** Time (ms) up to which everything has been checked */
  time = 0;
  x = 0;
  y = 0;
  endReason: EndReason | null = null;
  /** Exact time (ms, fractional) of death or clear */
  endTime = 0;

  private tick = 0;
  /** Obstacle positions at tick k / k+1 as [x0,y0,x1,y1,...] */
  private mA: Float64Array;
  private mB: Float64Array;
  private samples: ReplaySample[] = [];
  private abortReason: AbortReason | null = null;

  constructor(map: MapData) {
    this.map = map;
    this.movers = map.movers.map(compileMover);
    this.mA = new Float64Array(this.movers.length * 2);
    this.mB = new Float64Array(this.movers.length * 2);
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
    this.loadMovers(0);
    // Check whether we already overlap an obstacle at the moment of starting
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
      this.advanceMovers(boundary);
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

  private loadMovers(k: number): void {
    for (let i = 0; i < this.movers.length; i++) {
      moverPos(this.movers[i], k, tmp);
      this.mA[i * 2] = tmp.x;
      this.mA[i * 2 + 1] = tmp.y;
      moverPos(this.movers[i], k + 1, tmp);
      this.mB[i * 2] = tmp.x;
      this.mB[i * 2 + 1] = tmp.y;
    }
  }

  private advanceMovers(k: number): void {
    const prev = this.mA;
    this.mA = this.mB;
    this.mB = prev;
    for (let i = 0; i < this.movers.length; i++) {
      moverPos(this.movers[i], k + 1, tmp);
      this.mB[i * 2] = tmp.x;
      this.mB[i * 2 + 1] = tmp.y;
    }
  }

  /** Check the cursor's movement segment over [ta,tb] ⊂ [tick, tick+1] */
  private checkSegment(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { map } = this;
    let best = Infinity;
    let reason: EndReason | null = null;

    for (const w of map.walls) {
      const e = segmentRectEntry(xa, ya, xb, yb, w.x, w.y, w.w, w.h);
      if (e >= 0 && e < best) {
        best = e;
        reason = 'wall';
      }
    }

    const fa = ta - this.tick;
    const fb = tb - this.tick;
    const { mA, mB } = this;
    for (let i = 0; i < this.movers.length; i++) {
      const m = this.movers[i].src;
      const ax = mA[i * 2] + (mB[i * 2] - mA[i * 2]) * fa;
      const ay = mA[i * 2 + 1] + (mB[i * 2 + 1] - mA[i * 2 + 1]) * fa;
      const bx = mA[i * 2] + (mB[i * 2] - mA[i * 2]) * fb;
      const by = mA[i * 2 + 1] + (mB[i * 2 + 1] - mA[i * 2 + 1]) * fb;
      // Convert to the obstacle's frame → the obstacle is a rectangle fixed at the origin
      const e = segmentRectEntry(xa - ax, ya - ay, xb - bx, yb - by, 0, 0, m.w, m.h);
      if (e >= 0 && e < best) {
        best = e;
        reason = 'mover';
      }
    }

    // Point where the segment leaves the map bounds
    let exit = Infinity;
    if (xb < 0) exit = Math.min(exit, xa / (xa - xb));
    if (xb > map.width) exit = Math.min(exit, (map.width - xa) / (xb - xa));
    if (yb < 0) exit = Math.min(exit, ya / (ya - yb));
    if (yb > map.height) exit = Math.min(exit, (map.height - ya) / (yb - ya));
    if (exit < best) {
      best = Math.max(0, exit);
      reason = 'bounds';
    }

    const g = map.goal;
    const goal = segmentRectEntry(xa, ya, xb, yb, g.x, g.y, g.w, g.h);
    // On a tie, death wins
    if (goal >= 0 && goal < best) {
      this.finish('cleared', null, goal, ta, xa, ya, tb, xb, yb);
    } else if (reason) {
      this.finish('dead', reason, best, ta, xa, ya, tb, xb, yb);
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
