import type { CompiledMotion } from './motion';
import type { Blink, Fall, Point, PolyPoint, Saw, Spike } from './types';

/**
 * Movement of a spike stake: rest → fast thrust (eases out) → slow return (eases in and out).
 * Same interface as CompiledMotion.offsetAt, so the object pose code treats it like any motion.
 */
export class SpikeMover {
  readonly cycle: number;
  private readonly dx: number;
  private readonly dy: number;

  constructor(readonly src: Spike) {
    this.cycle = src.waitMs + src.thrustMs + src.returnMs;
    const a = (src.angle * Math.PI) / 180;
    this.dx = Math.cos(a) * src.reach;
    this.dy = Math.sin(a) * src.reach;
  }

  get moves(): boolean {
    return this.cycle > 0 && this.src.reach > 0;
  }

  /** How far out the spike is, 0–1 */
  extensionAt(t: number): number {
    const s = this.src;
    const c = this.cycle;
    const p = (((t - s.delay) % c) + c) % c;
    if (p < s.waitMs) return 0;
    const q = p - s.waitMs;
    if (q < s.thrustMs) {
      const u = q / s.thrustMs;
      return 1 - (1 - u) ** 3;
    }
    const u = (q - s.thrustMs) / s.returnMs;
    return 1 - u * u * (3 - 2 * u);
  }

  offsetAt(t: number, out: Point): Point {
    const e = this.extensionAt(t);
    out.x = this.dx * e;
    out.y = this.dy * e;
    return out;
  }
}

/** Rolling: the spin angle follows the distance travelled along the route (angle = distance / radius) */
export class Roller {
  readonly dur = 1;

  constructor(private readonly motion: CompiledMotion, private readonly radius: number) {}

  angleAt(t: number): number {
    return this.motion.distanceAt(t) / Math.max(1, this.radius);
  }
}

/** A grinder disc spins at a steady speed (positive angle = clockwise on screen) */
export class SawSpin {
  readonly dur = 1;
  private readonly rate: number;

  constructor(saw: Saw) {
    this.rate = ((saw.clockwise ? 1 : -1) * saw.spin * Math.PI) / 180 / 1000;
  }

  angleAt(t: number): number {
    return this.rate * t;
  }
}

/**
 * A grinder / saw blade that also turns around a pivot (#62). One pose for both: the object turns
 * about its own center by the pivot turn plus its own spin, and that center swings around the
 * pivot; a blade's sawing runs along its turned long side. Used as both the motion and the
 * rotation of the compiled object (whose pivot is the saw's center).
 *
 *   world = R(θ+φ)(local − c) + R(θ)(c + s − p) + p + route
 */
export class SawTurn {
  readonly moves = true;
  readonly dur: number;
  private readonly tmp: Point = { x: 0, y: 0 };

  constructor(
    private readonly turn: { angleAt(t: number): number; readonly dur: number },
    private readonly spin: SawSpin | null,
    private readonly stroke: BladeMotion | null,
    private readonly route: { offsetAt(t: number, out: Point): Point } | null,
    private readonly center: Point,
    private readonly pivot: Point,
  ) {
    this.dur = Math.max(turn.dur, spin ? 1 : 0);
  }

  angleAt(t: number): number {
    return this.turn.angleAt(t) + (this.spin ? this.spin.angleAt(t) : 0);
  }

  offsetAt(t: number, out: Point): Point {
    const a = this.turn.angleAt(t);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let x = this.center.x - this.pivot.x;
    let y = this.center.y - this.pivot.y;
    if (this.stroke) {
      this.stroke.offsetAt(t, this.tmp);
      x += this.tmp.x;
      y += this.tmp.y;
    }
    out.x = cos * x - sin * y + this.pivot.x - this.center.x;
    out.y = sin * x + cos * y + this.pivot.y - this.center.y;
    if (this.route) {
      this.route.offsetAt(t, this.tmp);
      out.x += this.tmp.x;
      out.y += this.tmp.y;
    }
    return out;
  }
}

/** A saw blade's sawing: a quick back-and-forth along `axis` (unit vector), on top of its route */
export class BladeMotion {
  readonly moves = true;
  private readonly tmp: Point = { x: 0, y: 0 };

  constructor(
    private readonly route: { offsetAt(t: number, out: Point): Point } | null,
    private readonly axis: Point,
    private readonly saw: Saw,
  ) {}

  /** Signed position along the axis, -stroke/2 … +stroke/2 */
  strokeAt(t: number): number {
    const s = this.saw;
    return s.strokeMs > 0 ? (s.stroke / 2) * Math.sin((2 * Math.PI * t) / s.strokeMs) : 0;
  }

  offsetAt(t: number, out: Point): Point {
    const k = this.strokeAt(t);
    if (this.route) {
      this.route.offsetAt(t, this.tmp);
      out.x = this.tmp.x + this.axis.x * k;
      out.y = this.tmp.y + this.axis.y * k;
    } else {
      out.x = this.axis.x * k;
      out.y = this.axis.y * k;
    }
    return out;
  }
}

/** A fat eight-pointed star (rolling boulder) of outer radius r */
export function boulderShape(cx: number, cy: number, r: number): PolyPoint[] {
  // A chunky rock: 10 short knobs around a round body. Each knob has a small flat tip at the full
  // radius; between knobs the outline dips to a notch at 0.8 r (all corners, no curves).
  const KNOBS = 10;
  const pts: PolyPoint[] = [];
  const round = (v: number) => Math.round(v * 100) / 100;
  const at = (a: number, rr: number) => pts.push({ x: round(cx + Math.cos(a) * rr), y: round(cy + Math.sin(a) * rr) });
  const step = (Math.PI * 2) / KNOBS;
  for (let i = 0; i < KNOBS; i++) {
    const a = i * step - Math.PI / 2;
    at(a - step * 0.07, r);
    at(a + step * 0.07, r);
    at(a + step * 0.5, r * 0.8);
  }
  return pts;
}

/** A spear head pointing from `base` to `tip`, `width` wide at the base */
export function spikeShape(base: Point, tip: Point, width: number): PolyPoint[] {
  const len = Math.hypot(tip.x - base.x, tip.y - base.y) || 1;
  const nx = -(tip.y - base.y) / len;
  const ny = (tip.x - base.x) / len;
  const h = width / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  return [
    { x: r(tip.x), y: r(tip.y) },
    { x: r(base.x + nx * h), y: r(base.y + ny * h) },
    { x: r(base.x - nx * h), y: r(base.y - ny * h) },
  ];
}

/**
 * Where a blinking path / wall (#75–82) is in its cycle at time t: there (`on`) or not, and how
 * long (ms) until that changes.
 */
export function blinkState(b: Blink, t: number): { on: boolean; left: number } {
  const u = t - b.delay;
  if (b.offMs <= 0) return { on: true, left: Infinity };
  if (u < 0) return { on: true, left: -u + b.onMs };
  const cycle = b.onMs + b.offMs;
  const p = u % cycle;
  return p < b.onMs ? { on: true, left: b.onMs - p } : { on: false, left: cycle - p };
}

/**
 * Where a falling rock (#51) is in its cycle at time t: falling (fraction `u` of the drop, 0–1) or
 * not there; `sinceLanding` is the ms since it last landed (Infinity before the first landing).
 */
export function fallState(f: Fall, t: number): { falling: boolean; u: number; sinceLanding: number } {
  const tt = t - f.delay;
  const period = f.waitMs + f.fallMs;
  if (tt < 0 || period <= 0 || f.fallMs <= 0) return { falling: false, u: 0, sinceLanding: Infinity };
  const p = tt % period;
  const landed = tt >= period ? p : Infinity;
  if (p < f.waitMs) return { falling: false, u: 0, sinceLanding: landed };
  return { falling: true, u: (p - f.waitMs) / f.fallMs, sinceLanding: Infinity };
}

/**
 * The drop: from `height` above down to the resting place, speeding up (u²). While not falling it
 * rests at the landing place, hidden, so it never jumps within a collision check.
 */
export class FallMover {
  readonly moves = true;

  constructor(private readonly f: Fall) {}

  offsetAt(t: number, out: Point): Point {
    const s = fallState(this.f, t);
    out.x = 0;
    out.y = s.falling ? -this.f.height * (1 - s.u * s.u) : 0;
    return out;
  }
}

/** A falling rock tumbles a little on the way down */
export class FallSpin {
  readonly dur = 1;

  constructor(private readonly f: Fall) {}

  angleAt(t: number): number {
    const s = fallState(this.f, t);
    return s.falling ? s.u * s.u * Math.PI * 0.9 : 0;
  }
}
