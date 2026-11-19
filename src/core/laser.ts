import { toWorld, transformAt, type CompiledObject, type Transform } from './object';
import { doorPanels } from './switches';
import type { MapData, Point } from './types';

/**
 * Laser beams: a ray from each emitter's center, reflected by mirrors and stopped by walls,
 * doors, other emitters and the map edge. Beams are polylines in map coordinates.
 */
export interface Beam {
  color: number;
  /** [x0, y0, x1, y1, ...] */
  pts: number[];
}

/** Half the beam's thickness: touching within this distance is a hit */
export const BEAM_HALF = 2;
const MAX_BOUNCES = 24;
const EPS = 1e-6;

const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const tmp: Point = { x: 0, y: 0 };

/** Per-object state the beams depend on */
export interface BeamState {
  timeOf: (i: number) => number;
  hidden?: Uint8Array;
  doorOpen?: Float64Array;
  channels: Uint8Array;
}

export class BeamCaster {
  private readonly lasers: number[];
  /** Static rings never move, so they're built once */
  private readonly staticRings = new Map<number, Float64Array>();
  private readonly dynamicRings = new Map<number, Float64Array>();
  private readonly relevant: number[];
  private readonly previousState: Float64Array;
  private cachedBeams: Beam[] | null = null;

  constructor(private readonly map: MapData, private readonly objects: readonly CompiledObject[]) {
    this.lasers = objects.flatMap((o, i) => (o.role === 'laser' ? [i] : []));
    this.relevant = objects.flatMap((o, i) =>
      o.role === 'wall' || o.role === 'mirror' || o.role === 'laser' || o.role === 'door' ? [i] : []);
    this.previousState = new Float64Array(this.relevant.length * 3 + 16).fill(NaN);
    objects.forEach((o, i) => {
      if (!o.dynamic && (o.role === 'wall' || o.role === 'mirror' || o.role === 'laser')) this.staticRings.set(i, o.poly);
    });
  }

  get any(): boolean {
    return this.lasers.length > 0;
  }

  private ring(i: number, t: number): Float64Array {
    const hit = this.staticRings.get(i);
    if (hit) return hit;
    const o = this.objects[i];
    transformAt(o, t, tf);
    let out = this.dynamicRings.get(i);
    if (!out) this.dynamicRings.set(i, out = new Float64Array(o.poly.length));
    for (let k = 0; k < o.poly.length; k += 2) {
      toWorld(o, tf, o.poly[k], o.poly[k + 1], tmp);
      out[k] = tmp.x;
      out[k + 1] = tmp.y;
    }
    return out;
  }

  beams(st: BeamState): Beam[] {
    if (!this.lasers.length) return [];
    // Copy scalar values: the caller mutates its typed arrays in place each tick.
    // Time matters only for objects with actual motion/rotation, not static links.
    let changed = this.cachedBeams === null;
    let k = 0;
    const check = (value: number) => {
      if (this.previousState[k] !== value) changed = true;
      this.previousState[k++] = value;
    };
    for (const i of this.relevant) {
      const o = this.objects[i];
      const hidden = st.hidden?.[i] ?? 0;
      check(hidden);
      check(!hidden && (o.motion || o.rotation) ? st.timeOf(i) : 0);
      check(o.role === 'door' ? st.doorOpen?.[i] ?? 0 : 0);
    }
    for (let c = 0; c < 16; c++) check(st.channels[c]);
    if (!changed) return this.cachedBeams!;
    const active = this.lasers.filter(i => {
      const l = this.map.objects[i].laser;
      return !st.hidden?.[i] && l && l.on !== (l.switchColor !== undefined && st.channels[l.switchColor] === 1);
    });
    if (!active.length) return this.cachedBeams = [];
    const blockers: { ring: Float64Array; owner: number }[] = [];
    const mirrors: Float64Array[] = [];
    for (const i of this.relevant) {
      const o = this.objects[i];
      if (st.hidden?.[i]) continue;
      if (o.role === 'wall' || o.role === 'laser') blockers.push({ ring: this.ring(i, st.timeOf(i)), owner: i });
      else if (o.role === 'mirror') mirrors.push(this.ring(i, st.timeOf(i)));
    }
    // Doors: both halves where they currently are
    for (const i of this.relevant) {
      const m = this.map.objects[i];
      if (m.role !== 'door' || m.shape.type !== 'rect') continue;
      const open = st.doorOpen?.[i] ?? 0;
      for (const h of doorPanels(m.shape)) {
        const x = h.rect.x + h.slide.x * open;
        const y = h.rect.y + h.slide.y * open;
        blockers.push({ ring: new Float64Array([x, y, x + h.rect.w, y, x + h.rect.w, y + h.rect.h, x, y + h.rect.h]), owner: -1 });
      }
    }

    const out: Beam[] = [];
    for (const i of active) {
      if (st.hidden?.[i]) continue;
      const l = this.map.objects[i].laser;
      if (!l) continue;
      const flipped = l.switchColor !== undefined && st.channels[l.switchColor] === 1;
      if (l.on === flipped) continue; // off
      const o = this.objects[i];
      transformAt(o, st.timeOf(i), tf);
      toWorld(o, tf, (o.minX + o.maxX) / 2, (o.minY + o.maxY) / 2, tmp);
      const a = (l.angle * Math.PI) / 180 + Math.atan2(tf.sin, tf.cos);
      out.push({ color: l.color, pts: this.cast(tmp.x, tmp.y, Math.cos(a), Math.sin(a), blockers, mirrors, i) });
    }
    this.cachedBeams = out;
    return out;
  }

  private cast(
    x: number, y: number, dx: number, dy: number,
    blockers: { ring: Float64Array; owner: number }[], mirrors: Float64Array[], self: number,
  ): number[] {
    const pts = [x, y];
    const W = this.map.width;
    const H = this.map.height;
    for (let bounce = 0; bounce <= MAX_BOUNCES; bounce++) {
      // Map edge
      let best = Infinity;
      if (dx > 0) best = Math.min(best, (W - x) / dx);
      if (dx < 0) best = Math.min(best, -x / dx);
      if (dy > 0) best = Math.min(best, (H - y) / dy);
      if (dy < 0) best = Math.min(best, -y / dy);
      let mirrorEdge: number[] | null = null;
      const test = (ring: Float64Array, isMirror: boolean) => {
        const n = ring.length;
        for (let k = 0, j = n - 2; k < n; j = k, k += 2) {
          const ax = ring[j];
          const ay = ring[j + 1];
          const ex = ring[k] - ax;
          const ey = ring[k + 1] - ay;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = ax - x;
          const wy = ay - y;
          const s = (wx * ey - wy * ex) / den;
          if (s <= EPS || s >= best) continue;
          const v = (wx * dy - wy * dx) / den;
          if (v < 0 || v > 1) continue;
          best = s;
          mirrorEdge = isMirror ? [ex, ey] : null;
        }
      };
      // The emitter's own body doesn't block its beam on the way out
      for (const b of blockers) if (!(bounce === 0 && b.owner === self)) test(b.ring, false);
      for (const m of mirrors) test(m, true);
      if (!Number.isFinite(best)) break;
      x += dx * best;
      y += dy * best;
      pts.push(x, y);
      const edge = mirrorEdge as number[] | null;
      if (!edge) break;
      // Reflect: d' = d − 2(d·n)n
      const len = Math.hypot(edge[0], edge[1]);
      const nx = -edge[1] / len;
      const ny = edge[0] / len;
      const dot = dx * nx + dy * ny;
      dx -= 2 * dot * nx;
      dy -= 2 * dot * ny;
      x += dx * 1e-4;
      y += dy * 1e-4;
    }
    return pts;
  }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
  return Math.hypot(ax + ex * t - px, ay + ey * t - py);
}

function pointInQuad(px: number, py: number, q: number[]): boolean {
  let inside = false;
  for (let i = 0, j = 6; i < 8; j = i, i += 2) {
    if (q[i + 1] > py !== q[j + 1] > py && px < ((q[j] - q[i]) * (py - q[i + 1])) / (q[j + 1] - q[i + 1]) + q[i]) inside = !inside;
  }
  return inside;
}

/**
 * Earliest fraction u ∈ [0, 1] of the cursor's segment A→B that touches a beam, or −1.
 * `before` are the beams at the start of the segment: a beam sweeping over a still cursor
 * within one tick is caught by the area it swept.
 */
export function beamHit(beams: readonly Beam[], before: readonly Beam[], ax: number, ay: number, bx: number, by: number): number {
  let best = Infinity;
  const dx = bx - ax;
  const dy = by - ay;
  beams.forEach((beam, bi) => {
    const p = beam.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const sx = p[k];
      const sy = p[k + 1];
      const ex = p[k + 2] - sx;
      const ey = p[k + 3] - sy;
      if (distToSeg(ax, ay, sx, sy, sx + ex, sy + ey) <= BEAM_HALF) {
        best = 0;
        return;
      }
      const den = dx * ey - dy * ex;
      if (Math.abs(den) > 1e-12) {
        const wx = sx - ax;
        const wy = sy - ay;
        const u = (wx * ey - wy * ex) / den;
        const v = (wx * dy - wy * dx) / den;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) best = Math.min(best, u);
      }
      if (distToSeg(bx, by, sx, sy, sx + ex, sy + ey) <= BEAM_HALF) best = Math.min(best, 1);
    }
    // Swept area since the start of the tick
    const q = before[bi]?.pts;
    if (q && q !== p && q.length === p.length) {
      for (let k = 0; k + 3 < p.length; k += 2) {
        if (pointInQuad(bx, by, [q[k], q[k + 1], q[k + 2], q[k + 3], p[k + 2], p[k + 3], p[k], p[k + 1]])) best = Math.min(best, 1);
      }
    }
  });
  return Number.isFinite(best) ? best : -1;
}
