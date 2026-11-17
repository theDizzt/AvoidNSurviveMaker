import type { Easing, Motion, Point, Repeat, Rotation } from './types';

export function ease(e: Easing, f: number): number {
  switch (e) {
    case 'in':
      return f * f;
    case 'out':
      return f * (2 - f);
    case 'inOut':
      return f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
    default:
      return f;
  }
}

/** One stretch of the route between two markers (or one full lap for circle), flattened to a polyline */
interface Leg {
  pts: Float64Array;
  cum: Float64Array;
  len: number;
  /** ms */
  dur: number;
}

function makeLeg(pts: number[], speed: number): Leg {
  const n = pts.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  }
  const len = cum[n - 1];
  return { pts: new Float64Array(pts), cum, len, dur: (len / speed) * 1000 };
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number, out: number[]): void {
  const t2 = t * t;
  const t3 = t2 * t;
  out.push(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  );
}

/** Flattened route legs for a motion whose anchor rests at `anchor` */
function buildLegs(m: Motion, anchor: Point): Leg[] {
  if (m.speed <= 0) return [];

  if (m.type === 'circle') {
    const c = m.points[0];
    if (!c) return [];
    const r = Math.hypot(anchor.x - c.x, anchor.y - c.y);
    if (r < 0.5) return [];
    const a0 = Math.atan2(anchor.y - c.y, anchor.x - c.x);
    const dir = m.clockwise ? 1 : -1; // screen y points down, so +angle is clockwise
    const n = Math.min(720, Math.max(32, Math.ceil((2 * Math.PI * r) / 3)));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + dir * (i / n) * Math.PI * 2;
      pts.push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    }
    return [makeLeg(pts, m.speed)];
  }

  const nodes = [anchor, ...m.points];
  if (nodes.length < 2) return [];
  const closed = m.repeat === 'loop';
  const count = closed ? nodes.length : nodes.length - 1;
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const pts: number[] = [];
    if (m.type === 'linear') {
      pts.push(a.x, a.y, b.x, b.y);
    } else {
      const at = (k: number) => {
        if (closed) return nodes[(k + nodes.length) % nodes.length];
        return nodes[Math.max(0, Math.min(nodes.length - 1, k))];
      };
      const p0 = at(i - 1);
      const p3 = at(i + 2);
      const steps = Math.min(128, Math.max(8, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3)));
      for (let s = 0; s <= steps; s++) catmullRom(p0, a, b, p3, s / steps, pts);
    }
    const leg = makeLeg(pts, m.speed);
    if (leg.len > 0) legs.push(leg);
  }
  return legs;
}

function pointOnLeg(leg: Leg, d: number, out: Point): void {
  const { pts, cum } = leg;
  const n = cum.length;
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const seg = cum[lo] - cum[lo - 1];
  const f = seg > 0 ? (d - cum[lo - 1]) / seg : 0;
  out.x = pts[lo * 2 - 2] + (pts[lo * 2] - pts[lo * 2 - 2]) * f;
  out.y = pts[lo * 2 - 1] + (pts[lo * 2 + 1] - pts[lo * 2 - 1]) * f;
}

/**
 * Time → displacement of the anchor from its rest position.
 * Closed-form in t (no accumulated state), so it is deterministic and can be evaluated at any time.
 */
export class CompiledMotion {
  readonly legs: Leg[];
  /** ms for one pass through all legs */
  readonly pass: number;

  constructor(readonly src: Motion, readonly anchor: Point) {
    this.legs = buildLegs(src, anchor);
    this.pass = this.legs.reduce((s, l) => s + l.dur, 0);
  }

  get moves(): boolean {
    return this.pass > 0;
  }

  offsetAt(t: number, out: Point): Point {
    out.x = 0;
    out.y = 0;
    if (this.pass <= 0) return out;
    let tt = t - this.src.delay;
    if (tt <= 0) return out;
    const { pass } = this;
    const repeat: Repeat = this.src.repeat;
    if (repeat === 'once') {
      tt = Math.min(tt, pass);
    } else if (repeat === 'pingpong') {
      tt %= pass * 2;
      // Running time backwards mirrors both the route and its easing
      if (tt > pass) tt = pass * 2 - tt;
    } else {
      tt %= pass;
    }
    for (const leg of this.legs) {
      if (tt <= leg.dur) {
        const f = leg.dur > 0 ? tt / leg.dur : 1;
        pointOnLeg(leg, ease(this.src.easing, f) * leg.len, out);
        out.x -= this.anchor.x;
        out.y -= this.anchor.y;
        return out;
      }
      tt -= leg.dur;
    }
    const last = this.legs[this.legs.length - 1];
    pointOnLeg(last, last.len, out);
    out.x -= this.anchor.x;
    out.y -= this.anchor.y;
    return out;
  }

  /**
   * Distance travelled along the route at time t: keeps growing on loops, goes back down on the
   * way back of a ping-pong. Used to spin rolling objects.
   */
  distanceAt(t: number): number {
    if (this.pass <= 0) return 0;
    let tt = t - this.src.delay;
    if (tt <= 0) return 0;
    const { pass } = this;
    const total = this.legs.reduce((s, l) => s + l.len, 0);
    let laps = 0;
    if (this.src.repeat === 'once') {
      tt = Math.min(tt, pass);
    } else if (this.src.repeat === 'pingpong') {
      tt %= pass * 2;
      if (tt > pass) tt = pass * 2 - tt;
    } else {
      laps = Math.floor(tt / pass);
      tt -= laps * pass;
    }
    let d = laps * total;
    for (const leg of this.legs) {
      if (tt <= leg.dur) return d + (leg.dur > 0 ? ease(this.src.easing, tt / leg.dur) : 1) * leg.len;
      tt -= leg.dur;
      d += leg.len;
    }
    return d;
  }

  /** The full route of the anchor as one flat polyline, for drawing in the editor */
  route(): number[] {
    const out: number[] = [];
    for (const leg of this.legs) for (const v of leg.pts) out.push(v);
    return out;
  }
}

/** Time → rotation angle (radians, + = clockwise on screen) */
export class CompiledRotation {
  /** ms for one sweep */
  readonly dur: number;

  constructor(readonly src: Rotation) {
    this.dur = src.speed > 0 && src.angle > 0 ? (src.angle / src.speed) * 1000 : 0;
  }

  angleAt(t: number): number {
    const r = this.src;
    if (this.dur <= 0) return 0;
    const tt = t - r.delay;
    if (tt <= 0) return 0;
    const dur = this.dur;
    let deg: number;
    if (r.repeat === 'once') {
      deg = ease(r.easing, Math.min(1, tt / dur)) * r.angle;
    } else if (r.repeat === 'pingpong') {
      const p = tt % (dur * 2);
      const f = p <= dur ? p / dur : (dur * 2 - p) / dur;
      deg = ease(r.easing, f) * r.angle;
    } else {
      const n = Math.floor(tt / dur);
      const f = (tt - n * dur) / dur;
      deg = ((n * r.angle) % 360) + ease(r.easing, f) * r.angle;
    }
    return ((r.clockwise ? 1 : -1) * deg * Math.PI) / 180;
  }
}
