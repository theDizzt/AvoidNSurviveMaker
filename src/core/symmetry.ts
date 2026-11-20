import { zoneRing } from './zone';
import { tiltedFlat } from './shape';
import type { MapData, MapObject } from './types';

/**
 * Editor symmetry check. `mirrorX`: left ↔ right across the vertical center line,
 * `mirrorY`: top ↔ bottom across the horizontal center line, `both`: both mirrors at once,
 * `rotate`: 180° about the map center (point symmetry).
 */
export type SymmetryMode = 'off' | 'mirrorX' | 'mirrorY' | 'both' | 'rotate';

export const SYMMETRY_MODES: readonly SymmetryMode[] = ['off', 'mirrorX', 'mirrorY', 'both', 'rotate'];

/** How far (map px) a mirrored outline may stray from its counterpart and still count as matching */
const TOLERANCE = 1.5;

/** The point (x, y) mapped by one symmetry (not 'off' / 'both') */
export function mirrorPoint(mode: Exclude<SymmetryMode, 'off' | 'both'>, w: number, h: number, x: number, y: number): [number, number] {
  switch (mode) {
    case 'mirrorX':
      return [w - x, y];
    case 'mirrorY':
      return [x, h - y];
    case 'rotate':
      return [w - x, h - y];
  }
}

interface Item {
  /** Objects only match objects of the same kind */
  kind: string;
  poly: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Kind of an object for matching: role plus the variants that look and play differently */
function kindOf(o: MapObject): string {
  return [
    o.role,
    o.saw?.kind ?? '',
    o.spike ? 'spike' : '',
    o.boulder ? 'boulder' : '',
    o.pierce ? 'pierce' : '',
    o.trigger?.kind ?? '',
    o.fog?.kind ?? '',
    o.motion ? 'moving' : '',
    o.rotation ? 'rotating' : '',
  ].join('|');
}

function item(kind: string, poly: Float64Array): Item {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]);
    maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]);
    maxY = Math.max(maxY, poly[i + 1]);
  }
  return { kind, poly, minX, minY, maxX, maxY };
}

function mirrored(it: Item, mode: Exclude<SymmetryMode, 'off' | 'both'>, w: number, h: number): Item {
  const out = new Float64Array(it.poly.length);
  for (let i = 0; i < out.length; i += 2) {
    const [x, y] = mirrorPoint(mode, w, h, it.poly[i], it.poly[i + 1]);
    out[i] = x;
    out[i + 1] = y;
  }
  return item(it.kind, out);
}

/** Squared distance from (px, py) to the closed ring `poly` */
function distSqToRing(px: number, py: number, poly: Float64Array): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const ax = poly[i];
    const ay = poly[i + 1];
    const bx = poly[(i + 2) % n];
    const by = poly[(i + 3) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    const ex = ax + dx * t - px;
    const ey = ay + dy * t - py;
    best = Math.min(best, ex * ex + ey * ey);
  }
  return best;
}

/** Every vertex of `a` lies on the outline of `b` */
function onOutline(a: Item, b: Item): boolean {
  const tol = TOLERANCE * TOLERANCE;
  for (let i = 0; i < a.poly.length; i += 2) if (distSqToRing(a.poly[i], a.poly[i + 1], b.poly) > tol) return false;
  return true;
}

function sameOutline(a: Item, b: Item): boolean {
  return a.kind === b.kind
    && Math.abs(a.minX - b.minX) <= TOLERANCE && Math.abs(a.maxX - b.maxX) <= TOLERANCE
    && Math.abs(a.minY - b.minY) <= TOLERANCE && Math.abs(a.maxY - b.maxY) <= TOLERANCE
    && onOutline(a, b) && onOutline(b, a);
}

export interface SymmetryReport {
  /** Indices of objects with no mirrored counterpart */
  objects: number[];
  start: boolean;
  goal: boolean;
}

/**
 * What breaks the map's symmetry: every object (in its resting position) whose mirror image isn't
 * matched by an object of the same kind with the same outline. An object that is symmetric by itself
 * (centered on the axis) is its own counterpart. START and GOAL may mirror each other or themselves.
 */
export function checkSymmetry(map: MapData, mode: SymmetryMode): SymmetryReport {
  const report: SymmetryReport = { objects: [], start: false, goal: false };
  if (mode === 'off') return report;
  const steps: Exclude<SymmetryMode, 'off' | 'both'>[] = mode === 'both' ? ['mirrorX', 'mirrorY'] : [mode];
  const objects = map.objects.map((o) => item(kindOf(o), tiltedFlat(o.shape, o.tilt).poly));
  const zones = [item('zone', zoneRing(map.start, map.startShape)), item('zone', zoneRing(map.goal, map.goalShape))];
  const broken = (it: Item, pool: Item[]) =>
    steps.some((step) => {
      const m = mirrored(it, step, map.width, map.height);
      return !pool.some((other) => sameOutline(m, other));
    });
  objects.forEach((it, i) => {
    if (broken(it, objects)) report.objects.push(i);
  });
  report.start = broken(zones[0], zones);
  report.goal = broken(zones[1], zones);
  return report;
}
