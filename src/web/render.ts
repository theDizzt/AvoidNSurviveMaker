import { toWorld, transformAt, type CompiledObject, type Transform } from '../core/object';
import type { Fill, MapData, Point, Rect } from '../core/types';

export const COLORS = {
  bg: '#f6fbff',
  /** Bars around maps that aren't 16:9 */
  letterbox: '#dfe8f3',
  /** Outside the paths: deadly, so noticeably darker than the floor */
  void: '#cbd6e6',
  floor: '#ffffff',
  floorEdge: '#9cc3e6',
  floorMoving: '#e0f2ff',
  floorMovingEdge: '#3a9ff0',
  grid: 'rgba(60,100,160,0.08)',
  wall: '#8fa3bf',
  wallEdge: '#6a809f',
  mover: '#ff7d9c',
  start: 'rgba(63,196,166,0.22)',
  startEdge: '#22b08f',
  goal: 'rgba(255,196,60,0.28)',
  goalEdge: '#e09a00',
  trail: 'rgba(58,159,240,0.75)',
  cursor: '#2b86e0',
  hit: '#e2365f',
  ink: '#243450',
  select: '#243450',
  route: 'rgba(240,150,40,0.65)',
  routeSelected: '#f08c1e',
  pivot: '#8a6cf0',
};

/** Same families as --font-main / --font-title in style.css */
export const FONT_MAIN = "'MangoDdobak', system-ui, sans-serif";
export const FONT_TITLE = "'GSHyejaroun', 'MangoDdobak', system-ui, sans-serif";

const tmp: Point = { x: 0, y: 0 };
const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

/** The game screen is always 16:9. Maps of another ratio are centered with bars around them. */
export const SCREEN_ASPECT = 16 / 9;
/** Largest on-screen width of the game canvas (CSS px) */
const MAX_CSS_WIDTH = 1280;
/** Space kept free for the top bar and toolbar when fitting to the window height */
const RESERVED_HEIGHT = 190;

/** Where the map sits inside its canvas, in CSS px */
interface View {
  cssW: number;
  /** CSS px per map unit */
  s: number;
  ox: number;
  oy: number;
}
const views = new WeakMap<HTMLCanvasElement, View>();

function viewOf(canvas: HTMLCanvasElement, map: MapData): View {
  return views.get(canvas) ?? { cssW: map.width, s: 1, ox: 0, oy: 0 };
}

/**
 * Size the canvas to a 16:9 box that fits the parent's width and the window's height,
 * and place the map inside it (scaled to fit, centered). Backing resolution follows devicePixelRatio.
 */
export function fitCanvas(canvas: HTMLCanvasElement, map: MapData): void {
  const avail = canvas.parentElement?.clientWidth || map.width;
  const byHeight = Math.max(320, (window.innerHeight - RESERVED_HEIGHT) * SCREEN_ASPECT);
  const cssW = Math.max(160, Math.floor(Math.min(avail, MAX_CSS_WIDTH, byHeight)));
  const cssH = Math.round(cssW / SCREEN_ASPECT);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const s = Math.min(cssW / map.width, cssH / map.height);
  views.set(canvas, { cssW, s, ox: (cssW - map.width * s) / 2, oy: (cssH - map.height * s) / 2 });
}

/** Clear the frame (bars included) and make subsequent drawing use map coordinates, clipped to the map */
export function beginFrame(ctx: CanvasRenderingContext2D, map: MapData): void {
  const canvas = ctx.canvas;
  const v = viewOf(canvas, map);
  const k = canvas.width / v.cssW; // device px per CSS px
  // restore() pops last frame's save() (a no-op on the first frame), so the clip never stacks up
  ctx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COLORS.letterbox;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k * v.s, 0, 0, k * v.s, k * v.ox, k * v.oy);
  ctx.beginPath();
  ctx.rect(0, 0, map.width, map.height);
  ctx.clip();
}

/** How many map units one on-screen CSS px covers */
export function unitsPerPx(canvas: HTMLCanvasElement, map: MapData): number {
  const v = viewOf(canvas, map);
  const shown = canvas.getBoundingClientRect().width || v.cssW;
  return 1 / (v.s * (shown / v.cssW));
}

/**
 * Converter from client (mouse) coordinates to map coordinates. Measures the canvas once,
 * so it's cheap to call for every input sample in a batch.
 */
export function mapPointer(canvas: HTMLCanvasElement, map: MapData): (clientX: number, clientY: number, out: Point) => Point {
  const v = viewOf(canvas, map);
  const r = canvas.getBoundingClientRect();
  const zoom = (r.width || v.cssW) / v.cssW; // CSS transforms / browser zoom
  const scale = 1 / (v.s * zoom);
  return (clientX, clientY, out) => {
    out.x = (clientX - r.left - v.ox * zoom) * scale;
    out.y = (clientY - r.top - v.oy * zoom) * scale;
    return out;
  };
}

export function clientToMap(canvas: HTMLCanvasElement, map: MapData, clientX: number, clientY: number): Point {
  return mapPointer(canvas, map)(clientX, clientY, { x: 0, y: 0 });
}

function zone(ctx: CanvasRenderingContext2D, r: Rect, fill: string, edge: string, label: string): void {
  // Light underlay keeps zones readable on dark or busy theme floors
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.fillStyle = edge;
  ctx.font = `700 ${Math.max(8, Math.min(14, r.h * 0.3, r.w * 0.2))}px ${FONT_MAIN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

/** Add an object's outline, posed at its transform, to the current path */
export function traceObject(ctx: CanvasRenderingContext2D, o: CompiledObject, tf: Transform): void {
  const { poly } = o;
  for (let i = 0; i < poly.length; i += 2) {
    toWorld(o, tf, poly[i], poly[i + 1], tmp);
    if (i === 0) ctx.moveTo(tmp.x, tmp.y);
    else ctx.lineTo(tmp.x, tmp.y);
  }
  ctx.closePath();
}

// ───────────────────────── Theme fills ─────────────────────────

/** Patterns are rendered once per (context, fill) at 4× resolution and scaled down, so they stay crisp */
const PATTERN_RES = 4;
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

function patternFor(ctx: CanvasRenderingContext2D, f: Extract<Fill, { type: 'pattern' }>): CanvasPattern | string {
  let cache = patternCache.get(ctx);
  if (!cache) patternCache.set(ctx, (cache = new Map()));
  const key = `${f.pattern}|${f.color}|${f.background}|${f.size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s = f.size;
  const tile = document.createElement('canvas');
  tile.width = tile.height = Math.ceil(s * PATTERN_RES);
  const g = tile.getContext('2d');
  if (!g) return f.background;
  g.scale(PATTERN_RES, PATTERN_RES);
  g.fillStyle = f.background;
  g.fillRect(0, 0, s, s);
  g.fillStyle = f.color;
  g.strokeStyle = f.color;
  switch (f.pattern) {
    case 'stripes':
      g.fillRect(0, 0, s, s / 2);
      break;
    case 'diagonal':
      // Three strokes so the band continues seamlessly across tile edges
      g.lineWidth = s * 0.3;
      g.beginPath();
      for (const o of [-s, 0, s]) {
        g.moveTo(o, s);
        g.lineTo(o + s, 0);
      }
      g.stroke();
      break;
    case 'dots':
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
      g.fill();
      break;
    case 'grid': {
      const w = Math.max(1, s * 0.08);
      g.fillRect(0, 0, s, w);
      g.fillRect(0, 0, w, s);
      break;
    }
    case 'checker':
      g.fillRect(0, 0, s / 2, s / 2);
      g.fillRect(s / 2, s / 2, s / 2, s / 2);
      break;
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return f.background;
  pattern.setTransform(new DOMMatrix().scale(1 / PATTERN_RES));
  cache.set(key, pattern);
  return pattern;
}

/** Fill style for an object, laid out over its local (rest-pose) bounding box */
function fillStyle(ctx: CanvasRenderingContext2D, f: Fill, o: CompiledObject): string | CanvasGradient | CanvasPattern {
  if (f.type === 'solid') return f.color;
  if (f.type === 'pattern') return patternFor(ctx, f);
  const cx = (o.minX + o.maxX) / 2;
  const cy = (o.minY + o.maxY) / 2;
  const w = o.maxX - o.minX;
  const h = o.maxY - o.minY;
  let grad: CanvasGradient;
  if (f.style === 'radial') {
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(w, h) / 2));
  } else {
    const a = (f.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = Math.max(0.5, (Math.abs(w * dx) + Math.abs(h * dy)) / 2);
    grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  grad.addColorStop(0, f.from);
  grad.addColorStop(1, f.to);
  return grad;
}

/** Fill (and outline) one object in its own frame, so gradients and patterns move and rotate with it */
function drawObject(
  ctx: CanvasRenderingContext2D, o: CompiledObject, t: number,
  fill: (o: CompiledObject) => string | CanvasGradient | CanvasPattern, edge: string | null,
): void {
  transformAt(o, t, tf);
  ctx.save();
  // world = R·(p − pivot) + pivot + d
  ctx.transform(
    tf.cos, tf.sin, -tf.sin, tf.cos,
    o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  );
  ctx.beginPath();
  const { poly } = o;
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill(o);
  ctx.fill('evenodd');
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the map at time t (ms since the run started).
 * With any path on the map, the background becomes deadly void and paths are drawn as floor.
 * `map.theme` styles walls/obstacles and paths; without it the default look is used.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], t: number,
): void {
  const paths = objects.some((o) => o.role === 'path');
  const theme = map.theme;
  ctx.fillStyle = paths ? COLORS.void : COLORS.bg;
  ctx.fillRect(0, 0, map.width, map.height);

  for (const o of objects) {
    if (o.role !== 'path') continue;
    if (theme) drawObject(ctx, o, t, (x) => fillStyle(ctx, theme.path.fill, x), theme.path.edge);
    else drawObject(ctx, o, t, () => (o.dynamic ? COLORS.floorMoving : COLORS.floor), o.dynamic ? COLORS.floorMovingEdge : COLORS.floorEdge);
  }

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 50; x < map.width; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, map.height);
  }
  for (let y = 50; y < map.height; y += 50) {
    ctx.moveTo(0, y);
    ctx.lineTo(map.width, y);
  }
  ctx.stroke();

  zone(ctx, map.start, COLORS.start, COLORS.startEdge, 'START');
  zone(ctx, map.goal, COLORS.goal, COLORS.goalEdge, 'GOAL');

  for (const o of objects) {
    if (o.role !== 'wall') continue;
    if (theme) drawObject(ctx, o, t, (x) => fillStyle(ctx, theme.wall.fill, x), theme.wall.edge);
    else drawObject(ctx, o, t, () => (o.dynamic ? COLORS.mover : COLORS.wall), o.dynamic ? null : COLORS.wallEdge);
  }
}

export function drawTrail(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  if (pts.length < 4) return;
  ctx.strokeStyle = COLORS.trail;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

export function drawBanner(ctx: CanvasRenderingContext2D, map: MapData, title: string, sub = '', color = COLORS.ink): void {
  const w = Math.min(map.width - 40, 460);
  const h = sub ? 76 : 50;
  const x = (map.width - w) / 2;
  const y = 16;
  ctx.save();
  ctx.shadowColor = 'rgba(58,96,150,0.25)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = `700 22px ${FONT_TITLE}`;
  ctx.fillText(title, map.width / 2, y + (sub ? 26 : h / 2));
  if (sub) {
    ctx.fillStyle = 'rgba(36,52,80,0.65)';
    ctx.font = `400 15px ${FONT_MAIN}`;
    ctx.fillText(sub, map.width / 2, y + 54);
  }
}
