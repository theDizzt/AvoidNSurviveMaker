import type { Gear, Pendulum, Point, Press, Rect } from './types';

/**
 * Machines (#111–114): the outlines of a gear, a clock hand, a pendulum and a hydraulic press
 * (built from the object's box, before its tilt), and the movers of the pendulum and the press.
 * A gear and a clock hand turn with an ordinary rotation (beat by beat with `Rotation.tick`).
 */

export const DEFAULT_GEAR: Readonly<Gear> = { teeth: 12, depth: 22 };
export const DEFAULT_PENDULUM: Readonly<Pendulum> = { amplitude: 50, periodMs: 2400, delay: 0 };
export const DEFAULT_PRESS: Readonly<Press> = { reach: 120, downMs: 150, holdMs: 350, upMs: 900, waitMs: 900, delay: 0 };
export const GEAR_TEETH = { min: 3, max: 64 } as const;

function ring(points: number[]): Float64Array {
  return new Float64Array(points);
}

/** A toothed wheel filling the square in the middle of `r` */
export function gearRing(r: Rect, g: Gear): Float64Array {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R = Math.min(r.w, r.h) / 2;
  const inner = R * (1 - Math.min(80, Math.max(1, g.depth)) / 100);
  const n = Math.max(GEAR_TEETH.min, Math.min(GEAR_TEETH.max, Math.round(g.teeth)));
  const out: number[] = [];
  const at = (a: number, rr: number) => out.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  const step = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + k * step;
    at(a, inner);
    at(a + step * 0.18, inner);
    at(a + step * 0.3, R);
    at(a + step * 0.62, R);
    at(a + step * 0.74, inner);
  }
  return ring(out);
}

/** Along the box's long side: from the base end (`hub`) toward the tip (`axis`, a unit vector) */
function handFrame(r: Rect): { hub: Point; axis: Point; len: number; width: number } {
  const vertical = r.h >= r.w;
  const width = vertical ? r.w : r.h;
  const long = vertical ? r.h : r.w;
  // Upright: the hub at the bottom, the tip up; lying: the hub on the left, the tip right
  const axis = vertical ? { x: 0, y: -1 } : { x: 1, y: 0 };
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const hub = { x: cx - (axis.x * long) / 2 + (axis.x * width) / 2, y: cy - (axis.y * long) / 2 + (axis.y * width) / 2 };
  return { hub, axis, len: long - width / 2, width };
}

/** Where a clock hand turns: the middle of its hub */
export function handPivot(r: Rect): Point {
  return handFrame(r).hub;
}

/** A clock hand: a round hub at the base, tapering to a point at the tip */
export function handRing(r: Rect): Float64Array {
  const { hub, axis, len, width } = handFrame(r);
  const side = { x: -axis.y, y: axis.x };
  const p = (a: number, b: number, out: number[]) => out.push(hub.x + axis.x * a + side.x * b, hub.y + axis.y * a + side.y * b);
  const rr = width / 2;
  const hw = width * 0.28;
  const out: number[] = [];
  p(len, 0, out);
  p(len * 0.7, width * 0.12, out);
  const f0 = Math.asin(Math.min(1, hw / rr));
  const steps = 18;
  for (let k = 0; k <= steps; k++) {
    const f = f0 + ((Math.PI * 2 - 2 * f0) * k) / steps;
    p(Math.cos(f) * rr, Math.sin(f) * rr, out);
  }
  p(len * 0.7, -width * 0.12, out);
  return ring(out);
}

/** A pendulum's parts in its box (before the tilt): the pivot, the bob and the rod's width */
export function pendulumParts(r: Rect): { pivot: Point; bob: Point; bobR: number; rodW: number } {
  const bobR = Math.max(2, Math.min(r.w, r.h) / 2);
  const rodW = Math.max(4, bobR * 0.28);
  const cx = r.x + r.w / 2;
  return { pivot: { x: cx, y: r.y + rodW / 2 }, bob: { x: cx, y: r.y + r.h - bobR }, bobR, rodW };
}

/** Rod from the top of the box down to a round bob at its bottom */
export function pendulumRing(r: Rect): Float64Array {
  const { bob, bobR, rodW } = pendulumParts(r);
  const half = rodW / 2;
  const cx = bob.x;
  const out: number[] = [cx - half, r.y, cx + half, r.y];
  const d = Math.asin(Math.min(1, half / bobR));
  const steps = 28;
  for (let k = 0; k <= steps; k++) {
    const f = -Math.PI / 2 + d + ((Math.PI * 2 - 2 * d) * k) / steps;
    out.push(bob.x + Math.cos(f) * bobR, bob.y + Math.sin(f) * bobR);
  }
  return ring(out);
}

/** Swinging to either side of hanging straight down: a sine in time */
export class PendulumSwing {
  readonly dur: number;
  constructor(private readonly src: Pendulum) {
    this.dur = src.periodMs > 0 && src.amplitude > 0 ? src.periodMs : 0;
  }

  angleAt(t: number): number {
    if (this.dur <= 0) return 0;
    const tt = t - this.src.delay;
    if (tt < 0 && this.src.delay > 0) return 0;
    return ((this.src.amplitude * Math.PI) / 180) * Math.sin((tt / this.src.periodMs) * Math.PI * 2);
  }
}

/** A press's head and rod (one rigid piece) and its fixed cylinder, in its box before the tilt */
export function pressParts(r: Rect, p: Press): { head: Float64Array; cylinder: Rect } {
  const cx = r.x + r.w / 2;
  const rod = Math.max(6, r.w * 0.22);
  const top = r.y - p.reach - 4;
  const head = ring([
    r.x, r.y + r.h, r.x, r.y, cx - rod / 2, r.y, cx - rod / 2, top, cx + rod / 2, top, cx + rod / 2, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h,
  ]);
  const cw = Math.max(rod + 14, r.w * 0.7);
  return { head, cylinder: { x: cx - cw / 2, y: r.y - p.reach - 14, w: cw, h: p.reach + 14 } };
}

/** How far the press is shut, 0–1: open, slamming (speeding up), shut, rising */
export function pressExtension(p: Press, t: number): number {
  const cycle = p.waitMs + p.downMs + p.holdMs + p.upMs;
  if (cycle <= 0) return 0;
  let q = ((((t - p.delay) % cycle) + cycle) % cycle);
  if (q < p.waitMs) return 0;
  q -= p.waitMs;
  if (q < p.downMs) {
    const u = q / p.downMs;
    return u * u;
  }
  q -= p.downMs;
  if (q < p.holdMs) return 1;
  q -= p.holdMs;
  const u = p.upMs > 0 ? Math.min(1, q / p.upMs) : 1;
  return 1 - u * u * (3 - 2 * u);
}

/** Moves the press head `reach` px along its box's "down" (turned with the tilt, in degrees) */
export class PressMover {
  private readonly dx: number;
  private readonly dy: number;

  constructor(private readonly src: Press, tilt: number) {
    const a = (tilt * Math.PI) / 180;
    this.dx = -Math.sin(a) * src.reach;
    this.dy = Math.cos(a) * src.reach;
  }

  get moves(): boolean {
    return this.src.reach > 0 && this.src.downMs + this.src.holdMs + this.src.upMs + this.src.waitMs > 0;
  }

  /** The farthest offset (for bounds) */
  get reach(): Point {
    return { x: this.dx, y: this.dy };
  }

  offsetAt(t: number, out: Point): Point {
    const e = pressExtension(this.src, t);
    out.x = this.dx * e;
    out.y = this.dy * e;
    return out;
  }
}
