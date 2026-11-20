import { toWorld, transformAt, type CompiledObject, type Transform } from './object';
import { doorPanels } from './switches';
import { rotateRing } from './shape';
import type { MapData, Point, Turret } from './types';

/**
 * Turrets (#60) and homing missile launchers (#61): barrels, firing and projectiles.
 *
 * Everything is stepped by the simulation once per checked segment (at most 1 ms), from the
 * cursor position at the start of the segment, so the same replay always produces the same shots.
 * Projectiles are circles; a hit on the cursor is found from their relative motion within the
 * segment, so nothing can pass through anything else however fast either moves.
 */

/** Turrets and launchers are always this size (px, square) */
export const TURRET_SIZE = 60;
/** Bullets / missiles leave this far from the center (the end of the barrel / launch tube) */
export const MUZZLE = 30;
/** Hit radius of a bullet and of a missile (map units) */
export const BULLET_R = 4;
export const MISSILE_R = 6;
/** The gun fires once its barrel points at the cursor (within this angle) */
const AIM_TOLERANCE = (0.25 * Math.PI) / 180;
/** Shots further than this outside the map are gone */
const OFF_MAP = 40;
/** At most this many shots fly at once (the oldest disappear first) */
const MAX_SHOTS = 256;
/** How long an explosion stays in the list (ms, drawing only) */
export const BLAST_MS = 450;
/** A missile's smoke trail keeps a point this often (ms) and this many points */
const TRAIL_EVERY = 16;
const TRAIL_POINTS = 18;

export interface Shot {
  missile: boolean;
  /** Map object index of the turret that fired it */
  owner: number;
  /** Where it is now, and where it was at the start of the last step */
  x: number;
  y: number;
  px: number;
  py: number;
  /** Heading (radians, map space) */
  dir: number;
  /** px/ms */
  speed: number;
  /** missile: max steering, radians/ms */
  steer: number;
  pierce: boolean;
  born: number;
  /** missile: time it blows up by itself */
  dies: number;
  /** missile: smoke trail, [x0, y0, x1, y1, ...] oldest first */
  trail: number[];
  lastTrail: number;
}

export interface Blast {
  x: number;
  y: number;
  t: number;
  missile: boolean;
}

export interface TurretState {
  timeOf: (i: number) => number;
  hidden: Uint8Array;
  doorOpen: Float64Array;
}

const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const tmp: Point = { x: 0, y: 0 };

function wrap(a: number): number {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Where the barrel / tube rests and where the turret's center is at time t (map space) */
export function turretPose(o: CompiledObject, t: Turret, time: number, out: { x: number; y: number; rest: number }): void {
  transformAt(o, time, tf);
  toWorld(o, tf, o.cx, o.cy, tmp);
  out.x = tmp.x;
  out.y = tmp.y;
  out.rest = (t.angle * Math.PI) / 180 + Math.atan2(tf.sin, tf.cos);
}

/** Earliest fraction u ∈ [0, 1] at which segment A→B (relative to a circle's center at the origin) comes within r, or −1 */
function circleEntry(ax: number, ay: number, bx: number, by: number, r: number): number {
  const c = ax * ax + ay * ay - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return -1;
  const b = 2 * (ax * dx + ay * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const u = (-b - Math.sqrt(disc)) / (2 * a);
  return u >= 0 && u <= 1 ? u : -1;
}

export class TurretSystem {
  /** Map object indices of the turrets */
  readonly turrets: readonly number[];
  /** Per object (turrets): barrel direction relative to its rest direction (radians) */
  readonly aim: Float64Array;
  /** Per object (turrets): when it may fire next */
  private readonly nextFire: Float64Array;
  shots: Shot[] = [];
  /** Recent explosions (drawing) */
  blasts: Blast[] = [];

  /** Static walls never move, so their rings are built once */
  private readonly staticRings: { ring: Float64Array; owner: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  private readonly dynamicBlockers: number[] = [];
  private readonly doors: number[] = [];
  private readonly pose = { x: 0, y: 0, rest: 0 };

  constructor(private readonly map: MapData, private readonly objects: readonly CompiledObject[]) {
    this.turrets = map.objects.flatMap((m, i) => (m.role === 'turret' && m.turret ? [i] : []));
    this.aim = new Float64Array(objects.length);
    this.nextFire = new Float64Array(objects.length);
    objects.forEach((o, i) => {
      const r = o.role;
      if (r === 'door') {
        if (map.objects[i].shape.type === 'rect') this.doors.push(i);
        return;
      }
      if (r !== 'wall' && r !== 'mirror' && r !== 'laser' && r !== 'turret') return;
      if (o.dynamic) this.dynamicBlockers.push(i);
      else this.staticRings.push({ ring: o.poly, owner: i, minX: o.minX, minY: o.minY, maxX: o.maxX, maxY: o.maxY });
    });
  }

  get any(): boolean {
    return this.turrets.length > 0;
  }

  reset(): void {
    this.aim.fill(0);
    this.nextFire.fill(0);
    this.shots = [];
    this.blasts = [];
  }

  /**
   * Advance from ta to tb with the cursor at (cx, cy): projectiles fly (missiles steer), hit walls
   * and blow up, barrels turn, and turrets with the cursor in range fire.
   */
  step(ta: number, tb: number, cx: number, cy: number, st: TurretState): void {
    const dt = tb - ta;
    if (this.blasts.length && this.blasts[0].t < tb - BLAST_MS) this.blasts = this.blasts.filter((b) => b.t >= tb - BLAST_MS);
    if (dt <= 0) return;
    if (this.shots.length) this.moveShots(ta, tb, dt, cx, cy, st);
    for (const i of this.turrets) {
      if (st.hidden[i]) continue;
      const t = this.map.objects[i].turret!;
      turretPose(this.objects[i], t, st.timeOf(i), this.pose);
      const { x, y, rest } = this.pose;
      const inRange = Math.hypot(cx - x, cy - y) <= t.range;
      if (t.kind === 'gun') {
        // The barrel turns toward the cursor (within its arc), or back to rest when it's gone
        const want = inRange ? wrap(Math.atan2(cy - y, cx - x) - rest) : 0;
        const half = (Math.min(360, t.arc) * Math.PI) / 360;
        const full = t.arc >= 360;
        const target = full ? want : Math.max(-half, Math.min(half, want));
        const step = (t.turnSpeed * Math.PI * dt) / 180_000;
        // A full circle turns the short way round; an arc can't pass behind itself
        const diff = full ? wrap(target - this.aim[i]) : target - this.aim[i];
        this.aim[i] = Math.abs(diff) <= step ? (full ? wrap(target) : target) : wrap(this.aim[i] + Math.sign(diff) * step);
        if (inRange && tb >= this.nextFire[i] && Math.abs(wrap(want - this.aim[i])) <= AIM_TOLERANCE) {
          this.fire(i, t, x, y, rest + this.aim[i], tb);
        }
      } else if (inRange && tb >= this.nextFire[i]) {
        this.fire(i, t, x, y, rest, tb);
      }
    }
  }

  private fire(i: number, t: Turret, x: number, y: number, dir: number, tb: number): void {
    this.nextFire[i] = tb + t.fireMs;
    const sx = x + Math.cos(dir) * MUZZLE;
    const sy = y + Math.sin(dir) * MUZZLE;
    const missile = t.kind === 'missile';
    if (this.shots.length >= MAX_SHOTS) this.shots.shift();
    this.shots.push({
      missile, owner: i, x: sx, y: sy, px: sx, py: sy, dir, speed: t.speed / 1000,
      steer: missile ? (t.turnSpeed * Math.PI) / 180_000 : 0, pierce: t.pierce,
      born: tb, dies: missile ? tb + t.lifeMs : Infinity, trail: missile ? [sx, sy] : [], lastTrail: tb,
    });
  }

  private moveShots(ta: number, tb: number, dt: number, cx: number, cy: number, st: TurretState): void {
    const W = this.map.width;
    const H = this.map.height;
    let rings: { ring: Float64Array; owner: number; minX: number; minY: number; maxX: number; maxY: number }[] | null = null;
    const keep: Shot[] = [];
    for (const s of this.shots) {
      s.px = s.x;
      s.py = s.y;
      if (s.missile) {
        if (tb >= s.dies) {
          this.blasts.push({ x: s.x, y: s.y, t: s.dies, missile: true });
          continue;
        }
        // Steer toward the cursor, no faster than its turn rate: a smooth curve
        const want = Math.atan2(cy - s.y, cx - s.x);
        const d = wrap(want - s.dir);
        const max = s.steer * dt;
        s.dir = wrap(s.dir + Math.max(-max, Math.min(max, d)));
      }
      s.x += Math.cos(s.dir) * s.speed * dt;
      s.y += Math.sin(s.dir) * s.speed * dt;
      if (!s.pierce) {
        rings ??= this.blockers(st);
        const f = this.wallHit(s.px, s.py, s.x, s.y, s.owner, s.missile ? MISSILE_R * 0.5 : 0, rings);
        if (f >= 0) {
          const x = s.px + (s.x - s.px) * f;
          const y = s.py + (s.y - s.py) * f;
          this.blasts.push({ x, y, t: ta + dt * f, missile: s.missile });
          continue;
        }
      }
      if (s.x < -OFF_MAP || s.y < -OFF_MAP || s.x > W + OFF_MAP || s.y > H + OFF_MAP) continue;
      if (s.missile && tb - s.lastTrail >= TRAIL_EVERY) {
        s.lastTrail = tb;
        s.trail.push(s.x, s.y);
        if (s.trail.length > TRAIL_POINTS * 2) s.trail.splice(0, 2);
      }
      keep.push(s);
    }
    this.shots = keep;
  }

  /** Walls, mirrors, laser emitters, other turrets and door panels where they are now */
  private blockers(st: TurretState) {
    const out = this.staticRings.filter((b) => !st.hidden[b.owner]);
    for (const i of this.dynamicBlockers) {
      if (st.hidden[i]) continue;
      const o = this.objects[i];
      transformAt(o, st.timeOf(i), tf);
      const ring = new Float64Array(o.poly.length);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < o.poly.length; k += 2) {
        toWorld(o, tf, o.poly[k], o.poly[k + 1], tmp);
        ring[k] = tmp.x;
        ring[k + 1] = tmp.y;
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
      }
      out.push({ ring, owner: i, minX, minY, maxX, maxY });
    }
    for (const i of this.doors) {
      if (st.hidden[i]) continue;
      const m = this.map.objects[i];
      if (m.shape.type !== 'rect') continue;
      const open = st.doorOpen[i] ?? 0;
      const c = { x: m.shape.x + m.shape.w / 2, y: m.shape.y + m.shape.h / 2 };
      for (const h of doorPanels(m.shape)) {
        const x = h.rect.x + h.slide.x * open;
        const y = h.rect.y + h.slide.y * open;
        let ring: Float64Array = new Float64Array([x, y, x + h.rect.w, y, x + h.rect.w, y + h.rect.h, x, y + h.rect.h]);
        if (m.tilt) ring = rotateRing(ring, c, m.tilt);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let k = 0; k < ring.length; k += 2) {
          minX = Math.min(minX, ring[k]); maxX = Math.max(maxX, ring[k]);
          minY = Math.min(minY, ring[k + 1]); maxY = Math.max(maxY, ring[k + 1]);
        }
        out.push({ ring, owner: -1, minX, minY, maxX, maxY });
      }
    }
    return out;
  }

  /** Earliest fraction along A→B where it crosses a blocker's outline (or starts inside one), or −1 */
  private wallHit(
    ax: number, ay: number, bx: number, by: number, owner: number, pad: number,
    rings: readonly { ring: Float64Array; owner: number; minX: number; minY: number; maxX: number; maxY: number }[],
  ): number {
    let best = Infinity;
    const dx = bx - ax;
    const dy = by - ay;
    const lo = { x: Math.min(ax, bx) - pad, y: Math.min(ay, by) - pad };
    const hi = { x: Math.max(ax, bx) + pad, y: Math.max(ay, by) + pad };
    for (const b of rings) {
      if (b.owner === owner) continue; // a turret's own body doesn't stop its shots
      if (hi.x < b.minX || lo.x > b.maxX || hi.y < b.minY || lo.y > b.maxY) continue;
      const r = b.ring;
      const n = r.length;
      for (let k = 0, j = n - 2; k < n; j = k, k += 2) {
        const sx = r[j];
        const sy = r[j + 1];
        const ex = r[k] - sx;
        const ey = r[k + 1] - sy;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = sx - ax;
        const wy = sy - ay;
        const u = (wx * ey - wy * ex) / den;
        const v = (wx * dy - wy * dx) / den;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && u < best) best = u;
      }
    }
    return Number.isFinite(best) ? best : -1;
  }

  /**
   * Earliest fraction u ∈ [0, 1] of the cursor's segment A→B (over the last step) at which a shot
   * touches it, or −1. `hit` gets that shot.
   */
  cursorHit(ax: number, ay: number, bx: number, by: number, hit: { shot: Shot | null }): number {
    let best = Infinity;
    hit.shot = null;
    for (const s of this.shots) {
      const r = s.missile ? MISSILE_R : BULLET_R;
      const u = circleEntry(ax - s.px, ay - s.py, bx - s.x, by - s.y, r);
      if (u >= 0 && u < best) {
        best = u;
        hit.shot = s;
      }
    }
    return Number.isFinite(best) ? best : -1;
  }

  /** A shot that hit the cursor at (x, y) blows up there */
  explode(s: Shot, x: number, y: number, t: number): void {
    this.shots = this.shots.filter((o) => o !== s);
    this.blasts.push({ x, y, t, missile: s.missile });
  }
}
