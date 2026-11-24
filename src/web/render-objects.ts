import { compilePressCylinder, toWorld, transformAt, type CompiledObject, type Transform } from '../core/object';
import type { Aura, MapData, MapObject, Point, Power, Rad, Spot } from '../core/types';
import { auraRadius, auraReach } from '../core/radiation';
import { WIRE_WIDTH } from '../core/electric';
import { libraryFontCss } from './library-fonts';

/**
 * Drawing for thorn vines (#83 / #84), lily pads (#85), ponds and radioactive water (#86 / #87),
 * spotlights (#88–90), wires (#91), electric devices (#94–97) and radiation (#115–117). Everything is
 * in map units.
 */

const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

/** Into the object's pose at time t (route, rotation, then its static tilt) */
function enterPose(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  transformAt(o, t, tf);
  ctx.transform(
    tf.cos, tf.sin, -tf.sin, tf.cos,
    o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  );
  if (o.tilt) {
    ctx.translate(o.cx, o.cy);
    ctx.rotate(o.tilt);
    ctx.translate(-o.cx, -o.cy);
  }
}

function ringPath(ctx: CanvasRenderingContext2D | Path2D, poly: Float64Array): void {
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
}

/** A fixed pseudo-random sequence in [0, 1) */
function random(seed: number): () => number {
  let r = (Math.abs(Math.floor(seed)) % 233280) + 1;
  return () => (r = (r * 9301 + 49297) % 233280) / 233280;
}

// ───────────────────────── Thorn vine (#83 / #84) ─────────────────────────

/**
 * A thorn vine in the walls' colors (`fill`, outline `edge`): one solid silhouette, its big thorns
 * and the point at its tip already in its outline, with a soft shadow like the walls'.
 */
export function drawThornVine(
  ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, fill: string | CanvasGradient | CanvasPattern, edge: string,
): void {
  ctx.save();
  enterPose(ctx, o, t);
  const body = new Path2D();
  ringPath(body, o.box.poly);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = fill;
  ctx.fill(body);
  ctx.restore();
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.stroke(body);
  ctx.restore();
}

// ───────────────────────── Liquids (#86 / #87) and lily pads (#85) ─────────────────────────

const LIQUID_COLOR = { pond: '#2f86d4', toxic: '#62e82a' } as const;
const LIQUID_BANK = { pond: 'rgba(36,92,150,0.85)', toxic: 'rgba(48,140,20,0.85)' } as const;
/** The color field is drawn at this fraction of map resolution and blurred, so touching liquids blend */
const FIELD_SCALE = 1 / 10;

interface LiquidCache { key: string; field: HTMLCanvasElement }
const fieldCache = new WeakMap<readonly CompiledObject[], LiquidCache>();
const liquidScratch = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Blurred color field of the liquids: each one's color spread a little past its edge, so they mix where they meet */
function liquidField(map: MapData, objects: readonly CompiledObject[], list: number[], timeOf: (i: number) => number): HTMLCanvasElement {
  const key = list.join(',');
  const hit = fieldCache.get(objects);
  if (hit && hit.key === key) return hit.field;
  const w = Math.ceil(map.width * FIELD_SCALE) + 2;
  const h = Math.ceil(map.height * FIELD_SCALE) + 2;
  const raw = canvasOf(w, h);
  const g = raw.getContext('2d')!;
  g.setTransform(FIELD_SCALE, 0, 0, FIELD_SCALE, 0, 0);
  g.lineJoin = 'round';
  // Spread first, then the liquids themselves on top
  for (const pass of [0, 1]) {
    for (const i of list) {
      const o = objects[i];
      const kind = o.src!.liquid?.kind ?? 'pond';
      g.save();
      enterPose(g, o, timeOf(i));
      g.beginPath();
      ringPath(g, o.box.poly);
      g.fillStyle = g.strokeStyle = LIQUID_COLOR[kind];
      if (pass === 0) {
        g.lineWidth = 90;
        g.stroke();
      } else g.fill();
      g.restore();
    }
  }
  const field = canvasOf(w, h);
  const f = field.getContext('2d')!;
  if ('filter' in f) f.filter = 'blur(3px)';
  f.drawImage(raw, 0, 0);
  raw.width = raw.height = 0;
  fieldCache.set(objects, { key, field });
  return field;
}

/**
 * Ponds and radioactive water: one blended color field cut to the liquids' outlines, ripples and
 * bubbles moving on top and a bank just outside. Radioactive water glows. `walls` sets the
 * scratch layer's resolution.
 */
export function drawLiquids(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], walls: HTMLCanvasElement,
  now: number, shown: (i: number) => boolean, timeOf: (i: number) => number,
): void {
  const list = objects.flatMap((o, i) => (o.role === 'liquid' && shown(i) ? [i] : []));
  if (!list.length) return;
  let scratch = liquidScratch.get(walls);
  if (!scratch || scratch.width !== walls.width || scratch.height !== walls.height) {
    liquidScratch.set(walls, (scratch = canvasOf(walls.width, walls.height)));
  }
  const g = scratch.getContext('2d')!;
  const scale = walls.width / map.width;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, scratch.width, scratch.height);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const union = new Path2D();
  const paths = list.map((i) => {
    const p = new Path2D();
    const m = new DOMMatrix();
    const o = objects[i];
    transformAt(o, timeOf(i), tf);
    m.a = tf.cos; m.b = tf.sin; m.c = -tf.sin; m.d = tf.cos;
    m.e = o.px + tf.dx - tf.cos * o.px + tf.sin * o.py;
    m.f = o.py + tf.dy - tf.sin * o.px - tf.cos * o.py;
    const ring = new Path2D();
    ringPath(ring, o.box.poly);
    const tilt = o.tilt ? new DOMMatrix().translate(o.cx, o.cy).rotate((o.tilt * 180) / Math.PI).translate(-o.cx, -o.cy) : new DOMMatrix();
    p.addPath(ring, m.multiply(tilt));
    union.addPath(p);
    return p;
  });
  // Banks: only the half outside the water stays (the water covers the rest)
  g.lineJoin = 'round';
  g.lineWidth = 7;
  list.forEach((i, k) => {
    g.strokeStyle = LIQUID_BANK[objects[i].src!.liquid?.kind ?? 'pond'];
    g.stroke(paths[k]);
  });
  g.save();
  g.clip(union, 'nonzero');
  g.imageSmoothingEnabled = true;
  const field = liquidField(map, objects, list, timeOf);
  g.drawImage(field, 0, 0, field.width / FIELD_SCALE, field.height / FIELD_SCALE);
  // Ripples drifting across all water alike, so blended water stays seamless
  const s = now / 1000;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of list) {
    const o = objects[i];
    const tr = o.travelBounds ?? o;
    minX = Math.min(minX, tr.minX); minY = Math.min(minY, tr.minY);
    maxX = Math.max(maxX, tr.maxX); maxY = Math.max(maxY, tr.maxY);
  }
  g.lineWidth = 1.6;
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.beginPath();
  for (let y = Math.floor(minY / 22) * 22; y < maxY + 22; y += 22) {
    const row = Math.round(y / 22);
    const shift = ((s * 18 + row * 37) % 120) - 60;
    for (let x = Math.floor(minX / 120) * 120 + shift; x < maxX; x += 120) {
      // A short wavelet
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 10, y - 3 - Math.sin(s * 1.7 + row) * 1.5, x + 20, y);
      g.quadraticCurveTo(x + 30, y + 3, x + 40, y);
    }
  }
  g.stroke();
  // Radioactive water: a pulsing glow and bubbles rising in it
  list.forEach((i, k) => {
    const o = objects[i];
    if (o.src!.liquid?.kind !== 'toxic') return;
    g.save();
    g.clip(paths[k]);
    g.fillStyle = `rgba(210,255,150,${0.12 + 0.1 * Math.sin(s * 2.4 + i)})`;
    g.fill(paths[k]);
    const b = o.travelBounds ?? o;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const count = Math.min(40, Math.max(3, Math.round((w * h) / 6000)));
    const rnd = random(i * 97 + 13);
    for (let n = 0; n < count; n++) {
      const x0 = b.minX + rnd() * w;
      const period = 1.6 + rnd() * 1.8;
      const u = ((s / period) + rnd()) % 1;
      const y = b.maxY - u * h;
      const x = x0 + Math.sin(u * 9 + n) * 4;
      const r = 1.5 + rnd() * 2.5;
      g.globalAlpha = Math.sin(u * Math.PI) * 0.8;
      g.fillStyle = '#efffd8';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  });
  g.restore();
  // Drawn over the wall mass too: on a map with paths, water outside them is a moat that lily pads cross
  ctx.drawImage(scratch, 0, 0, map.width, map.height);
  // Radioactive water glows out over its banks
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  list.forEach((i, k) => {
    if (objects[i].src!.liquid?.kind !== 'toxic') return;
    const pulse = 0.5 + 0.5 * Math.sin(s * 2.4 + i);
    ctx.lineJoin = 'round';
    for (const [w, a] of [[26, 0.05], [14, 0.08]] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(110,255,60,${a + pulse * 0.04})`;
      ctx.stroke(paths[k]);
    }
  });
  ctx.restore();
}

/** A lily pad: a round leaf with a notch and veins, a shadow on the water, sometimes a flower */
export function drawLily(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, seed: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  const cx = (o.box.minX + o.box.maxX) / 2;
  const cy = (o.box.minY + o.box.maxY) / 2;
  const r = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2;
  const rnd = random(seed * 53 + 11);
  const notch = rnd() * Math.PI * 2;
  const gap = 0.32;
  const leaf = new Path2D();
  leaf.moveTo(cx, cy);
  leaf.arc(cx, cy, r, notch + gap / 2, notch + Math.PI * 2 - gap / 2);
  leaf.closePath();
  // Shadow on the water
  ctx.save();
  ctx.translate(2, 3);
  ctx.fillStyle = 'rgba(10,40,60,0.28)';
  ctx.fill(leaf);
  ctx.restore();
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#7ccf5c');
  grad.addColorStop(1, '#3f9a36');
  ctx.fillStyle = grad;
  ctx.fill(leaf);
  // Veins from the middle
  ctx.strokeStyle = 'rgba(40,110,40,0.75)';
  ctx.lineWidth = Math.max(0.8, r * 0.035);
  ctx.beginPath();
  for (let k = 1; k < 9; k++) {
    const a = notch + gap / 2 + ((Math.PI * 2 - gap) * k) / 9;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
  }
  ctx.stroke();
  ctx.strokeStyle = '#2e6b27';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke(leaf);
  // A water lily flower on some pads
  if (seed % 3 === 0 && r >= 18) {
    const fx = cx + Math.cos(notch + Math.PI) * r * 0.35;
    const fy = cy + Math.sin(notch + Math.PI) * r * 0.35;
    const pr = r * 0.32;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + 0.2;
      ctx.fillStyle = k % 2 ? '#ffd1e3' : '#f7a8c8';
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * pr * 0.55, fy + Math.sin(a) * pr * 0.55, pr * 0.55, pr * 0.24, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(fx, fy, pr * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────── Spotlights (#88–90) ─────────────────────────

/** The beam's direction now (radians): its angle plus the spotlight's rotation */
export function spotDirection(o: CompiledObject, s: Spot, t: number): number {
  transformAt(o, t, tf);
  return (s.angle * Math.PI) / 180 + Math.atan2(tf.sin, tf.cos);
}

/** Center of the object where it is at time t */
function posedCenter(o: CompiledObject, t: number): Point {
  transformAt(o, t, tf);
  const x = o.cx - o.px;
  const y = o.cy - o.py;
  return { x: tf.cos * x - tf.sin * y + o.px + tf.dx, y: tf.sin * x + tf.cos * y + o.py + tf.dy };
}

/** The visible beam: a warm cone fading with distance */
export function drawSpotBeam(ctx: CanvasRenderingContext2D, o: CompiledObject, s: Spot, t: number): void {
  const c = posedCenter(o, t);
  const dir = spotDirection(o, s, t);
  const half = (Math.min(360, s.sweep) * Math.PI) / 360;
  const k = (s.intensity ?? 100) / 100;
  if (k <= 0) return;
  const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, s.range);
  grad.addColorStop(0, `rgba(255,246,196,${0.5 * k})`);
  grad.addColorStop(0.6, `rgba(255,240,170,${0.22 * k})`);
  grad.addColorStop(1, 'rgba(255,236,160,0)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (half >= Math.PI - 1e-6) ctx.arc(c.x, c.y, s.range, 0, Math.PI * 2);
  else {
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, s.range, dir - half, dir + half);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/** The fixture: a lamp housing turned along its beam, its lens lit or dark */
export function drawSpotFixture(ctx: CanvasRenderingContext2D, o: CompiledObject, s: Spot, t: number, lit: boolean): void {
  const c = posedCenter(o, t);
  const dir = spotDirection(o, s, t);
  const size = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY);
  const h = size / 2;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(dir);
  // Bracket
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(-h * 0.9, -h * 0.25, h * 0.5, h * 0.5);
  // Housing, wider at the lens
  ctx.fillStyle = '#4a5363';
  ctx.strokeStyle = '#20242b';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.beginPath();
  ctx.moveTo(-h * 0.6, -h * 0.5);
  ctx.lineTo(h * 0.55, -h * 0.8);
  ctx.lineTo(h * 0.55, h * 0.8);
  ctx.lineTo(-h * 0.6, h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Lens
  ctx.fillStyle = lit ? '#fff6c8' : '#6b7280';
  if (lit) {
    ctx.shadowColor = 'rgba(255,236,150,0.95)';
    ctx.shadowBlur = size * 0.5;
  }
  ctx.beginPath();
  ctx.ellipse(h * 0.55, 0, h * 0.22, h * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ───────────────────────── Wires (#91) ─────────────────────────

/**
 * A wire: a dark rubber cable with copper ends. While it carries power it glows, current runs
 * along it and sparks jump off it.
 */
export function drawWire(ctx: CanvasRenderingContext2D, points: readonly Point[], live: boolean, now: number, seed: number): void {
  if (points.length < 2) return;
  const line = new Path2D();
  points.forEach((p, k) => (k ? line.lineTo(p.x, p.y) : line.moveTo(p.x, p.y)));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1d2026';
  ctx.lineWidth = WIRE_WIDTH;
  ctx.stroke(line);
  ctx.strokeStyle = live ? '#ffe680' : '#4b525d';
  ctx.lineWidth = 2;
  ctx.stroke(line);
  if (live) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,214,70,0.28)';
    ctx.lineWidth = WIRE_WIDTH * 2.2;
    ctx.stroke(line);
    // Current flowing from the first point toward the last
    ctx.setLineDash([8, 18]);
    ctx.lineDashOffset = -now * 0.3;
    ctx.strokeStyle = 'rgba(255,255,230,0.95)';
    ctx.lineWidth = 3;
    ctx.stroke(line);
    ctx.setLineDash([]);
    // Sparks: a few short zigzags that jump around every 70 ms
    let total = 0;
    for (let k = 1; k < points.length; k++) total += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
    const rnd = random(Math.floor(now / 70) * 131 + seed * 17);
    const sparks = Math.max(1, Math.min(6, Math.round(total / 120)));
    ctx.strokeStyle = 'rgba(255,250,200,0.9)';
    ctx.lineWidth = 1.2;
    for (let n = 0; n < sparks; n++) {
      let d = rnd() * total;
      let k = 1;
      for (; k < points.length; k++) {
        const len = Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
        if (d <= len) break;
        d -= len;
      }
      const a = points[Math.min(k, points.length - 1) - 1];
      const b = points[Math.min(k, points.length - 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const x = a.x + ((b.x - a.x) * d) / len;
      const y = a.y + ((b.y - a.y) * d) / len;
      const ang = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x;
      let py = y;
      for (let j = 0; j < 3; j++) {
        px += Math.cos(ang + (rnd() - 0.5) * 1.6) * (4 + rnd() * 5);
        py += Math.sin(ang + (rnd() - 0.5) * 1.6) * (4 + rnd() * 5);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // Copper connectors at both ends
  for (const p of [points[0], points[points.length - 1]]) {
    ctx.fillStyle = '#b87333';
    ctx.strokeStyle = '#6e4220';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, WIRE_WIDTH * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ───────────────────────── Electric devices (#94–97) ─────────────────────────

/** An LCD panel showing `seconds` with one decimal, centered on (cx, bottom edge at y) */
function drawLcd(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, seconds: number, running: boolean): void {
  const text = (Math.min(999.9, Math.max(0, Math.ceil(seconds * 10 - 1e-6) / 10))).toFixed(1);
  const digits = text.replace('.', '');
  const n = digits.length;
  const h = Math.max(14, width * 0.36);
  const dw = h * 0.42;
  const gap = dw * 0.35;
  const w = Math.max(width, n * dw + (n - 1) * gap + dw * 1.2);
  const x0 = cx - w / 2;
  const y0 = y - h;
  ctx.fillStyle = '#10180f';
  ctx.strokeStyle = '#3a404b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 3);
  ctx.fill();
  ctx.stroke();
  const on = running ? '#7dff6a' : 'rgba(125,255,106,0.45)';
  // LT Stopwatch digits over faint unlit "8"s, like a real LCD
  ctx.save();
  let size = h * 0.78;
  const unlit = text.replace(/[0-9]/g, '8');
  ctx.font = `${size}px ${LCD_FONT()}`;
  const fit = w - dw * 0.6;
  const tw = ctx.measureText(unlit).width;
  if (tw > fit) ctx.font = `${(size *= fit / tw)}px ${LCD_FONT()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(125,255,106,0.1)';
  ctx.fillText(unlit, cx, y0 + h / 2 + 1);
  ctx.fillStyle = on;
  if (running) {
    ctx.shadowColor = 'rgba(125,255,106,0.8)';
    ctx.shadowBlur = h * 0.25;
  }
  ctx.fillText(text, cx, y0 + h / 2 + 1);
  ctx.restore();
}

/** The LCD font of electric timers (#96): LT Stopwatch, loaded on first use */
const LCD_FONT = () => libraryFontCss('lt-stopwatch');

/** A lightning bolt `s` tall centered on (cx, cy) */
function bolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  const k = s / 16;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + 1.5 * k, cy - 8 * k);
  ctx.lineTo(cx - 4 * k, cy + 1 * k);
  ctx.lineTo(cx - 0.5 * k, cy + 1 * k);
  ctx.lineTo(cx - 2 * k, cy + 8 * k);
  ctx.lineTo(cx + 4 * k, cy - 1.5 * k);
  ctx.lineTo(cx + 0.5 * k, cy - 1.5 * k);
  ctx.closePath();
  ctx.fill();
}

/**
 * Electric switch, pulley, timer or inverter. `on`: its output is on; `progress`: a timer's time
 * left (0–1); `angle`: how far a pulley has turned.
 */
export function drawPowerDevice(
  ctx: CanvasRenderingContext2D, o: CompiledObject, m: MapObject, p: Power, on: boolean, progress: number, angle: number, now: number,
): void {
  ctx.save();
  enterPose(ctx, o, 0);
  const { minX, minY, maxX, maxY } = o.box;
  const w = maxX - minX;
  const h = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = Math.min(w, h);
  const glow = (r: number) => {
    if (!on) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,220,80,0.45)');
    g.addColorStop(1, 'rgba(255,220,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  if (p.kind === 'pulley') {
    const r = s / 2;
    glow(r * 1.4);
    ctx.fillStyle = '#b87333';
    ctx.strokeStyle = '#6e4220';
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a404b';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    // Spokes turning with it
    ctx.strokeStyle = '#8a929e';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = angle + (k * Math.PI) / 3;
      ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3);
      ctx.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    }
    ctx.stroke();
    ctx.fillStyle = '#d9dde3';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * r * 0.62, cy + Math.sin(angle) * r * 0.62, Math.max(2, r * 0.09), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20242b';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    bolt(ctx, cx, cy, r * 0.46, on ? '#ffd23a' : '#6b7280');
    ctx.restore();
    return;
  }
  glow(s * 0.9);
  // Body
  ctx.fillStyle = '#3a404b';
  ctx.strokeStyle = '#20242b';
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.beginPath();
  ctx.roundRect(minX, minY, w, h, Math.min(w, h) * 0.18);
  ctx.fill();
  ctx.stroke();
  if (p.kind === 'switch') {
    // A rocker lit up with a bolt, and a status light
    const r = s * 0.32;
    ctx.fillStyle = on ? '#4d5666' : '#2b2f36';
    ctx.beginPath();
    ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.3);
    ctx.fill();
    bolt(ctx, cx, cy, r * 1.6, on ? '#ffd23a' : '#6b7280');
    ctx.fillStyle = on ? '#58ff7a' : '#ff5a5a';
    ctx.beginPath();
    ctx.arc(maxX - s * 0.16, minY + s * 0.16, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === 'timer') {
    // A dial wiping down, and the LCD on top counting down
    const r = s * 0.32;
    ctx.fillStyle = '#e8ebef';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (progress > 0) {
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#20242b';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.moveTo(cx, cy);
    const a = -Math.PI / 2 + progress * Math.PI * 2;
    ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.stroke();
    const duration = (p.duration ?? 3000) / 1000;
    drawLcd(ctx, cx, minY - 3, w, progress > 0 ? progress * duration : duration, progress > 0);
  } else {
    // Inverter: input on the left, a NOT gate, output arrow on the right
    const k = h / 36;
    ctx.fillStyle = '#e8ebef';
    ctx.beginPath();
    ctx.moveTo(cx - 10 * k, cy - 9 * k);
    ctx.lineTo(cx + 6 * k, cy);
    ctx.lineTo(cx - 10 * k, cy + 9 * k);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e8ebef';
    ctx.lineWidth = Math.max(1, 2 * k);
    ctx.beginPath();
    ctx.arc(cx + 9.5 * k, cy, 3.2 * k, 0, Math.PI * 2);
    ctx.stroke();
    // Output arrow (lit while on) and input mark
    ctx.fillStyle = on ? '#ffd23a' : '#6b7280';
    ctx.beginPath();
    ctx.moveTo(maxX - 3 * k, cy);
    ctx.lineTo(maxX - 9 * k, cy - 5 * k);
    ctx.lineTo(maxX - 9 * k, cy + 5 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a929e';
    ctx.fillRect(minX + 3 * k, cy - 1.5 * k, 6 * k, 3 * k);
  }
  void m;
  void now;
  ctx.restore();
}

// ───────────────────────── Radiation (#115–117) ─────────────────────────

/** The radiation trefoil: three blades around a dot, `r` = blade length */
function trefoil(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const inner = r * 0.34;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const mid = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    const a0 = mid - Math.PI / 6;
    const a1 = mid + Math.PI / 6;
    ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.arc(cx, cy, inner, a1, a0, true);
    ctx.closePath();
  }
  ctx.moveTo(cx + r * 0.22, cy);
  ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

/** 0–1, slowly breathing (for the glow) */
function breathe(now: number, seed: number): number {
  return 0.5 + 0.5 * Math.sin(now / 520 + seed * 1.7);
}

/** Radioactive zone (#115): a sickly glowing area with a hazard-striped rim and trefoils */
export function drawRadZone(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, now: number, seed: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  const area = new Path2D();
  ringPath(area, o.box.poly);
  const k = breathe(now, seed);
  ctx.fillStyle = `rgba(176,236,44,${0.42 + 0.12 * k})`;
  ctx.shadowColor = 'rgba(170,255,60,0.8)';
  ctx.shadowBlur = 10 + 8 * k;
  ctx.fill(area);
  ctx.shadowBlur = 0;
  // Faint trefoils on a grid inside it
  ctx.save();
  ctx.clip(area);
  const gap = 90;
  const r = 16;
  for (let y = Math.floor(o.box.minY / gap) * gap + gap / 2; y < o.box.maxY + gap; y += gap) {
    for (let x = Math.floor(o.box.minX / gap) * gap + gap / 2 + ((Math.floor(y / gap) % 2) * gap) / 2; x < o.box.maxX + gap; x += gap) {
      trefoil(ctx, x, y, r, 'rgba(48,60,14,0.28)');
    }
  }
  ctx.restore();
  // Hazard rim: yellow and black dashes
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f4d21c';
  ctx.stroke(area);
  ctx.setLineDash([9, 9]);
  ctx.lineDashOffset = -now / 60;
  ctx.strokeStyle = '#2a2a22';
  ctx.stroke(area);
  ctx.restore();
}

/** The radioactive area around a piece of waste (#116 / #117), as large as it is now; a faint ring marks its reach */
export function drawRadAura(ctx: CanvasRenderingContext2D, o: CompiledObject, a: Aura, t: number, now: number): void {
  const c = posedCenter(o, t);
  const r = auraRadius(a, t);
  ctx.save();
  const reach = auraReach(a);
  if (reach > 0) {
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(120,170,20,0.45)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, reach, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (r > 0) {
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    grad.addColorStop(0, 'rgba(190,255,70,0.55)');
    grad.addColorStop(0.75, 'rgba(170,245,50,0.38)');
    grad.addColorStop(1, 'rgba(150,235,40,0.28)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Its edge, shimmering
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(110,190,10,0.9)';
    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = now / 40;
    ctx.stroke();
  }
  ctx.restore();
}

/** A piece of radioactive waste: a yellow box (#116) or drum (#117) marked with the trefoil */
export function drawRadWaste(ctx: CanvasRenderingContext2D, o: CompiledObject, kind: Rad['kind'], t: number, now: number, seed: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  const b = o.box;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const cx = b.minX + w / 2;
  const cy = b.minY + h / 2;
  const size = Math.min(w, h);
  const body = new Path2D();
  if (kind === 'drum') body.arc(cx, cy, size / 2, 0, Math.PI * 2);
  else body.roundRect(b.minX, b.minY, w, h, Math.min(6, size * 0.12));
  ctx.shadowColor = 'rgba(170,255,60,0.9)';
  ctx.shadowBlur = 8 + 8 * breathe(now, seed);
  const grad = ctx.createLinearGradient(b.minX, b.minY, b.maxX, b.maxY);
  grad.addColorStop(0, '#ffe04a');
  grad.addColorStop(1, '#e0a800');
  ctx.fillStyle = grad;
  ctx.fill(body);
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.strokeStyle = '#3b3a30';
  ctx.stroke(body);
  if (kind === 'drum') {
    // The lid's rim
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.strokeStyle = 'rgba(59,58,48,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Hazard stripes along the top and bottom edges
    ctx.save();
    ctx.clip(body);
    const band = Math.max(3, h * 0.14);
    ctx.fillStyle = '#2a2a22';
    for (const y0 of [b.minY, b.maxY - band]) {
      for (let x = b.minX - band * 2; x < b.maxX + band; x += band * 2) {
        ctx.beginPath();
        ctx.moveTo(x, y0 + band);
        ctx.lineTo(x + band, y0);
        ctx.lineTo(x + band * 2, y0);
        ctx.lineTo(x + band, y0 + band);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
  trefoil(ctx, cx, cy, size * 0.3, '#2a2a22');
  ctx.restore();
}

// ───────────────────────── Machines (#111–114) ─────────────────────────

const cylinders = new WeakMap<MapObject, CompiledObject | null>();

function bolt3(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#f4f6f8');
  g.addColorStop(1, '#7d8794');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#3a414b';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * The parts a machine wall doesn't show by itself: a press's steel cylinder (over its rod), a
 * gear's hub, a clock hand's cap and a pendulum's hanger.
 */
export function drawMachine(ctx: CanvasRenderingContext2D, o: CompiledObject, m: MapObject, t: number): void {
  if (m.press) {
    let c = cylinders.get(m);
    if (c === undefined) cylinders.set(m, (c = compilePressCylinder(m)));
    if (!c) return;
    const path = new Path2D();
    ringPath(path, c.poly);
    ctx.save();
    const g = ctx.createLinearGradient(c.minX, c.minY, c.maxX, c.minY);
    g.addColorStop(0, '#59626e');
    g.addColorStop(0.45, '#c9d0d8');
    g.addColorStop(1, '#4d5560');
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.strokeStyle = '#2b3038';
    ctx.lineWidth = 2;
    ctx.stroke(path);
    // Hazard band at its mouth, toward the head
    ctx.clip(path);
    ctx.strokeStyle = 'rgba(244,210,28,0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.stroke(path);
    ctx.restore();
    return;
  }
  transformAt(o, t, tf);
  const p = { x: 0, y: 0 };
  if (m.gear) {
    toWorld(o, tf, o.cx, o.cy, p);
    const r = Math.max(3, Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) * 0.14);
    bolt3(ctx, p.x, p.y, r);
    ctx.fillStyle = '#2b3038';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  } else if (m.hand || m.pendulum) {
    toWorld(o, tf, o.px, o.py, p);
    const w = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY);
    bolt3(ctx, p.x, p.y, Math.max(3, m.hand ? w * 0.22 : w * 0.12));
  }
}

// ───────────────────────── Metal box / magnet (#98 / #99) ─────────────────────────

/** A metal box (#98): a riveted steel plate, where the magnets have dragged it */
export function drawMetalBox(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  const b = o.box;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const g = ctx.createLinearGradient(b.minX, b.minY, b.maxX, b.maxY);
  g.addColorStop(0, '#d4dbe3');
  g.addColorStop(0.5, '#9aa5b2');
  g.addColorStop(1, '#c3cbd5');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#3f4752';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(b.minX, b.minY, w, h, Math.min(4, Math.min(w, h) * 0.1));
  ctx.fill();
  ctx.stroke();
  // Brushed lines and rivets
  ctx.strokeStyle = 'rgba(63,71,82,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = b.minY + h / 3; y < b.maxY - 1; y += h / 3) {
    ctx.moveTo(b.minX + 2, y);
    ctx.lineTo(b.maxX - 2, y);
  }
  ctx.stroke();
  const r = Math.max(1.2, Math.min(w, h) * 0.06);
  const inset = Math.max(r * 2, Math.min(w, h) * 0.14);
  ctx.fillStyle = '#3f4752';
  for (const [x, y] of [[b.minX + inset, b.minY + inset], [b.maxX - inset, b.minY + inset], [b.minX + inset, b.maxY - inset], [b.maxX - inset, b.maxY - inset]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A magnet's field (#99) while it is on: its range, and ripples running in toward it */
export function drawMagnetField(ctx: CanvasRenderingContext2D, o: CompiledObject, range: number, t: number, now: number): void {
  const c = posedCenter(o, t);
  ctx.save();
  ctx.setLineDash([3, 7]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(224,71,91,0.4)';
  ctx.beginPath();
  ctx.arc(c.x, c.y, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const body = Math.max(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2;
  for (let k = 0; k < 3; k++) {
    const f = 1 - (((now / 1400 + k / 3) % 1 + 1) % 1);
    const r = body + (range - body) * f;
    if (r <= body) continue;
    ctx.strokeStyle = `rgba(224,71,91,${0.32 * (1 - f) + 0.05})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A magnet (#99): a horseshoe filling its box, the poles toward its top; dimmed while off */
export function drawMagnet(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, on: boolean): void {
  ctx.save();
  enterPose(ctx, o, t);
  const b = o.box;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const arm = w * 0.3;
  const poleH = Math.min(h * 0.3, arm);
  const bend = Math.min(w / 2, h * 0.6);
  const shoe = new Path2D();
  shoe.moveTo(b.minX, b.minY);
  shoe.lineTo(b.minX + arm, b.minY);
  shoe.lineTo(b.minX + arm, b.maxY - bend);
  shoe.arc(b.minX + w / 2, b.maxY - bend, w / 2 - arm, Math.PI, 0, true);
  shoe.lineTo(b.maxX - arm, b.minY);
  shoe.lineTo(b.maxX, b.minY);
  shoe.lineTo(b.maxX, b.maxY - bend);
  shoe.arc(b.minX + w / 2, b.maxY - bend, w / 2, 0, Math.PI);
  shoe.closePath();
  // Its box is all deadly: a faint plate behind the horseshoe shows it
  ctx.fillStyle = 'rgba(58,42,46,0.18)';
  ctx.fillRect(b.minX, b.minY, w, h);
  ctx.fillStyle = on ? '#e0475b' : '#a7737b';
  ctx.strokeStyle = '#3a2a2e';
  ctx.lineWidth = 2;
  ctx.fill(shoe);
  ctx.fillStyle = '#dfe4ea';
  ctx.fillRect(b.minX, b.minY, arm, poleH);
  ctx.fillRect(b.maxX - arm, b.minY, arm, poleH);
  ctx.stroke(shoe);
  ctx.restore();
}
