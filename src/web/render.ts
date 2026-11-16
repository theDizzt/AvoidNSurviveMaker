import { toWorld, transformAt, type CompiledObject, type Transform } from '../core/object';
import { primaryColor, secondaryColor, shade } from '../core/theme';
import type { Fill, MapData, Point, Rect } from '../core/types';

export const COLORS = {
  bg: '#f6fbff',
  /** Bars around maps that aren't 16:9 */
  letterbox: '#dfe8f3',
  floor: '#ffffff',
  floorEdge: '#9cc3e6',
  floorMoving: '#e0f2ff',
  floorMovingEdge: '#3a9ff0',
  grid: 'rgba(60,100,160,0.08)',
  /** Grid drawn over walls and obstacles (editor option): stronger so it shows on any surface */
  gridTop: 'rgba(36,52,80,0.28)',
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
  /** Editor-only outlines of each piece */
  outlineWall: 'rgba(36,52,80,0.65)',
  outlinePath: 'rgba(43,134,224,0.85)',
  select: '#243450',
  route: 'rgba(240,150,40,0.65)',
  routeSelected: '#f08c1e',
  pivot: '#8a6cf0',
};

/** Same families as --font-main / --font-title in style.css */
export const FONT_MAIN = "'MangoDdobak', system-ui, sans-serif";
export const FONT_TITLE = "'GSHyejaroun', 'MangoDdobak', system-ui, sans-serif";
export const FONT_TIMER = "'GameTimer', 'MangoDdobak', system-ui, sans-serif";

const tmp: Point = { x: 0, y: 0 };
const tf: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

/** The game screen is always 16:9. Maps of another ratio are centered with bars around them. */
export const SCREEN_ASPECT = 16 / 9;
/** Grid cell size in map units (960×540 = 16×9 cells) */
export const GRID_SIZE = 60;
/** Largest on-screen width of the editor canvas (CSS px); the play screen has no cap */
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
  // data-fit="screen": use the largest 16:9 area of the whole window (play screen)
  const screen = canvas.dataset.fit === 'screen';
  const avail = screen ? window.innerWidth : canvas.parentElement?.clientWidth || map.width;
  const byHeight = screen
    ? window.innerHeight * SCREEN_ASPECT
    : Math.max(320, (window.innerHeight - RESERVED_HEIGHT) * SCREEN_ASPECT);
  const cssW = Math.max(160, Math.floor(Math.min(avail, byHeight, screen ? Infinity : MAX_CSS_WIDTH)));
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
/** Area a gradient is laid out over: an object's local bounds, or the whole map for the outside-of-paths area */
type Bounds = Pick<CompiledObject, 'minX' | 'minY' | 'maxX' | 'maxY'>;

function fillStyle(ctx: CanvasRenderingContext2D, f: Fill, o: Bounds): string | CanvasGradient | CanvasPattern {
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
interface ObjectStyle {
  fill: (o: CompiledObject) => string | CanvasGradient | CanvasPattern;
  edge: string | null;
  /** Soft drop shadow (device px blur), so moving pieces look lifted off the floor */
  shadow?: boolean;
}

/** Fill (and outline) one object in its own frame, so gradients and patterns move and rotate with it */
function drawObject(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, style: ObjectStyle): void {
  transformAt(o, t, tf);
  const k = ctx.getTransform().a; // device px per map unit, for shadow sizes
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
  if (style.shadow) {
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = 8 * k;
    ctx.shadowOffsetY = 3 * k;
  }
  ctx.fillStyle = style.fill(o);
  ctx.fill('evenodd');
  ctx.shadowColor = 'transparent';
  if (style.edge) {
    ctx.strokeStyle = style.edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

const SHADOW = 'rgba(36,52,80,0.3)';

/**
 * Add a static object's outline (rest pose = world) to the current path, always in the same
 * winding direction, so a nonzero fill of several outlines is their union (no holes where a
 * clockwise and a counter-clockwise shape overlap).
 */
function traceStatic(g: CanvasRenderingContext2D, o: CompiledObject): void {
  const { poly } = o;
  const n = poly.length / 2;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += poly[j * 2] * poly[i * 2 + 1] - poly[i * 2] * poly[j * 2 + 1];
  const at = (k: number) => (area >= 0 ? k : n - 1 - k);
  g.moveTo(poly[at(0) * 2], poly[at(0) * 2 + 1]);
  for (let k = 1; k < n; k++) g.lineTo(poly[at(k) * 2], poly[at(k) * 2 + 1]);
  g.closePath();
}

function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return [c, c.getContext('2d')!];
}

/**
 * Everything that never moves, merged into one picture so walls and paths join seamlessly:
 *
 * - Floor: all static paths plus START/GOAL as one area (or the whole map when it has no paths).
 * - Wall mass: everything outside the floor plus every static wall, as one area.
 * - Fills are laid out over the whole map, so patterns and gradients continue across pieces.
 * - Only the real wall/floor boundary gets an outline, and the walls cast a soft shadow onto the
 *   floor, so the walls read as raised above it.
 *
 * Rendered at device resolution and cached until the map, theme or canvas size changes.
 */
function buildStaticLayer(map: MapData, objects: readonly CompiledObject[], scale: number): HTMLCanvasElement {
  const theme = map.theme;
  const paths = objects.some((o) => o.role === 'path');
  const whole: Bounds = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
  const w = Math.ceil(map.width * scale);
  const h = Math.ceil(map.height * scale);

  // Wall mass
  const [wallCanvas, g] = offscreen(w, h);
  g.scale(scale, scale);
  const wallFill = theme ? fillStyle(g, theme.wall.fill, whole) : COLORS.wall;
  if (paths) {
    g.fillStyle = wallFill;
    g.fillRect(0, 0, map.width, map.height);
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    for (const o of objects) if (o.role === 'path' && !o.dynamic) traceStatic(g, o);
    for (const r of [map.start, map.goal]) g.rect(r.x, r.y, r.w, r.h);
    // nonzero: overlapping floor pieces cut out as one union
    g.fill('nonzero');
    g.globalCompositeOperation = 'source-over';
  }
  g.beginPath();
  for (const o of objects) if (o.role === 'wall' && !o.dynamic) traceStatic(g, o);
  g.fillStyle = wallFill;
  g.fill('nonzero');

  // Floor, then the wall mass with its shadow and rim on top
  const [layer, s] = offscreen(w, h);
  s.scale(scale, scale);
  s.fillStyle = paths ? (theme ? fillStyle(s, theme.path.fill, whole) : COLORS.floor) : COLORS.bg;
  s.fillRect(0, 0, map.width, map.height);
  // Default grid sits on the floor, under the walls ("Grid on top" draws another one over everything)
  drawGrid(s, map, COLORS.grid);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.shadowColor = SHADOW;
  s.shadowBlur = 12 * scale;
  s.shadowOffsetY = 4 * scale;
  s.drawImage(wallCanvas, 0, 0);
  s.shadowColor = theme ? theme.wall.edge : COLORS.wallEdge;
  s.shadowBlur = 1.5 * scale;
  s.shadowOffsetY = 0;
  s.drawImage(wallCanvas, 0, 0);
  return layer;
}

const layerCache = new WeakMap<readonly CompiledObject[], { key: string; layer: HTMLCanvasElement }>();

function staticLayer(ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[]): HTMLCanvasElement {
  const scale = ctx.getTransform().a;
  const key = `${scale}|${map.width}x${map.height}|${JSON.stringify(map.theme ?? null)}|${map.start.x},${map.start.y},${map.start.w},${map.start.h}|${map.goal.x},${map.goal.y},${map.goal.w},${map.goal.h}`;
  const hit = layerCache.get(objects);
  if (hit && hit.key === key) return hit.layer;
  const layer = buildStaticLayer(map, objects, scale);
  layerCache.set(objects, { key, layer });
  return layer;
}

/**
 * Draw the map at time t (ms since the run started).
 * With any path on the map, everything outside the paths is wall (deadly, drawn in the wall style).
 * `map.theme` styles walls/obstacles and paths; without it the default look is used.
 */
function drawGrid(ctx: CanvasRenderingContext2D, map: MapData, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID_SIZE; x < map.width; x += GRID_SIZE) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, map.height);
  }
  for (let y = GRID_SIZE; y < map.height; y += GRID_SIZE) {
    ctx.moveTo(0, y);
    ctx.lineTo(map.width, y);
  }
  ctx.stroke();
}

export interface DrawMapOptions {
  /** Draw the grid over everything (walls and obstacles included) instead of under them */
  gridOnTop?: boolean;
}

export function drawMap(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], t: number,
  opts: DrawMapOptions = {},
): void {
  const theme = map.theme;
  ctx.drawImage(staticLayer(ctx, map, objects), 0, 0, map.width, map.height);

  zone(ctx, map.start, COLORS.start, COLORS.startEdge, 'START');
  zone(ctx, map.goal, COLORS.goal, COLORS.goalEdge, 'GOAL');

  // Moving / rotating pieces on top of the static scene
  for (const o of objects) {
    if (!o.dynamic || o.role !== 'path') continue;
    drawObject(ctx, o, t, theme
      ? { fill: (x) => fillStyle(ctx, theme.path.fill, x), edge: theme.path.edge, shadow: true }
      : { fill: () => COLORS.floorMoving, edge: COLORS.floorMovingEdge, shadow: true });
  }
  for (const o of objects) {
    if (!o.dynamic || o.role !== 'wall') continue;
    drawObject(ctx, o, t, theme
      ? { fill: (x) => fillStyle(ctx, theme.wall.fill, x), edge: theme.wall.edge, shadow: true }
      : { fill: () => COLORS.mover, edge: null, shadow: true });
  }
  if (opts.gridOnTop) drawGrid(ctx, map, COLORS.gridTop);
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

// ───────────────────────── Stopwatch ─────────────────────────

const DEFAULT_TIMER_COLOR = '#3a9ff0';
/** Neutral base for greyscale themes such as Mono */
const NEUTRAL_TIMER_COLOR = '#5b5f66';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Base color for the stopwatch, taken from the map theme: the most colorful of its wall / path
 * colors, adjusted so it reads on light and dark floors alike. Greyscale themes (e.g. Mono) get a
 * neutral grey so the stopwatch stays achromatic too.
 */
function timerColor(map: MapData): string {
  const t = map.theme;
  if (!t) return DEFAULT_TIMER_COLOR;
  const candidates = [primaryColor(t.wall.fill), secondaryColor(t.wall.fill), primaryColor(t.path.fill), t.wall.edge, t.path.edge];
  let best = candidates[0];
  for (const c of candidates) if (saturation(c) > saturation(best)) best = c;
  if (saturation(best) < 0.15) return NEUTRAL_TIMER_COLOR;
  const l = luminance(best);
  if (l > 0.62) best = shade(best, -(l - 0.5));
  else if (l < 0.25) best = shade(best, 0.25);
  return best;
}

/** Diagonal two-tone stripes; the caller slides them sideways with setTransform */
const stripeCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
const STRIPE_TILE = 12;
const STRIPE_RES = 4;

function stripes(ctx: CanvasRenderingContext2D, a: string, b: string): CanvasPattern | null {
  let cache = stripeCache.get(ctx);
  if (!cache) stripeCache.set(ctx, (cache = new Map()));
  const key = `${a}|${b}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = STRIPE_TILE;
  const tile = document.createElement('canvas');
  tile.width = tile.height = s * STRIPE_RES;
  const g = tile.getContext('2d');
  if (!g) return null;
  g.scale(STRIPE_RES, STRIPE_RES);
  g.fillStyle = a;
  g.fillRect(0, 0, s, s);
  g.strokeStyle = b;
  g.lineWidth = s * 0.32;
  g.beginPath();
  for (const o of [-s, 0, s]) {
    g.moveTo(o, s);
    g.lineTo(o + s, 0);
  }
  g.stroke();
  const p = ctx.createPattern(tile, 'repeat');
  if (p) cache.set(key, p);
  return p;
}

/**
 * Run stopwatch, e.g. "60.789": big whole seconds, smaller milliseconds, a 3D extrusion with a
 * drop shadow in the theme's color, and diagonal stripes sliding through the letters.
 * The timer font isn't monospaced, so every digit is centered in a cell as wide as the widest
 * digit: the readout never shifts as the numbers change. Drawn at the top-right corner.
 */
export function drawStopwatch(ctx: CanvasRenderingContext2D, map: MapData, ms: number, now: number): void {
  const total = Math.floor(Math.max(0, ms));
  const whole = String(Math.floor(total / 1000));
  const frac = `.${String(total % 1000).padStart(3, '0')}`;
  const base = timerColor(map);
  const big = 54;
  const small = 32;
  const depth = 7;
  const step = 0.9;
  const k = ctx.getTransform().a; // device px per map unit, for shadow blur
  const fontBig = `400 ${big}px ${FONT_TIMER}`;
  const fontSmall = `400 ${small}px ${FONT_TIMER}`;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Fixed cells: widest digit for each size; the dot gets its own width
  const cellOf = (font: string) => {
    ctx.font = font;
    let w = 0;
    for (let d = 0; d <= 9; d++) w = Math.max(w, ctx.measureText(String(d)).width);
    return w;
  };
  const cellBig = cellOf(fontBig);
  const cellSmall = cellOf(fontSmall);
  ctx.font = fontSmall;
  const dotW = ctx.measureText('.').width;
  // Same font baseline isn't the same visual bottom: this font's digits dip below the baseline
  // in proportion to their size, so drop the small part by the difference to line up the bottoms.
  // Measured on "0" (a few digits like 3 and 9 sit a pixel off and shouldn't skew the alignment).
  const dip = (font: string) => {
    ctx.font = font;
    return ctx.measureText('0').actualBoundingBoxDescent;
  };
  const fracDrop = dip(fontBig) - dip(fontSmall);
  const width = whole.length * cellBig + dotW + 3 * cellSmall;
  const x0 = map.width - 22 - depth * step - width;
  const y = 14 + big;

  /** Each character at its fixed position; `paint` fills or strokes one glyph */
  const glyphs = (dx: number, dy: number, paint: (ch: string, x: number, y: number, isFrac: boolean) => void) => {
    let x = x0 + dx;
    ctx.font = fontBig;
    for (const ch of whole) {
      paint(ch, x + cellBig / 2, y + dy, false);
      x += cellBig;
    }
    ctx.font = fontSmall;
    for (const ch of frac) {
      const w = ch === '.' ? dotW : cellSmall;
      paint(ch, x + w / 2, y + dy + fracDrop, true);
      x += w;
    }
  };

  // Extrusion: stacked copies down-right in a dark shade; the deepest one casts the soft shadow
  const side = shade(base, -0.45);
  for (let i = depth; i >= 1; i--) {
    if (i === depth) {
      ctx.shadowColor = 'rgba(20,30,50,0.38)';
      ctx.shadowBlur = 8 * k;
      ctx.shadowOffsetY = 3 * k;
    }
    ctx.fillStyle = i === depth ? shade(side, -0.2) : shade(side, -0.12 * (i / depth));
    glyphs(i * step, i * step, (ch, x, yy) => ctx.fillText(ch, x, yy));
    ctx.shadowColor = 'transparent';
  }

  // Face: seconds and milliseconds in slightly different tints, stripes sliding to the right
  const fracBase = shade(base, 0.32);
  const faceWhole = stripes(ctx, base, shade(base, 0.22));
  const faceFrac = stripes(ctx, fracBase, shade(fracBase, 0.28));
  const slide = ((now / 1000) * 18) % STRIPE_TILE;
  const m = new DOMMatrix().translate(slide, 0).scale(1 / STRIPE_RES);
  faceWhole?.setTransform(m);
  faceFrac?.setTransform(m);
  glyphs(0, 0, (ch, x, yy, isFrac) => {
    ctx.fillStyle = isFrac ? (faceFrac ?? fracBase) : (faceWhole ?? base);
    ctx.fillText(ch, x, yy);
  });

  // Thin light rim on the face for a crisp edge
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  glyphs(0, 0, (ch, x, yy) => ctx.strokeText(ch, x, yy));
  ctx.restore();
}
