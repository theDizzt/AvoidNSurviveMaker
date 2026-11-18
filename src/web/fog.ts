import { toWorld, transformAt, type CompiledObject, type Transform } from '../core/object';
import type { FogKind, MapData } from '../core/types';

/**
 * Fog (#49) and sand dust (#50): a drifting cloud over a freely drawn area that covers the cursor,
 * obstacles and walls under it. `density` (0–100) sets how much it hides; 100 hides everything.
 *
 * Each area is drawn on an offscreen layer: a base veil, soft puffs that drift and breathe (plus
 * fine blowing grains for sand), then cut to the area's outline with a feathered edge so the
 * cloud fades out instead of ending in a hard line.
 */

interface Puff {
  x: number;
  y: number;
  r: number;
  tone: number;
  alpha: number;
  phase: number;
  /** Wander period (s) */
  period: number;
  amp: number;
  /** Drift speed along the wind (units/s) */
  drift: number;
}

interface Grain {
  x: number;
  y: number;
  size: number;
  tone: number;
  speed: number;
  phase: number;
}

interface Cloud {
  puffs: Puff[];
  grains: Grain[];
  /** Area bounds in rest coordinates, grown by the margin the particles wrap around in */
  x0: number;
  y0: number;
  w: number;
  h: number;
}

interface Look {
  base: string;
  puffs: readonly string[];
  grains: readonly string[];
  /** Wind along x (units/s) */
  wind: number;
  /** Puffs squashed vertically (sand clouds lie low and stretch with the wind) */
  squash: number;
}

const LOOKS: Record<FogKind, Look> = {
  fog: { base: '#e3e9ef', puffs: ['#ffffff', '#f2f5f8', '#d3dbe4', '#c4ceda'], grains: [], wind: 7, squash: 0.8 },
  sand: { base: '#d6b583', puffs: ['#ecd3a4', '#e0c08e', '#c49c66', '#b88d58'], grains: ['#9c7442', '#f2dcb2', '#80603a', '#c9a46e'], wind: 46, squash: 0.55 },
};

/** Outline feather (map units) */
const FEATHER = 16;

const clouds = new WeakMap<CompiledObject, Cloud>();
const sprites = new Map<string, HTMLCanvasElement>();
const layers = new WeakMap<CanvasRenderingContext2D, { layer: HTMLCanvasElement; mask: HTMLCanvasElement }>();
const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
const tmp = { x: 0, y: 0 };

/** Small deterministic PRNG, so an area's cloud looks the same on every play */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let v = s;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function cloudFor(o: CompiledObject, kind: FogKind): Cloud {
  let c = clouds.get(o);
  if (c) return c;
  const w = o.maxX - o.minX;
  const h = o.maxY - o.minY;
  const seed = Math.round(o.minX * 73856093) ^ Math.round(o.minY * 19349663) ^ Math.round((w + h) * 83492791);
  const rand = rng(seed);
  const R = Math.max(22, Math.min(80, Math.sqrt(w * h) / 4));
  const margin = R * 1.5;
  const cw = w + margin * 2;
  const ch = h + margin * 2;
  const look = LOOKS[kind];
  const puffCount = Math.round(Math.max(8, Math.min(110, ((cw * ch) / (R * R)) * 1.6)));
  const puffs: Puff[] = [];
  for (let k = 0; k < puffCount; k++) {
    puffs.push({
      x: rand() * cw,
      y: rand() * ch,
      r: R * (0.55 + rand() * 0.9),
      tone: Math.floor(rand() * look.puffs.length),
      alpha: 0.45 + rand() * 0.55,
      phase: rand() * Math.PI * 2,
      period: 5 + rand() * 9,
      amp: R * (0.15 + rand() * 0.35),
      drift: look.wind * (0.6 + rand() * 0.8),
    });
  }
  const grains: Grain[] = [];
  if (look.grains.length) {
    const n = Math.round(Math.max(24, Math.min(320, (cw * ch) / 260)));
    for (let k = 0; k < n; k++) {
      grains.push({
        x: rand() * cw,
        y: rand() * ch,
        size: 0.8 + rand() * 1.8,
        tone: Math.floor(rand() * look.grains.length),
        speed: 90 + rand() * 150,
        phase: rand() * Math.PI * 2,
      });
    }
  }
  c = { puffs, grains, x0: o.minX - margin, y0: o.minY - margin, w: cw, h: ch };
  clouds.set(o, c);
  return c;
}

/** A soft round puff in one color, faded to transparent at its rim */
function sprite(color: string): HTMLCanvasElement {
  let s = sprites.get(color);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.45, `${color}c0`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(color, s);
  return s;
}

function layersFor(ctx: CanvasRenderingContext2D): { layer: HTMLCanvasElement; mask: HTMLCanvasElement } {
  let l = layers.get(ctx);
  if (!l) layers.set(ctx, (l = { layer: document.createElement('canvas'), mask: document.createElement('canvas') }));
  for (const c of [l.layer, l.mask]) {
    if (c.width !== ctx.canvas.width || c.height !== ctx.canvas.height) {
      c.width = ctx.canvas.width;
      c.height = ctx.canvas.height;
    }
  }
  return l;
}

const wrap = (v: number, size: number) => ((v % size) + size) % size;

/**
 * Draw every fog / sand dust area. Goes over the cursor, so call it after drawing the cursor.
 * `t` is the map time (the area's own motion), `now` the wall clock that drives the drifting.
 * `alpha` < 1 shows it see-through in the editor.
 */
export function drawFogAreas(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], t: number, now: number, alpha = 1,
  state: { hidden?: ArrayLike<number>; clock?: ArrayLike<number> } = {},
): void {
  let any = false;
  objects.forEach((o, i) => {
    const fog = map.objects[i]?.fog;
    if (o.role !== 'fog' || !fog || state.hidden?.[i] || fog.density <= 0) return;
    any = true;
    drawFog(ctx, map, o, fog.kind, fog.density / 100, state.clock?.[i] ?? t, now / 1000, alpha);
  });
  if (any) ctx.globalCompositeOperation = 'source-over';
}

function drawFog(
  ctx: CanvasRenderingContext2D, map: MapData, o: CompiledObject, kind: FogKind, d: number, t: number, s: number, alpha: number,
): void {
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  transformAt(o, t, tf);

  // Device-pixel box around the area (plus its feather), clamped to the canvas
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < o.poly.length; k += 2) {
    toWorld(o, tf, o.poly[k], o.poly[k + 1], tmp);
    const dx = m.a * tmp.x + m.c * tmp.y + m.e;
    const dy = m.b * tmp.x + m.d * tmp.y + m.f;
    if (dx < x0) x0 = dx;
    if (dx > x1) x1 = dx;
    if (dy < y0) y0 = dy;
    if (dy > y1) y1 = dy;
  }
  const pad = FEATHER * scale + 2;
  const bx = Math.max(0, Math.floor(x0 - pad));
  const by = Math.max(0, Math.floor(y0 - pad));
  const bw = Math.min(cw, Math.ceil(x1 + pad)) - bx;
  const bh = Math.min(ch, Math.ceil(y1 + pad)) - by;
  if (bw <= 0 || bh <= 0) return;

  const { layer, mask } = layersFor(ctx);
  const look = LOOKS[kind];
  const cloud = cloudFor(o, kind);
  // The area's pose (rest coordinates → map coordinates)
  const pa = tf.cos, pb = tf.sin, pc = -tf.sin, pd = tf.cos;
  const pe = o.px + tf.dx - tf.cos * o.px + tf.sin * o.py;
  const pf = o.py + tf.dy - tf.sin * o.px - tf.cos * o.py;
  const tracePoly = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(o.poly[0], o.poly[1]);
    for (let k = 2; k < o.poly.length; k += 2) g.lineTo(o.poly[k], o.poly[k + 1]);
    g.closePath();
  };

  // Mask: the outline, feathered. The shape itself is drawn far off to the left and only its
  // blurred shadow lands in place (shadow blur works in device pixels on every browser).
  const mg = mask.getContext('2d')!;
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.clearRect(bx, by, bw, bh);
  const off = Math.ceil(map.width * scale + cw) * 2 + 1000;
  mg.setTransform(m.a, m.b, m.c, m.d, m.e - off, m.f);
  mg.transform(pa, pb, pc, pd, pe, pf);
  mg.shadowColor = '#000';
  mg.shadowBlur = FEATHER * scale * 0.6;
  mg.shadowOffsetX = off;
  mg.fillStyle = '#000';
  tracePoly(mg);
  mg.fill();
  mg.shadowColor = 'transparent';

  // Cloud
  const g = layer.getContext('2d')!;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(bx, by, bw, bh);
  g.beginPath();
  g.rect(bx, by, bw, bh);
  g.clip();
  g.setTransform(m);
  g.transform(pa, pb, pc, pd, pe, pf);
  // Base veil: fully opaque at density 100, thinning quickly below it so the puffs show patches
  g.globalAlpha = Math.pow(d, 1.5);
  g.fillStyle = look.base;
  g.fillRect(cloud.x0, cloud.y0, cloud.w, cloud.h);
  // Puffs drift with the wind (wrapping around the area), wander and slowly breathe
  const puffAlpha = Math.min(1, 0.2 + 0.6 * d);
  for (const p of cloud.puffs) {
    const w = (s * Math.PI * 2) / p.period + p.phase;
    const x = cloud.x0 + wrap(p.x + p.drift * s + Math.sin(w) * p.amp, cloud.w);
    const y = cloud.y0 + wrap(p.y + Math.cos(w * 0.7) * p.amp * 0.6, cloud.h);
    const r = p.r * (1 + 0.12 * Math.sin(w * 1.3));
    g.globalAlpha = puffAlpha * p.alpha * (0.75 + 0.25 * Math.sin(w * 0.9 + 1));
    g.drawImage(sprite(look.puffs[p.tone]), x - r, y - r * look.squash, r * 2, r * 2 * look.squash);
  }
  // Sand: fine grains blowing through, in gusts
  if (cloud.grains.length) {
    const gust = 0.85 + 0.3 * Math.sin(s * 0.8);
    for (const q of cloud.grains) {
      const x = cloud.x0 + wrap(q.x + q.speed * gust * s, cloud.w);
      const y = cloud.y0 + wrap(q.y + Math.sin(s * 3 + q.phase) * 6 + s * 4, cloud.h);
      g.globalAlpha = Math.min(1, 0.35 + 0.65 * d) * (0.6 + 0.4 * Math.sin(s * 5 + q.phase));
      g.fillStyle = look.grains[q.tone];
      // A short streak along the wind
      g.fillRect(x, y, q.size * (1.5 + q.speed / 90), q.size);
    }
  }
  // Cut to the feathered outline
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, bx, by, bw, bh, bx, by, bw, bh);
  g.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, bx, by, bw, bh, bx, by, bw, bh);
  ctx.restore();
}
