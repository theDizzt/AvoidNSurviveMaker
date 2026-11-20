import { pointInPoly } from '../core/geometry';
import { ZoneArea, zoneShape } from '../core/zone';
import { compileObject, toLocal, transformAt, type CompiledObject, type Transform } from '../core/object';
import type { ReplaySample } from '../core/simulation';
import type { MapData, Point, Role } from '../core/types';

/**
 * Autopilot for the main menu demo: plans a cursor route from START to GOAL that dodges moving
 * obstacles, as a list of replay samples for the real Simulation.
 *
 * Space-time A* on a coarse grid: each step the cursor moves to a neighboring cell or waits, and
 * a step is allowed when a few points around the cell center are safe at the step's start, middle
 * and end. Plans are an approximation; the Simulation still decides whether the run survives.
 */

/** Maps the demo can't play by just moving (clicks, coins, teleports, beams…) */
const UNSUPPORTED: ReadonlySet<Role> = new Set<Role>(['coin', 'trigger', 'door', 'laser', 'mirror', 'portal', 'pulley', 'secret', 'turret']);

/** Grid cells across the longer map side */
const CELLS = 96;
/** Time per step (ms) */
const STEP_MS = 50;
/** Longest run planned (steps) */
const MAX_STEPS = 1000;
/** Search budget (expanded states) */
const MAX_EXPANSIONS = 160_000;
/** Expanded states between yields, so planning never blocks a frame for long */
const SLICE = 1500;

export function demoPlayable(map: MapData): boolean {
  return !map.darkness && map.objects.every((o) => !UNSUPPORTED.has(o.role) && !o.fall);
}

const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const local: Point = { x: 0, y: 0 };

function inside(o: CompiledObject, x: number, y: number, t: number): boolean {
  if (o.dynamic) {
    transformAt(o, t, tf);
    toLocal(o, tf, x, y, local);
    x = local.x;
    y = local.y;
  }
  return x >= o.minX && x <= o.maxX && y >= o.minY && y <= o.maxY && pointInPoly(x, y, o.poly);
}

/** Binary min-heap of state ids ordered by a parallel priority list */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const { ids, keys } = this;
    const top = ids[0];
    const id = ids.pop()!;
    const key = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

/**
 * Plan a run. Yields now and then (resume it on later frames); returns the samples
 * (t = 0 at START) or null when no route was found within the budget.
 */
export function* planDemoRun(map: MapData, objects: readonly CompiledObject[]): Generator<void, ReplaySample[] | null> {
  const cell = Math.max(map.width, map.height) / CELLS;
  const cols = Math.ceil(map.width / cell);
  const rows = Math.ceil(map.height / cell);
  const n = cols * rows;
  const margin = cell * 0.32;
  const offsets = [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]] as const;
  const P = offsets.length;

  const zones = [
    compileObject({ role: 'path', shape: zoneShape(map.start, map.startShape) }),
    compileObject({ role: 'path', shape: zoneShape(map.goal, map.goalShape) }),
  ];
  const startArea = new ZoneArea(map.start, map.startShape);
  const goalArea = new ZoneArea(map.goal, map.goalShape);
  const hasPaths = objects.some((o) => o.role === 'path');
  const floor = [...objects.filter((o) => o.role === 'path' || o.role === 'safe'), ...zones];
  const walls = objects.filter((o) => o.role === 'wall');
  const dynFloor = floor.filter((o) => o.dynamic);
  const dynWalls = walls.filter((o) => o.dynamic);

  // Static part of every probe point: 1 = on static floor, 2 = in a static wall, 4 = outside the map
  const probe = new Uint8Array(n * P);
  for (let c = 0; c < n; c++) {
    const cx = (c % cols + 0.5) * cell;
    const cy = (Math.floor(c / cols) + 0.5) * cell;
    for (let p = 0; p < P; p++) {
      const x = cx + offsets[p][0];
      const y = cy + offsets[p][1];
      let f = 0;
      if (x < 0 || y < 0 || x > map.width || y > map.height) f |= 4;
      if (!hasPaths || floor.some((o) => !o.dynamic && inside(o, x, y, 0))) f |= 1;
      if (walls.some((o) => !o.dynamic && inside(o, x, y, 0))) f |= 2;
      probe[c * P + p] = f;
    }
  }
  // Cells that can never be safe, whatever moves
  const blocked = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    for (let p = 0; p < P; p++) {
      const f = probe[c * P + p];
      if (f & 6 || (!(f & 1) && dynFloor.length === 0)) blocked[c] = 1;
    }
  }

  const safeAt = (c: number, t: number): boolean => {
    if (blocked[c]) return false;
    const cx = (c % cols + 0.5) * cell;
    const cy = (Math.floor(c / cols) + 0.5) * cell;
    for (let p = 0; p < P; p++) {
      const x = cx + offsets[p][0];
      const y = cy + offsets[p][1];
      for (const o of dynWalls) if (inside(o, x, y, t)) return false;
      if (!(probe[c * P + p] & 1) && !dynFloor.some((o) => inside(o, x, y, t))) return false;
    }
    return true;
  };
  /** Any point (not just cell probes), e.g. the middle of a diagonal step */
  const pointSafe = (cx: number, cy: number, t: number): boolean => {
    for (let p = 0; p < P; p++) {
      const x = cx + offsets[p][0];
      const y = cy + offsets[p][1];
      if (x < 0 || y < 0 || x > map.width || y > map.height) return false;
      if (walls.some((o) => inside(o, x, y, t))) return false;
      if (hasPaths && !floor.some((o) => inside(o, x, y, t))) return false;
    }
    return true;
  };
  const center = (c: number): [number, number] => [(c % cols + 0.5) * cell, (Math.floor(c / cols) + 0.5) * cell];

  // Start: the cell nearest the START center whose center is inside START
  const sx = map.start.x + map.start.w / 2;
  const sy = map.start.y + map.start.h / 2;
  let start = -1;
  let bestD = Infinity;
  for (let c = 0; c < n; c++) {
    const [x, y] = center(c);
    if (!startArea.contains(x, y)) continue;
    const d = Math.hypot(x - sx, y - sy);
    if (d < bestD && safeAt(c, 0)) {
      bestD = d;
      start = c;
    }
  }
  if (start < 0) return null;

  const g = map.goal;
  const isGoal = (c: number) => {
    const [x, y] = center(c);
    return goalArea.contains(x, y);
  };
  /** Steps to the goal rectangle, ignoring obstacles (Chebyshev, in cells) */
  const heuristic = (c: number) => {
    const [x, y] = center(c);
    const dx = Math.max(g.x - x, 0, x - (g.x + g.w));
    const dy = Math.max(g.y - y, 0, y - (g.y + g.h));
    return Math.ceil(Math.max(dx, dy) / cell);
  };

  const id = (k: number, c: number) => k * n + c;
  const seen = new Set<number>();
  const parent = new Map<number, number>();
  const heap = new Heap();
  heap.push(id(0, start), heuristic(start) * 1.4);
  seen.add(id(0, start));
  let expanded = 0;
  let found = -1;

  while (heap.size && expanded < MAX_EXPANSIONS) {
    const s = heap.pop();
    const k = Math.floor(s / n);
    const c = s - k * n;
    if (isGoal(c)) {
      found = s;
      break;
    }
    if (++expanded % SLICE === 0) yield;
    if (k >= MAX_STEPS) continue;
    const cx = c % cols;
    const cy = (c - cx) / cols;
    const t0 = k * STEP_MS;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const next = y * cols + x;
        const ns = id(k + 1, next);
        if (seen.has(ns)) continue;
        // Safe where it lands at the end of the step, and both cells at the middle of it
        if (!safeAt(next, t0 + STEP_MS) || !safeAt(next, t0 + STEP_MS / 2) || !safeAt(c, t0 + STEP_MS / 2)) continue;
        // A diagonal step passes the corner between its two side cells
        if (dx && dy && !pointSafe((cx + 0.5 + dx / 2) * cell, (cy + 0.5 + dy / 2) * cell, t0 + STEP_MS / 2)) continue;
        seen.add(ns);
        parent.set(ns, s);
        // Slight preference for moving on (waiting costs a little more than a step)
        heap.push(ns, k + 1 + (dx === 0 && dy === 0 ? 0.15 : 0) + heuristic(next) * 1.4);
      }
    }
  }
  if (found < 0) return null;

  const cells: number[] = [];
  for (let s: number | undefined = found; s !== undefined; s = parent.get(s)) cells.push(s - Math.floor(s / n) * n);
  cells.reverse();
  const samples: ReplaySample[] = cells.map((c, k) => {
    const [x, y] = center(c);
    return { t: k * STEP_MS, x, y };
  });
  // Step a little further into GOAL so the clear always registers
  const last = samples[samples.length - 1];
  samples.push({ t: last.t + STEP_MS, x: g.x + g.w / 2, y: g.y + g.h / 2 });
  return samples;
}
