import { ease } from './motion';
import type { Aura } from './types';

/**
 * Radioactive zones and waste (#115–117). A zone is deadly like a wall (the simulation treats its
 * outline as a solid); a piece of waste is deadly itself and inside its round `aura`, which grows
 * and shrinks over time — checked as a circle, since its size changes every moment.
 */

export const DEFAULT_AURA: Readonly<Aura> = { min: 40, max: 130, growMs: 1500, holdMs: 600, shrinkMs: 1500, restMs: 900, delay: 0 };

/** ms for one grow / hold / shrink / rest cycle */
export function auraCycle(a: Aura): number {
  return a.growMs + a.holdMs + a.shrinkMs + a.restMs;
}

/** Radius of the aura at time t (the object's own clock) */
export function auraRadius(a: Aura, t: number): number {
  const lo = Math.min(a.min, a.max);
  const hi = Math.max(a.min, a.max);
  const cycle = auraCycle(a);
  const tt = t - a.delay;
  if (cycle <= 0 || hi <= lo) return hi;
  if (tt < 0 && a.delay > 0) return lo;
  let p = ((tt % cycle) + cycle) % cycle;
  if (p < a.growMs) return lo + (hi - lo) * ease('inOut', p / a.growMs);
  p -= a.growMs;
  if (p < a.holdMs) return hi;
  p -= a.holdMs;
  if (p < a.shrinkMs) return hi - (hi - lo) * ease('inOut', p / a.shrinkMs);
  return lo;
}

/** The largest the aura gets (for bounds) */
export function auraReach(a: Aura): number {
  return Math.max(a.min, a.max);
}

/**
 * First fraction u in [0, 1] of the segment a→b that lies within r of c (0 when a already does),
 * or -1 when the segment never comes that close.
 */
export function segmentCircleEntry(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  if (r <= 0) return -1;
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const u = (-b - Math.sqrt(disc)) / (2 * a);
  return u >= 0 && u <= 1 ? u : -1;
}
