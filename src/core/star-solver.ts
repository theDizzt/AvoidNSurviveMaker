import { pointInPoly } from './geometry';
import { toLocal, transformAt, type CompiledObject, type Transform } from './object';
import { COIN_MAGNET, Simulation, type Replay, type SimSnapshot } from './simulation';
import type { MapData, StarTimes } from './types';
import { ZoneArea } from './zone';

/**
 * Star times from the fastest routes people can actually play (#star solver).
 *
 * A time-layered beam search drives the real Simulation (snapshot / restore at every branch), so
 * every mechanic is judged exactly as in a run. What it may try is limited by a model of a human:
 * - top speed, and the steering law (Accot–Zhai): through a corridor of width W a hand moves at
 *   most W / `steer`, so tight paths are slow and wide ones fast;
 * - acceleration: the cursor can't turn around on the spot;
 * - precision: near anything that moves, the same move must also survive being made `jitter` ms
 *   late or early and `margin` px to either side. Static edges only need STATIC_MARGIN for everyone:
 *   how hard a narrow way is, the steering law already says.
 * Four skill levels give four clear times; the slower levels take safer routes or wait for the next
 * opening, which is where the second-best routes come in. A strictness tier turns them into stars.
 */

export type SkillId = 'expert' | 'skilled' | 'casual' | 'careful';

export interface SkillProfile {
  id: SkillId;
  /** Top speed (map px / ms) */
  vMax: number;
  /** Steering-law slope (ms): the speed through a corridor of width W is at most W / steer */
  steer: number;
  /** Distance (px) kept from moving things */
  margin: number;
  /** Timing error (ms) a move near moving things must survive, early or late */
  jitter: number;
  /** Largest change of velocity (px / ms²) */
  accel: number;
}

export const SKILLS: readonly SkillProfile[] = [
  { id: 'expert', vMax: 3.5, steer: 70, margin: 4, jitter: 30, accel: 0.06 },
  { id: 'skilled', vMax: 2.6, steer: 95, margin: 7, jitter: 50, accel: 0.04 },
  { id: 'casual', vMax: 1.8, steer: 130, margin: 11, jitter: 80, accel: 0.025 },
  { id: 'careful', vMax: 1.2, steer: 180, margin: 15, jitter: 120, accel: 0.016 },
];

export type StarTier = 'relaxed' | 'normal' | 'tight' | 'brutal';
export const STAR_TIERS: readonly StarTier[] = ['relaxed', 'normal', 'tight', 'brutal'];

/** Per tier and star (three, two, one): which skill's clear time, times how much slack */
const TIER_RULES: Record<StarTier, readonly [SkillId, number][]> = {
  relaxed: [['casual', 1.05], ['careful', 1.15], ['careful', 1.6]],
  normal: [['skilled', 1.05], ['casual', 1.1], ['careful', 1.2]],
  tight: [['expert', 1.08], ['skilled', 1.1], ['casual', 1.15]],
  brutal: [['expert', 1], ['skilled', 1], ['casual', 1]],
};

/** Up to the next 0.1 s (ceiling) */
export function ceilTenth(ms: number): number {
  return Math.max(100, Math.ceil(ms / 100 - 1e-6) * 100);
}

/** Star times for a tier from each skill's clear time; always three < two < one */
export function starTimesFor(times: Record<SkillId, number>, tier: StarTier): StarTimes {
  const [a, b, c] = TIER_RULES[tier].map(([id, k]) => ceilTenth(times[id] * k));
  const three = a;
  const two = Math.max(b, three + 100);
  const one = Math.max(c, two + 100);
  return { three, two, one };
}

export interface SkillResult {
  id: SkillId;
  /** Clear time (ms), or null when no route was found */
  ms: number | null;
  /** The route as a replay (null when none) */
  replay: Replay | null;
}

export interface StarRating {
  skills: SkillResult[];
  /** Clear time per skill; a skill without a route of its own is estimated from the next faster one */
  times: Record<SkillId, number>;
  stars: StarTimes;
}

export interface SolveOptions {
  /** A clear time a person has already achieved (the editor's last test): the expert is at least that fast */
  observedMs?: number | null;
  /** Called now and then with the skill being searched and the run time reached (ms) */
  progress?: (skill: SkillId, ms: number) => void;
  /** Stop and give up when this returns true */
  cancelled?: () => boolean;
  /** Longest run (ms) searched */
  maxMs?: number;
}

/**
 * Orders of switches to try passing on the way: none first, then each one alone, then each pair
 * (when there are few)
 */
function candidatePlans(n: number): number[][] {
  const plans: number[][] = [[]];
  for (let a = 0; a < n; a++) plans.push([a]);
  if (n <= 4) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) plans.push([a, b]);
  return plans;
}

/** Slower skills that find no route of their own: this much slower than the next faster skill */
const FALLBACK_SLOWDOWN = 1.35;

export function rateStars(map: MapData, tier: StarTier, opts: SolveOptions = {}): StarRating {
  const solver = new RouteSolver(map);
  const skills: SkillResult[] = [];
  let cap = opts.maxMs ?? 120_000;
  let prevSkill: SkillProfile | null = null;
  // The switches to pass on the way, in order: found by the first skill, then followed by the rest
  let plan: number[] | null = null;
  for (const p of SKILLS) {
    let r: { ms: number; replay: Replay } | null = null;
    const plans: number[][] = plan ? [plan] : prevSkill ? [[]] : candidatePlans(solver.waypoints.length);
    for (const pl of plans) {
      if (opts.cancelled?.()) break;
      r = solver.solve(p, cap, opts, pl);
      if (r) {
        plan = pl;
        break;
      }
    }
    // Too tight for this skill's care: it gets through the way a better player does, at its own pace
    if (!r && prevSkill && !opts.cancelled?.()) r = solver.solve({ ...p, margin: prevSkill.margin, jitter: prevSkill.jitter }, cap, opts, plan ?? []);
    prevSkill = p;
    skills.push({ id: p.id, ms: r?.ms ?? null, replay: r?.replay ?? null });
    if (opts.cancelled?.()) break;
    // A slower player needs more time, but not unboundedly more
    if (r) cap = Math.min(opts.maxMs ?? 120_000, Math.max(30_000, r.ms * 6));
  }
  const raw: (number | null)[] = SKILLS.map((p) => skills.find((s) => s.id === p.id)?.ms ?? null);
  if (opts.observedMs) raw[0] = raw[0] === null ? opts.observedMs : Math.min(raw[0], opts.observedMs);
  // A better player can always take a worse player's route
  for (let i = raw.length - 2; i >= 0; i--) {
    const slower = raw[i + 1];
    if (slower !== null && (raw[i] === null || raw[i]! > slower)) raw[i] = slower;
  }
  const times = {} as Record<SkillId, number>;
  let prev: number | null = null;
  SKILLS.forEach((p, i) => {
    let ms = raw[i] ?? (prev === null ? NaN : prev * FALLBACK_SLOWDOWN);
    if (prev !== null && ms < prev) ms = prev;
    times[p.id] = ms;
    prev = ms;
  });
  return { skills, times, stars: starTimesFor(times, tier) };
}

// ───────────────────────── Static map: walkable cells, clearance, distances ─────────────────────────

/** Grid cell size (px) */
const CELL = 6;
/** Distance (px) everyone keeps from static edges */
const STATIC_MARGIN = 3;
/** How long (ms) a spot must stay clear of a moving wall for a person to pass it */
const HUMAN_WINDOW = 150;
/** Moving walls are followed this long (ms), this finely, to find where they never let anyone by */
const SWEEP_MS = 4000;
const SWEEP_STEP = 12;

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** Where a moving object can be (bounds over its whole motion) */
function reach(o: CompiledObject): Bounds {
  const b = o.interactionBounds ?? o.travelBounds;
  if (b) return b;
  // Turning without known bounds: anywhere within its reach around the shape's center
  const r = Math.hypot(o.maxX - o.minX, o.maxY - o.minY);
  return { minX: o.minX - r, minY: o.minY - r, maxX: o.maxX + r, maxY: o.maxY + r };
}

const WALL_LIKE = new Set(['wall', 'laser', 'turret', 'luggage', 'metal', 'magnet']);
const FLOOR_LIKE = new Set(['path', 'conveyor', 'lily']);

class StaticField {
  readonly cols: number;
  readonly rows: number;
  /** 1 = the cursor may be here, ignoring everything that moves or switches (optimistic) */
  readonly free: Uint8Array;
  /** Distance (px) from the cell center to the nearest non-free cell */
  readonly clear: Float32Array;
  /** Per cell: portal color + 1 (0 = none) */
  private readonly portal: Uint8Array;

  constructor(map: MapData, objects: readonly CompiledObject[]) {
    const cols = (this.cols = Math.ceil(map.width / CELL));
    const rows = (this.rows = Math.ceil(map.height / CELL));
    this.free = new Uint8Array(cols * rows);
    this.portal = new Uint8Array(cols * rows);
    const start = new ZoneArea(map.start, map.startShape);
    const goal = new ZoneArea(map.goal, map.goalShape);
    const hasPaths = objects.some((o) => o.role === 'path');
    const hasLily = objects.some((o) => o.role === 'lily');
    /** Cells inside a safe zone or a path cutting through walls: an outline crossing them doesn't block */
    const shielded = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * CELL;
        const y = (r + 0.5) * CELL;
        let safe = false;
        let floor = !hasPaths || start.contains(x, y) || goal.contains(x, y);
        let hard = false;
        let soft = false;
        let pierce = false;
        let wet = false;
        let rad = false;
        for (let i = 0; i < objects.length; i++) {
          const o = objects[i];
          const role = o.role;
          if (o.dynamic) {
            // Optimistic: a moving floor may be anywhere it travels; moving walls are left to the search
            if (!FLOOR_LIKE.has(role)) continue;
            const b = reach(o);
            if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
              floor = true;
              // A moving path that cuts through walls may carry the cursor across them
              if (o.src?.pierce) pierce = true;
            }
            continue;
          }
          if (x < o.minX || x > o.maxX || y < o.minY || y > o.maxY) continue;
          if (role === 'portal') {
            if (pointInPoly(x, y, o.poly)) this.portal[r * cols + c] = (map.objects[i].portal?.color ?? 0) + 1;
            continue;
          }
          if (role !== 'safe' && !FLOOR_LIKE.has(role) && !WALL_LIKE.has(role) && role !== 'liquid' && role !== 'rad') continue;
          if (!pointInPoly(x, y, o.poly)) continue;
          if (role === 'safe') safe = true;
          else if (FLOOR_LIKE.has(role)) {
            floor = true;
            if (o.src?.pierce) pierce = true;
          } else if (WALL_LIKE.has(role)) {
            if (role !== 'wall' || o.src?.vine) hard = true;
            else soft = true;
          } else if (role === 'liquid') wet = true;
          else rad = true;
        }
        this.free[r * cols + c] = safe || (floor && !hard && !(soft && !pierce) && !(wet && !hasLily) && !rad) ? 1 : 0;
        if (safe || pierce) shielded[r * cols + c] = 1;
      }
    }
    this.blockOutlines(objects, shielded);
    this.blockAlwaysCovered(map, objects);
    this.clear = this.distanceTransform();
  }

  /**
   * Every cell a static wall's outline runs through is blocked, not just those whose center it
   * covers: a sharp tip or thin strip of wall narrower than a cell still kills
   */
  private blockOutlines(objects: readonly CompiledObject[], shielded: Uint8Array): void {
    const { cols, rows, free } = this;
    for (const o of objects) {
      if (o.dynamic || !WALL_LIKE.has(o.role)) continue;
      const hard = o.role !== 'wall' || !!o.src?.vine;
      const ring = o.poly;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const x0 = ring[j], y0 = ring[j + 1], x1 = ring[i], y1 = ring[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 3)));
        for (let k = 0; k <= n; k++) {
          const c = Math.floor((x0 + ((x1 - x0) * k) / n) / CELL);
          const r = Math.floor((y0 + ((y1 - y0) * k) / n) / CELL);
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const cell = r * cols + c;
          if (hard || !shielded[cell]) free[cell] = 0;
        }
      }
    }
  }

  /**
   * Cells a moving wall never leaves free for long enough to slip through (a spinning saw that
   * stays put, its teeth, the hub of a turning bar) are blocked like a static wall
   */
  private blockAlwaysCovered(map: MapData, objects: readonly CompiledObject[]): void {
    const { cols, rows, free } = this;
    const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
    const p = { x: 0, y: 0 };
    const poses: Transform[] = [];
    for (let t = 0; t < SWEEP_MS; t += SWEEP_STEP) poses.push({ dx: 0, dy: 0, cos: 1, sin: 0 });
    const needRun = Math.ceil(HUMAN_WINDOW / SWEEP_STEP);
    objects.forEach((o, i) => {
      const m = map.objects[i];
      if (!o.dynamic || !WALL_LIKE.has(o.role) || m.link || m.blink || m.fall) return;
      poses.forEach((pose, k) => Object.assign(pose, transformAt(o, k * SWEEP_STEP, tf)));
      const b = reach(o);
      const c0 = Math.max(0, Math.floor(b.minX / CELL)), c1 = Math.min(cols - 1, Math.floor(b.maxX / CELL));
      const r0 = Math.max(0, Math.floor(b.minY / CELL)), r1 = Math.min(rows - 1, Math.floor(b.maxY / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * cols + c;
          if (!free[k]) continue;
          const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
          let run = 0;
          let open = false;
          for (const pose of poses) {
            toLocal(o, pose, x, y, p);
            if (pointInPoly(p.x, p.y, o.poly)) run = 0;
            else if (++run >= needRun) {
              open = true;
              break;
            }
          }
          if (!open) free[k] = 0;
        }
      }
    });
  }

  /** Chamfer (3-4) distance from every cell to the nearest blocked cell or the map edge */
  private distanceTransform(): Float32Array {
    const { cols, rows, free } = this;
    const d = new Float32Array(cols * rows);
    const BIG = 1e9;
    for (let k = 0; k < d.length; k++) d[k] = free[k] ? BIG : 0;
    const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : d[r * cols + c]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        if (!d[k]) continue;
        d[k] = Math.min(d[k], at(c - 1, r) + 3, at(c, r - 1) + 3, at(c - 1, r - 1) + 4, at(c + 1, r - 1) + 4);
      }
    }
    for (let r = rows - 1; r >= 0; r--) {
      for (let c = cols - 1; c >= 0; c--) {
        const k = r * cols + c;
        if (!d[k]) continue;
        d[k] = Math.min(d[k], at(c + 1, r) + 3, at(c, r + 1) + 3, at(c + 1, r + 1) + 4, at(c - 1, r + 1) + 4);
      }
    }
    // Units of a third of a cell; the edge lies half a cell before the blocked cell's center
    for (let k = 0; k < d.length; k++) d[k] = d[k] ? Math.max(0, (d[k] / 3 - 0.5) * CELL) : 0;
    return d;
  }

  cellOf(x: number, y: number): number {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  clearAt(x: number, y: number): number {
    const k = this.cellOf(x, y);
    return k < 0 ? 0 : this.clear[k];
  }

  /**
   * Shortest way from every cell to the nearest seed cell, through free cells at least `minClear` px
   * from any edge (portals link): in px, or in ms when `slowness` gives each cell's ms per px
   */
  distances(seed: (x: number, y: number) => boolean, minClear = 0, slowness: Float32Array | null = null): Float64Array {
    const { cols, rows, portal, clear } = this;
    const n = cols * rows;
    const free = minClear > 0 ? this.free.map((f, k) => (f && clear[k] >= minClear ? 1 : 0)) : this.free;
    const dist = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap();
    for (let k = 0; k < n; k++) {
      if (!free[k]) continue;
      if (seed(((k % cols) + 0.5) * CELL, (Math.floor(k / cols) + 0.5) * CELL)) {
        dist[k] = 0;
        heap.push(k, 0);
      }
    }
    // Portal cells by color, to link portals of a color as if next to each other
    const byColor = new Map<number, number[]>();
    for (let k = 0; k < n; k++) if (portal[k] && free[k]) (byColor.get(portal[k]) ?? byColor.set(portal[k], []).get(portal[k])!).push(k);
    const linked = new Set<number>();
    const D = Math.SQRT2 * CELL;
    while (heap.size) {
      const [k, dk] = heap.pop();
      if (dk > dist[k]) continue;
      const c = k % cols;
      const r = (k - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = rr * cols + cc;
          if (!free[j]) continue;
          // No cutting corners
          if (dr && dc && (!free[r * cols + cc] || !free[rr * cols + c])) continue;
          const len = dr && dc ? D : CELL;
          const nd = dk + (slowness ? (len * (slowness[k] + slowness[j])) / 2 : len);
          if (nd < dist[j]) {
            dist[j] = nd;
            heap.push(j, nd);
          }
        }
      }
      const color = portal[k];
      if (color && !linked.has(color)) {
        linked.add(color);
        for (const j of byColor.get(color)!) {
          if (dk < dist[j]) {
            dist[j] = dk;
            heap.push(j, dk);
          }
        }
      }
    }
    return dist;
  }

  /** A distance field read at (x, y): the best of the nearby cell centers plus the way there */
  sample(field: Float64Array, x: number, y: number, slowness: Float32Array | null = null): number {
    const c0 = Math.floor(x / CELL - 0.5);
    const r0 = Math.floor(y / CELL - 0.5);
    const here = this.cellOf(x, y);
    const k = slowness && here >= 0 ? slowness[here] : 1;
    let best = Infinity;
    for (let r = r0 - 1; r <= r0 + 2; r++) {
      for (let c = c0 - 1; c <= c0 + 2; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const v = field[r * this.cols + c];
        if (v === Infinity) continue;
        best = Math.min(best, v + Math.hypot((c + 0.5) * CELL - x, (r + 0.5) * CELL - y) * k);
      }
    }
    return best;
  }
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (vals[p] <= v) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const top: [number, number] = [keys[0], vals[0]];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && vals[m + 1] < vals[m]) m++;
        if (vals[m] >= v) break;
        keys[i] = keys[m];
        vals[i] = vals[m];
        i = m;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return top;
  }
}

// ───────────────────────── Route search ─────────────────────────

/** Time per decision (ms): a new direction / speed at most this often */
const STEP = 80;
/** States kept per time layer */
const BEAM = 150;
/**
 * At most PER_AREA of them in each AREA × AREA px square of the map (per game state): the beam
 * keeps players spread over every way through, the second-best routes and the spots to wait in
 * included, so one sweeping hazard or one dead end can't wipe out all of them
 */
const AREA = 120;
const PER_AREA = 6;
/** Moves simulated per state (the most promising by distance left, plus waiting) */
const TRIES = 9;
/** States closer than this (px) with the same velocity and game state count as one */
const MERGE = 14;
/** Once a clear is found, moves meant to end this close (ms) to finishing are still tried */
const FINISH_LOOKAHEAD = 40;
/** Give up when the time left hasn't shrunk for this long (ms of run time) */
const STALL_MS = 10_000;
/** Most switches considered as waypoints */
const MAX_WAYPOINTS = 6;
/** Most coins the exact visiting order is worked out for */
const MAX_EXACT_COINS = 12;

interface Guide {
  goalField: Float64Array;
  coinFields: Float64Array[];
  /** Time left from coin k, having to visit every coin in `mask` (k among them), then GOAL */
  tour: Float64Array | null;
  /** Per cell: ms per px at the speed the skill can go there */
  slowness: Float32Array;
  /** Per waypoint (switch): time field to it, built on first use */
  wayFields: Map<number, Float64Array>;
}

/** A switch the route may have to pass on the way */
interface Waypoint {
  /** Map object index */
  i: number;
  /** Where it rests, and how it moves on its own (null = it doesn't) */
  x: number;
  y: number;
  moving: CompiledObject | null;
  /** Spot to measure the way on from (the end of a 'once' route, else where it rests) */
  endX: number;
  endY: number;
}

interface Node {
  snap: SimSnapshot;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Coins still to collect, as bits */
  mask: number;
  /** Game state apart from where the cursor is (stateKey) */
  skey: string;
  /** Waypoints of the plan reached so far, and the switch state since the last one */
  wp: number;
  wsig: string;
  /** Time (ms) left to clear the level, at best */
  h: number;
}

export class RouteSolver {
  private readonly sim: Simulation;
  private readonly field: StaticField;
  private readonly coins: number[];
  /** Per coin: how close (px) the cursor must come to its center to take it */
  private readonly coinReach: number[];
  /** Time fields to GOAL and the coins for the skill being searched, and per skill */
  private guide!: Guide;
  private readonly guides = new Map<string, Guide>();
  /** Areas where things move (checked with timing / position errors) */
  private readonly movers: Bounds[];
  /** Something can reach anywhere (shots, beams, auras, pulling magnets): always check errors */
  private readonly everywhere: boolean;
  private readonly clickables: number[];
  /** Switches that may have to be passed, and the order the current search passes them in */
  readonly waypoints: Waypoint[];
  private plan: number[] = [];
  private vMaxInv = 1;

  constructor(readonly map: MapData) {
    this.sim = new Simulation(map);
    const objects = this.sim.objects;
    this.field = new StaticField(map, objects);
    this.coins = map.objects.flatMap((o, i) => (o.role === 'coin' ? [i] : []));
    this.coinReach = this.coins.map((i) => {
      const o = objects[i];
      return Math.max(o.maxX - o.minX, o.maxY - o.minY) / 2 + COIN_MAGNET;
    });
    const movers: Bounds[] = [];
    let everywhere = false;
    objects.forEach((o, i) => {
      const role = o.role;
      const m = map.objects[i];
      if (role === 'turret' || role === 'laser' || (role === 'rad' && m.rad?.aura) || (role === 'magnet' && m.magnet?.cursor) || m.fall) everywhere = true;
      if (role === 'door' || (role === 'wire' && !o.dynamic)) movers.push(o);
      else if (o.dynamic && (WALL_LIKE.has(role) || FLOOR_LIKE.has(role) || role === 'liquid' || role === 'rad' || role === 'wire')) movers.push(reach(o));
    });
    this.movers = movers;
    this.everywhere = everywhere;
    this.clickables = map.objects.flatMap((o, i) =>
      (o.role === 'trigger' && o.trigger?.click) || (o.role === 'power' && o.power?.click) ? [i] : []);
    const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
    this.waypoints = map.objects.flatMap((m, i): Waypoint[] => {
      const isSwitch = (m.role === 'trigger' && m.trigger && m.trigger.kind !== 'timer')
        || (m.role === 'power' && m.power && (m.power.kind === 'switch' || m.power.kind === 'timer'));
      if (!isSwitch) return [];
      const o = objects[i];
      const moving = o.dynamic && !m.link ? o : null;
      let endX = o.cx, endY = o.cy;
      if (moving && m.motion?.repeat === 'once') {
        transformAt(o, 1e9, tf);
        endX += tf.dx;
        endY += tf.dy;
      }
      return [{ i, x: o.cx, y: o.cy, moving, endX, endY }];
    }).slice(0, MAX_WAYPOINTS);
  }

  /** Time field (ms) to a waypoint: to where it rests, or anywhere along its way when it moves */
  private wayField(w: number): Float64Array {
    const g = this.guide;
    const known = g.wayFields.get(w);
    if (known) return known;
    const { i, moving } = this.waypoints[w];
    const o = this.sim.objects[i];
    const b = moving ? reach(o) : o;
    const pad = 4;
    const f = this.field.distances((x, y) => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad
      && (moving !== null || pointInPoly(x, y, o.poly) || Math.hypot(x - o.cx, y - o.cy) <= Math.max(CELL, (o.maxX - o.minX) / 2)), STATIC_MARGIN, g.slowness);
    g.wayFields.set(w, f);
    return f;
  }

  /** Least time (ms) from (x, y) at time t to the waypoint */
  private toWaypoint(w: number, x: number, y: number, t: number): number {
    const way = this.waypoints[w];
    let h = this.field.sample(this.wayField(w), x, y, this.guide.slowness);
    if (way.moving) {
      const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
      transformAt(way.moving, t, tf);
      h = Math.max(h, Math.hypot(x - (way.x + tf.dx), y - (way.y + tf.dy)) * this.vMaxInv);
    }
    return h;
  }

  /** Least time (ms) left: the waypoints still ahead (from `wp` on), then the coins and GOAL */
  private planLeft(x: number, y: number, mask: number, wp: number, t: number): number {
    if (wp >= this.plan.length) return this.timeLeft(x, y, mask);
    let h = this.toWaypoint(this.plan[wp], x, y, t);
    for (let k = wp; k < this.plan.length; k++) {
      const from = this.waypoints[this.plan[k]];
      h += k + 1 < this.plan.length
        ? this.field.sample(this.wayField(this.plan[k + 1]), from.endX, from.endY, this.guide.slowness)
        : this.timeLeft(from.endX, from.endY, mask);
    }
    return h;
  }

  /** Switch colors and power: what passing a waypoint changes */
  private switchSig(): string {
    const s = this.sim;
    let powered = 0;
    for (let i = 0; i < s.power.length; i++) powered = (powered * 31 + s.power[i]) | 0;
    return `${s.channels.join('')}|${powered}`;
  }

  /**
   * How long (ms) it takes this skill to get anywhere, at the steering-law speed each spot allows:
   * a guide toward the middle of a corridor, not along its edge where the hand has to crawl
   */
  private guideFor(p: SkillProfile): Guide {
    const id = `${p.vMax}/${p.steer}`;
    const known = this.guides.get(id);
    if (known) return known;
    const margin = STATIC_MARGIN;
    const slowness = this.field.clear.map((c) => 1 / Math.min(p.vMax, (2 * Math.max(c, STATIC_MARGIN)) / p.steer));
    const { map, field } = this;
    const objects = this.sim.objects;
    const goal = new ZoneArea(map.goal, map.goalShape);
    const goalField = field.distances((x, y) => goal.contains(x, y), margin, slowness);
    const coinFields = this.coins.map((i, k) => {
      const o = objects[i];
      const r = this.coinReach[k];
      // A coin that moves can be taken anywhere along its way
      if (o.dynamic) {
        const b = reach(o);
        return field.distances((x, y) => x >= b.minX - r && x <= b.maxX + r && y >= b.minY - r && y <= b.maxY + r, margin, slowness);
      }
      return field.distances((x, y) => Math.hypot(x - o.cx, y - o.cy) <= r, margin, slowness);
    });
    const g: Guide = { goalField, coinFields, tour: null, slowness, wayFields: new Map() };
    if (this.coins.length && this.coins.length <= MAX_EXACT_COINS) g.tour = this.buildTour(g);
    this.guides.set(id, g);
    return g;
  }

  private buildTour({ goalField, coinFields, slowness }: Guide): Float64Array {
    const K = this.coins.length;
    const centers = this.coins.map((i) => this.sim.objects[i]);
    const toGoal = centers.map((o) => this.field.sample(goalField, o.cx, o.cy, slowness));
    const between = centers.map((_, a) => centers.map((o) => this.field.sample(coinFields[a], o.cx, o.cy, slowness)));
    const G = new Float64Array((1 << K) * K).fill(Infinity);
    for (let mask = 1; mask < 1 << K; mask++) {
      for (let k = 0; k < K; k++) {
        if (!(mask & (1 << k))) continue;
        const rest = mask & ~(1 << k);
        if (!rest) {
          G[mask * K + k] = toGoal[k];
          continue;
        }
        let best = Infinity;
        for (let j = 0; j < K; j++) if (rest & (1 << j)) best = Math.min(best, between[k][j] + G[rest * K + j]);
        G[mask * K + k] = best;
      }
    }
    return G;
  }

  /** Least time (ms) left from (x, y) with the coins of `mask` still to collect */
  private timeLeft(x: number, y: number, mask: number): number {
    const { field } = this;
    const { goalField, coinFields, tour, slowness } = this.guide;
    const toGoal = field.sample(goalField, x, y, slowness);
    if (!mask) return toGoal;
    const K = this.coins.length;
    if (tour) {
      let best = Infinity;
      for (let k = 0; k < K; k++) if (mask & (1 << k)) best = Math.min(best, field.sample(coinFields[k], x, y, slowness) + tour[mask * K + k]);
      return best;
    }
    let lb = toGoal;
    for (let k = 0; k < K; k++) {
      if (!(mask & (1 << k))) continue;
      const o = this.sim.objects[this.coins[k]];
      lb = Math.max(lb, field.sample(coinFields[k], x, y, slowness) + field.sample(goalField, o.cx, o.cy, slowness));
    }
    return lb;
  }

  /** The coins a straight move from (x0, y0) to (x1, y1) should pick up, taken off `mask` */
  private predictMask(mask: number, x0: number, y0: number, x1: number, y1: number): number {
    if (!mask) return 0;
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let k = 0; k < this.coins.length && k < 31; k++) {
      if (!(mask & (1 << k))) continue;
      const o = this.sim.objects[this.coins[k]];
      if (o.dynamic) continue;
      const u = len2 ? Math.max(0, Math.min(1, ((o.cx - x0) * dx + (o.cy - y0) * dy) / len2)) : 0;
      if (Math.hypot(x0 + dx * u - o.cx, y0 + dy * u - o.cy) <= this.coinReach[k]) mask &= ~(1 << k);
    }
    return mask;
  }

  private coinMask(): number {
    let mask = 0;
    this.coins.forEach((i, k) => {
      if (!this.sim.collected[i] && k < 31) mask |= 1 << k;
    });
    return mask;
  }

  /** Discrete game state: what is collected, switched, opened */
  private stateKey(): string {
    const s = this.sim;
    return `${this.coinMask()}|${this.switchSig()}|${s.teleports}|${s.crystalHeld ? 1 : 0}`;
  }

  private needsCare(x0: number, y0: number, x1: number, y1: number, pad: number): boolean {
    if (this.everywhere) return true;
    const minX = Math.min(x0, x1) - pad, maxX = Math.max(x0, x1) + pad;
    const minY = Math.min(y0, y1) - pad, maxY = Math.max(y0, y1) + pad;
    return this.movers.some((b) => maxX >= b.minX && minX <= b.maxX && maxY >= b.minY && minY <= b.maxY);
  }

  /** Smallest clearance along a straight move (sampled every half cell, start excluded) */
  private clearAlong(x0: number, y0: number, x1: number, y1: number): number {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)));
    let min = Infinity;
    for (let i = 1; i <= n; i++) min = Math.min(min, this.field.clearAt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
    return min;
  }

  /**
   * Fastest clear for a skill level, or null when none is found within `maxMs`; `plan` lists
   * waypoints (switches) to pass first, in order
   */
  solve(p: SkillProfile, maxMs: number, opts: SolveOptions = {}, plan: number[] = []): { ms: number; replay: Replay } | null {
    const { sim } = this;
    this.guide = this.guideFor(p);
    this.plan = plan;
    this.vMaxInv = 1 / p.vMax;
    // START with no way out at all
    let layer = this.startNodes().filter((n) => n.h < Infinity);
    let best: { ms: number; replay: Replay } | null = null;
    let closest = Infinity;
    let closestAt = 0;
    for (let t = 0; t < maxMs && layer.length && t - closestAt < STALL_MS; t += STEP) {
      if (opts.cancelled?.()) return null;
      opts.progress?.(p.id, t);
      // Every move, ranked by where it is meant to end; simulated in that order until the beam is full
      const cands: { from: Node; vx: number; vy: number; click: boolean; x1: number; y1: number; h: number; key: string }[] = [];
      for (const node of layer) {
        for (const [vx, vy, click] of this.moves(node, p)) {
          const x1 = node.x + vx * STEP;
          const y1 = node.y + vy * STEP;
          const mask = this.predictMask(node.mask, node.x, node.y, x1, y1);
          const key = `${Math.round(x1 / MERGE)},${Math.round(y1 / MERGE)},${velocityBucket(vx, vy)}|${mask}|${node.skey}|${node.wp}`;
          cands.push({ from: node, vx, vy, click, x1, y1, h: this.planLeft(x1, y1, mask, node.wp, t + STEP), key });
        }
      }
      cands.sort((a, b) => a.h - b.h);
      const tried = new Set<string>();
      const kept = new Set<string>();
      const perArea = new Map<string, number>();
      const areaOf = (x: number, y: number, state: string) => `${Math.floor(x / AREA)},${Math.floor(y / AREA)}|${state}`;
      const care = p.margin + p.vMax * p.jitter;
      layer = [];
      for (const c of cands) {
        if (layer.length >= BEAM || (best && c.h > FINISH_LOOKAHEAD)) break;
        if (tried.has(c.key) || (perArea.get(areaOf(c.x1, c.y1, c.from.skey)) ?? 0) >= PER_AREA) continue;
        tried.add(c.key);
        const node = c.from;
        sim.restore(node.snap);
        const ox = sim.offX, oy = sim.offY;
        const teleportsBefore = sim.teleports;
        if (c.click) sim.click(t + 1, node.x - ox, node.y - oy);
        sim.feed(t + STEP, c.x1 - ox, c.y1 - oy);
        if (sim.status === 'cleared') {
          if (best && sim.endTime >= best.ms) continue;
          const ms = sim.endTime;
          const replay = sim.getReplay();
          if (!this.needsCare(node.x, node.y, c.x1, c.y1, care) || this.survivesErrors(node, c.x1, c.y1, t, p, c.click)) best = { ms, replay };
          continue;
        }
        if (sim.status !== 'playing' || best) continue;
        const cx = sim.x, cy = sim.y, svx = (cx - node.x) / STEP, svy = (cy - node.y) / STEP;
        const skey = this.stateKey();
        const sig = this.switchSig();
        const wp = node.wp < plan.length && sig !== node.wsig ? node.wp + 1 : node.wp;
        const key = `${Math.round(cx / MERGE)},${Math.round(cy / MERGE)},${velocityBucket(c.vx, c.vy)}|${skey}|${wp}`;
        if (kept.has(key)) continue;
        const mask = this.coinMask();
        // Where the hand is heading: what was meant, or (sliding, pushed) how the cursor really went;
        // a teleport is no movement of the hand at all
        const jumped = sim.teleports !== teleportsBefore;
        const sv = Math.hypot(svx, svy);
        const k = sv > p.vMax ? p.vMax / sv : 1;
        const child: Node = {
          snap: sim.snapshot(), x: cx, y: cy,
          vx: jumped ? 0 : Math.abs(svx - c.vx) < 1e-6 ? c.vx : svx * k, vy: jumped ? 0 : Math.abs(svy - c.vy) < 1e-6 ? c.vy : svy * k,
          mask, skey, wp, wsig: wp === node.wp ? node.wsig : sig, h: this.planLeft(cx, cy, mask, wp, t + STEP),
        };
        if (this.needsCare(node.x, node.y, c.x1, c.y1, care) && !this.survivesErrors(node, c.x1, c.y1, t, p, c.click)) continue;
        kept.add(key);
        layer.push(child);
        const area = areaOf(cx, cy, skey);
        perArea.set(area, (perArea.get(area) ?? 0) + 1);
      }
      if (best) return best;
      layer.sort((a, b) => a.h - b.h);
      if (layer.length && layer[0].h < closest - 1) {
        closest = layer[0].h;
        closestAt = t;
      }
    }
    return best;
  }

  /** The same move, made `jitter` ms late or early, and `margin` px to either side, also survives */
  private survivesErrors(node: Node, x1: number, y1: number, t: number, p: SkillProfile, click: boolean): boolean {
    const { sim } = this;
    const dx = x1 - node.x, dy = y1 - node.y;
    const len = Math.hypot(dx, dy);
    const nx = len ? -dy / len : Math.SQRT1_2, ny = len ? dx / len : Math.SQRT1_2;
    const tries: [number, number, number, number, number][] = [
      // [time it sets off, time it arrives, arrival x, y, extra wait]
      [t + p.jitter, t + STEP + p.jitter, x1, y1, 0],
      [t, t + Math.max(1, STEP - p.jitter), x1, y1, Math.min(p.jitter, STEP - 1)],
      [t, t + STEP, x1 + nx * p.margin, y1 + ny * p.margin, p.jitter],
      [t, t + STEP, x1 - nx * p.margin, y1 - ny * p.margin, p.jitter],
    ];
    for (const [t0, t1, ax, ay, wait] of tries) {
      sim.restore(node.snap);
      const ox = sim.offX, oy = sim.offY;
      if (click) sim.click(t + 1, node.x - ox, node.y - oy);
      if (t0 > t) sim.feed(t0, node.x - ox, node.y - oy);
      sim.feed(t1, ax - ox, ay - oy);
      if (wait > 0) sim.feed(t1 + wait, ax - ox, ay - oy);
      if (sim.status === 'dead') return false;
    }
    return true;
  }

  /** Candidate velocities (px / ms) from a state, the most promising first, plus waiting (and clicking) */
  private moves(node: Node, p: SkillProfile): [number, number, boolean][] {
    const { field } = this;
    const here = field.clearAt(node.x, node.y);
    const need = Math.min(STATIC_MARGIN, here);
    const mask = node.mask;
    const out: { v: [number, number, boolean]; h: number }[] = [];
    const seen = new Set<string>();
    const dv = p.accel * STEP;
    for (let a = 0; a < 16; a++) {
      const ux = Math.cos((a * Math.PI) / 8), uy = Math.sin((a * Math.PI) / 8);
      for (const share of [1, 0.5]) {
        // Steering law: as far as the narrowest point of the way so far allows, and no further than
        // the margin keeps clear
        const v = this.reachSpeed(node.x, node.y, ux, uy, p, share, need);
        let vx = ux * v, vy = uy * v;
        // Acceleration limit
        const ex = vx - node.vx, ey = vy - node.vy;
        const e = Math.hypot(ex, ey);
        if (e > dv) {
          vx = node.vx + (ex * dv) / e;
          vy = node.vy + (ey * dv) / e;
        }
        const x1 = node.x + vx * STEP, y1 = node.y + vy * STEP;
        if (this.clearAlong(node.x, node.y, x1, y1) < need) continue;
        const key = `${Math.round(x1)},${Math.round(y1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ v: [vx, vy, false], h: this.planLeft(x1, y1, mask, node.wp, this.sim.time + STEP) });
      }
    }
    out.sort((a, b) => a.h - b.h);
    const picked = out.slice(0, TRIES).map((o) => o.v);
    // Stopping (as quickly as the hand can)
    const s = Math.hypot(node.vx, node.vy);
    const k = s > dv ? (s - dv) / s : 0;
    const stop: [number, number, boolean] = [node.vx * k, node.vy * k, false];
    if (!picked.some(([vx, vy]) => vx === stop[0] && vy === stop[1]) && this.clearAlong(node.x, node.y, node.x + stop[0] * STEP, node.y + stop[1] * STEP) >= need) picked.push(stop);
    if (this.clickables.length && this.onClickable(node)) picked.push([stop[0], stop[1], true]);
    return picked;
  }

  /** Speed (px / ms) for one step heading (ux, uy): the steering law over the narrowest clearance on the way */
  private reachSpeed(x: number, y: number, ux: number, uy: number, p: SkillProfile, share: number, need: number): number {
    const inc = CELL / 2;
    const far = p.vMax * share * STEP;
    let c = Infinity;
    let ok = 0;
    for (let d = inc; d <= far + 1e-9; d += inc) {
      c = Math.min(c, this.field.clearAt(x + ux * d, y + uy * d));
      if (c < need) break;
      const vAllowed = Math.min(p.vMax, (2 * c) / p.steer) * share;
      if (d > vAllowed * STEP) {
        ok = Math.max(ok, vAllowed * STEP);
        break;
      }
      ok = d;
    }
    return ok / STEP;
  }

  private onClickable(node: Node): boolean {
    return this.clickables.some((i) => {
      const o = this.sim.objects[i];
      return !o.dynamic && pointInPoly(node.x, node.y, o.poly);
    });
  }

  /** Where to click START: the spots of START closest to the way out */
  private startNodes(): Node[] {
    const { sim, field, map } = this;
    const area = new ZoneArea(map.start, map.startShape);
    const spots: { x: number; y: number; h: number }[] = [];
    const s = map.start;
    const n = 12;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const x = s.x + (s.w * (0.04 + (0.92 * i) / n));
        const y = s.y + (s.h * (0.04 + (0.92 * j) / n));
        if (!area.contains(x, y) || field.clearAt(x, y) < STATIC_MARGIN) continue;
        spots.push({ x, y, h: this.planLeft(x, y, this.coins.length < 31 ? (2 ** this.coins.length) - 1 : 0x7fffffff, 0, 0) });
      }
    }
    if (!spots.length) spots.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, h: 0 });
    spots.sort((a, b) => a.h - b.h);
    const nodes: Node[] = [];
    for (const sp of spots.slice(0, 6)) {
      if (!sim.start(sp.x, sp.y) || sim.status !== 'playing') continue;
      const mask = this.coinMask();
      nodes.push({ snap: sim.snapshot(), x: sim.x, y: sim.y, vx: 0, vy: 0, mask, skey: this.stateKey(), wp: 0, wsig: this.switchSig(), h: this.planLeft(sim.x, sim.y, mask, 0, 0) });
    }
    return nodes;
  }
}

/** 0 = still, 1–8 = heading by octant, +8 when fast */
function velocityBucket(vx: number, vy: number): number {
  const s = Math.hypot(vx, vy);
  if (s < 0.05) return 0;
  const oct = ((Math.round((Math.atan2(vy, vx) / Math.PI) * 4) % 8) + 8) % 8;
  return 1 + oct + (s > 1.5 ? 8 : 0);
}
