import { language, t as tr } from './i18n';
import { createPatternTile, PATTERN_RES } from './theme-pattern';
import { displayTime } from '../core/time';
import { tiltPoint, toWorld, transformAt, type CompiledObject, type Transform } from '../core/object';
import { primaryColor, secondaryColor, shade } from './localized/theme';
import { switchColor } from './localized/colors';
import type { Beam } from '../core/laser';
import { autoDoorOpen, doorPanels, initialChannels } from '../core/switches';
import { isLibraryFont } from './localized/font-catalog';
import type { Fall, Fill, MapData, MapObject, Point, Pulley, Rect, TextBox } from '../core/types';
import { fallState } from '../core/hazards';
import { libraryFontCss } from './library-fonts';
import { CompiledMotion } from '../core/motion';
import { shapeCenter } from '../core/shape';
import type { LightSource } from '../core/lighting';
import { renderScale } from './graphics';

export const COLORS = {
  bg: '#f6fbff',
  /** Bars around maps that aren't 16:9 */
  letterbox: '#dfe8f3',
  floor: '#ffffff',
  floorEdge: '#9cc3e6',
  grid: 'rgba(60,100,160,0.08)',
  /** Grid drawn over walls and obstacles (editor option): stronger so it shows on any surface */
  gridTop: 'rgba(36,52,80,0.28)',
  /** Editor: center lines / symmetry axes */
  centerLine: 'rgba(124,92,230,0.85)',
  /** Editor: mirror images of objects while checking symmetry */
  mirrorGhost: 'rgba(124,92,230,0.55)',
  /** Editor: objects that break the symmetry */
  asymmetric: 'rgba(226,60,80,0.95)',
  asymmetricFill: 'rgba(226,60,80,0.18)',
  wall: '#8fa3bf',
  wallEdge: '#6a809f',
  /** Safe zone (#48) */
  safe: 'rgba(120,124,132,0.38)',
  safeEdge: 'rgba(90,94,104,0.55)',
  start: 'rgba(63,196,166,0.22)',
  startEdge: '#22b08f',
  goal: 'rgba(255,196,60,0.28)',
  goalEdge: '#e09a00',
  /** GOAL while coins remain */
  goalLocked: 'rgba(58,62,72,0.88)',
  goalLockedEdge: '#c9ced8',
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
  coin: '#ffd25e',
  coinEdge: '#d39a12',
  coinShine: '#fff4c4',
  dark: '#000000',
};

/** Chinese text falls back to its own fonts (see ZhMain / ZhTitle in style.css) */
const zh = language === 'zh';
/** Same families as --font-main / --font-title in style.css */
export const FONT_MAIN = `'MangoDdobak', ${zh ? "'ZhMain', " : ''}system-ui, sans-serif`;
export const FONT_TITLE = `'GSHyejaroun', 'MangoDdobak', ${zh ? "'ZhTitle', 'ZhMain', " : ''}system-ui, sans-serif`;
export const FONT_TIMER = `'GameTimer', 'MangoDdobak', ${zh ? "'ZhMain', " : ''}system-ui, sans-serif`;

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
  cssH: number;
  /** CSS px per map unit */
  s: number;
  ox: number;
  oy: number;
}
const views = new WeakMap<HTMLCanvasElement, View>();

/** Editor zoom: `zoom` times the fitted scale, with map point (x, y) at the middle of the canvas */
export interface Camera {
  zoom: number;
  x: number;
  y: number;
}
const cameras = new WeakMap<HTMLCanvasElement, Camera>();

/** Zoom / pan a canvas over its map (null shows the whole map, fitted and centered) */
export function setCamera(canvas: HTMLCanvasElement, cam: Camera | null): void {
  if (cam) cameras.set(canvas, { ...cam });
  else cameras.delete(canvas);
}

/** The fitted view without zoom: canvas size in CSS px and CSS px per map unit */
export function fittedView(canvas: HTMLCanvasElement, map: MapData): { cssW: number; cssH: number; s: number } {
  const v = views.get(canvas);
  return v ? { cssW: v.cssW, cssH: v.cssH, s: v.s } : { cssW: map.width, cssH: map.height, s: 1 };
}

function viewOf(canvas: HTMLCanvasElement, map: MapData): View {
  const v = views.get(canvas) ?? { cssW: map.width, cssH: map.height, s: 1, ox: 0, oy: 0 };
  const c = cameras.get(canvas);
  if (!c) return v;
  const s = v.s * c.zoom;
  return { cssW: v.cssW, cssH: v.cssH, s, ox: v.cssW / 2 - c.x * s, oy: v.cssH / 2 - c.y * s };
}

/**
 * Size the canvas to a 16:9 box that fits the parent's width and the window's height,
 * and place the map inside it (scaled to fit, centered). Backing resolution follows devicePixelRatio,
 * capped by the graphics option (graphics.ts).
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
  const dpr = renderScale(cssW, cssH);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const s = Math.min(cssW / map.width, cssH / map.height);
  views.set(canvas, { cssW, cssH, s, ox: (cssW - map.width * s) / 2, oy: (cssH - map.height * s) / 2 });
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

function zone(ctx: CanvasRenderingContext2D, r: Rect, fill: string, edge: string, label: string, underlay = true): void {
  // Light underlay keeps zones readable on dark or busy theme floors
  if (underlay) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
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

const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

function patternFor(ctx: CanvasRenderingContext2D, f: Extract<Fill, { type: 'pattern' }>): CanvasPattern | string {
  let cache = patternCache.get(ctx);
  if (!cache) patternCache.set(ctx, (cache = new Map()));
  const key = `${f.pattern}|${f.color}|${f.background}|${f.size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const tile = createPatternTile(f);
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
interface StaticLayer {
  /** Floor + wall mass, ready to draw when nothing moves */
  layer: HTMLCanvasElement;
  /** Floor alone (path fill and grid) */
  floor: HTMLCanvasElement;
  /** Static wall mass alone (no shadow / rim): `outside` + `wallPieces` */
  walls: HTMLCanvasElement;
  /** Everything outside the static floor */
  outside: HTMLCanvasElement;
  /** Static wall objects, minus static paths that cut through walls */
  wallPieces: HTMLCanvasElement;
  /** Scratch canvas for the per-frame wall mass */
  frame: HTMLCanvasElement;
  /** Scratch canvas: floor + per-frame wall mass, drawn onto the map in one go */
  composite: HTMLCanvasElement;
  /** Layer pixels per map unit */
  scale: number;
  /** Secret-wall overlay at exactly the same resolution as the wall mass. */
  secret?: HTMLCanvasElement;
  secretReady?: boolean;
  compositeState?: number[];
  /** Where the static walls are, for grinder dust (built on first use) */
  mask?: WallMask;
}

/** The static wall mass at a coarse resolution: 1 = wall */
interface WallMask {
  data: Uint8Array;
  w: number;
  h: number;
  /** Mask pixels per map unit */
  k: number;
}

function wallMask(st: StaticLayer, map: MapData): WallMask {
  if (st.mask) return st.mask;
  const k = 0.5;
  const w = Math.max(1, Math.ceil(map.width * k));
  const h = Math.max(1, Math.ceil(map.height * k));
  const [c, g] = offscreen(w, h);
  g.drawImage(st.walls, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  c.width = c.height = 0;
  return (st.mask = { data, w, h, k });
}

function isWallAt(m: WallMask, x: number, y: number): boolean {
  const i = Math.floor(x * m.k);
  const j = Math.floor(y * m.k);
  return i >= 0 && j >= 0 && i < m.w && j < m.h && m.data[j * m.w + i] === 1;
}

function buildStaticLayer(map: MapData, objects: readonly CompiledObject[], scale: number): StaticLayer {
  const theme = map.theme;
  const paths = objects.some((o) => o.role === 'path');
  const whole: Bounds = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
  const w = Math.ceil(map.width * scale);
  const h = Math.ceil(map.height * scale);

  // Outside the floor
  const [outside, v] = offscreen(w, h);
  v.scale(scale, scale);
  if (paths) {
    v.fillStyle = theme ? fillStyle(v, theme.wall.fill, whole) : COLORS.wall;
    v.fillRect(0, 0, map.width, map.height);
    v.globalCompositeOperation = 'destination-out';
    v.beginPath();
    for (const o of objects) if (o.role === 'path' && !o.dynamic) traceStatic(v, o);
    for (const r of [map.start, map.goal]) v.rect(r.x, r.y, r.w, r.h);
    // nonzero: overlapping floor pieces cut out as one union
    v.fill('nonzero');
    v.globalCompositeOperation = 'source-over';
  }
  // Wall pieces, with wall-piercing paths cut out of them
  const [wallPieces, p] = offscreen(w, h);
  p.scale(scale, scale);
  p.beginPath();
  for (const o of objects) if (o.role === 'wall' && !o.dynamic) traceStatic(p, o);
  p.fillStyle = theme ? fillStyle(p, theme.wall.fill, whole) : COLORS.wall;
  p.fill('nonzero');
  if (objects.some((o) => o.role === 'path' && !o.dynamic && o.src?.pierce)) {
    p.globalCompositeOperation = 'destination-out';
    p.beginPath();
    for (const o of objects) if (o.role === 'path' && !o.dynamic && o.src?.pierce) traceStatic(p, o);
    p.fill('nonzero');
    p.globalCompositeOperation = 'source-over';
  }
  // Wall mass
  const [wallCanvas, g] = offscreen(w, h);
  g.drawImage(outside, 0, 0);
  g.drawImage(wallPieces, 0, 0);

  // Floor, then the wall mass with its shadow and rim on top
  const [floor, f] = offscreen(w, h);
  f.scale(scale, scale);
  f.fillStyle = paths ? (theme ? fillStyle(f, theme.path.fill, whole) : COLORS.floor) : COLORS.bg;
  f.fillRect(0, 0, map.width, map.height);
  // Default grid sits on the floor, under the walls ("Grid on top" draws another one over everything)
  drawGrid(f, map, COLORS.grid);
  const [layer, s] = offscreen(w, h);
  s.drawImage(floor, 0, 0);
  drawWallMass(s, wallCanvas, theme, scale);
  return { layer, floor, walls: wallCanvas, outside, wallPieces, frame: offscreen(w, h)[0], composite: offscreen(w, h)[0], scale };
}

/** The wall mass onto the floor: a soft shadow, then the walls with a thin rim in the edge color */
function drawWallMass(s: CanvasRenderingContext2D, walls: HTMLCanvasElement, theme: MapData['theme'], scale: number): void {
  s.save();
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.shadowColor = SHADOW;
  s.shadowBlur = 12 * scale;
  s.shadowOffsetY = 4 * scale;
  s.drawImage(walls, 0, 0);
  s.shadowColor = theme ? theme.wall.edge : COLORS.wallEdge;
  s.shadowBlur = 1.5 * scale;
  s.shadowOffsetY = 0;
  s.drawImage(walls, 0, 0);
  s.restore();
}

/**
 * Add an object's posed outline (world coordinates) to the current path. `hole` winds it opposite
 * to `rect()`, so with a 'nonzero' fill or clip it cuts out of an enclosing rect.
 */
const outlineCache = new WeakMap<CompiledObject, [Path2D, Path2D]>();

function tracePosed(g: Path2D, o: CompiledObject, t: number, hole = false): void {
  let paths = outlineCache.get(o);
  if (!paths) {
    const { poly } = o;
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i += 2) area += poly[i] * poly[(i + 3) % n] - poly[(i + 2) % n] * poly[i + 1];
    const build = (reverse: boolean) => {
      const path = new Path2D();
      for (let k = 0; k < n; k += 2) {
        const i = reverse ? n - 2 - k : k;
        if (k === 0) path.moveTo(poly[i], poly[i + 1]);
        else path.lineTo(poly[i], poly[i + 1]);
      }
      path.closePath();
      return path;
    };
    paths = [build(false), build(area > 0)];
    outlineCache.set(o, paths);
  }
  transformAt(o, t, tf);
  g.addPath(paths[hole ? 1 : 0], {
    a: tf.cos, b: tf.sin, c: -tf.sin, d: tf.cos,
    e: o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    f: o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  });
}

const layerCache = new WeakMap<readonly CompiledObject[], { key: string; layer: StaticLayer }>();

/** The last static picture drawn for these objects (floor + walls, nothing moving), e.g. for a minimap */
export function staticPicture(objects: readonly CompiledObject[]): HTMLCanvasElement | null {
  return layerCache.get(objects)?.layer.layer ?? null;
}

/** Largest static layer while zoomed in (pixels per canvas); past it the layer is drawn upscaled */
const ZOOMED_LAYER_MAX_PX = 8_300_000;

function staticLayer(ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[]): StaticLayer {
  let scale = ctx.getTransform().a;
  if (cameras.has(ctx.canvas as HTMLCanvasElement)) {
    // While zooming, rebuild only at steps of √2 (not on every wheel tick), and cap the size
    const cap = Math.sqrt(ZOOMED_LAYER_MAX_PX / (map.width * map.height));
    scale = Math.min(cap, 2 ** (Math.ceil(Math.log2(scale) * 2 - 1e-9) / 2));
  }
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
  /** Per object index: 1 = don't draw (collected coins, objects removed by a switch) */
  hidden?: Uint8Array;
  /** Per object index: the time its motion is at (switch-linked objects); default `t` */
  clock?: Float64Array;
  /** Per object index (doors): how far open, 0–1; default: automatic doors follow `t`, others closed */
  doorOpen?: Float64Array;
  /** Per switch color: 1 while ON; default: the map's starting states */
  channels?: Uint8Array;
  /** Per object index (timer / hold switches): 0–1 shown as a clock wipe */
  progress?: Float64Array;
  /** Laser beams to draw */
  beams?: readonly Beam[];
  /** Enable secret-wall union in play; null means fully concealed. */
  secretCursor?: Point | null;
  /** Animation time for portal swirls (ms); default `t` */
  now?: number;
  /** Coins still needed: GOAL turns dark gray and shows collected / total, e.g. "3/10" */
  coinsLeft?: number;
  /** Per object index: 1 while the cursor carries that torch (#58): not drawn in place */
  carried?: ArrayLike<number>;
  /** Per object index (pulleys, #52): how far it has turned (radians) */
  pulleyAngle?: ArrayLike<number>;
  /** Opacity of the parts of grinders / saw blades hidden inside walls (the editor shows a ghost); default 0 */
  sawGhost?: number;
}

/** A coin: gold disc with a rim and a highlight, in the object's own (posed) frame */
function drawCoin(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  transformAt(o, t, tf);
  ctx.save();
  ctx.transform(
    tf.cos, tf.sin, -tf.sin, tf.cos,
    o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  );
  tiltFrame(ctx, o);
  const { poly } = o.box;
  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.shadowColor = 'rgba(160,110,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = COLORS.coin;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = COLORS.coinEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Inner ring and a small shine
  const cx = (o.box.minX + o.box.maxX) / 2;
  const cy = (o.box.minY + o.box.maxY) / 2;
  const r = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2;
  if (r > 4) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.coinShine;
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.32, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Coins collected in the last `pullMs`, flying into the cursor at (x, y) like a magnet:
 * accelerating and shrinking as they close in.
 */
export function drawCoinPulls(
  ctx: CanvasRenderingContext2D,
  sim: {
    readonly collected: Uint8Array; readonly collectedAt: Float64Array; readonly collectedPos: Float64Array;
    readonly objects?: readonly { role: string }[];
  },
  t: number, x: number, y: number, pullMs: number,
): void {
  for (let i = 0; i < sim.collected.length; i++) {
    if (!sim.collected[i]) continue;
    const f = (t - sim.collectedAt[i]) / pullMs;
    if (f < 0 || f >= 1) continue;
    const k = f * f;
    const cx = sim.collectedPos[i * 2] + (x - sim.collectedPos[i * 2]) * k;
    const cy = sim.collectedPos[i * 2 + 1] + (y - sim.collectedPos[i * 2 + 1]) * k;
    if (sim.objects?.[i]?.role === 'crystal') {
      // The crystal star shrinks into the cursor (it stays with it as the small held star)
      drawCrystalAt(ctx, cx, cy, 48 * (1 - 0.65 * k), t, 1 - 0.3 * k);
      continue;
    }
    const r = 12 * (1 - 0.6 * k);
    ctx.save();
    ctx.globalAlpha = 1 - 0.5 * k;
    ctx.fillStyle = COLORS.coin;
    ctx.strokeStyle = COLORS.coinEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Darkness areas (#41): solid black, covering the cursor and its trail. `alpha` < 1 in the editor */
export function drawDarkAreas(
  ctx: CanvasRenderingContext2D, objects: readonly CompiledObject[], t: number, alpha = 1,
  state: Pick<DrawMapOptions, 'hidden' | 'clock'> = {},
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.dark;
  ctx.beginPath();
  objects.forEach((o, i) => {
    if (o.role === 'dark' && !state.hidden?.[i]) traceObject(ctx, o, transformAt(o, state.clock?.[i] ?? t, tf));
  });
  ctx.fill('nonzero');
  ctx.restore();
}

const darkLayers = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();

/**
 * Global darkness (#42): black over the whole map with soft lights cut out (map units).
 * `alpha` < 1 previews it in the editor.
 */
export function drawGlobalDark(
  ctx: CanvasRenderingContext2D, map: MapData, lights: readonly LightSource[], alpha = 1,
): void {
  const opacity = Math.max(0, Math.min(100, map.darkness?.intensity ?? 100)) / 100;
  if (opacity === 0 || alpha <= 0) return;
  const m = ctx.getTransform();
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  let layer = darkLayers.get(ctx);
  if (!layer) darkLayers.set(ctx, (layer = document.createElement('canvas')));
  if (layer.width !== cw || layer.height !== ch) {
    layer.width = cw;
    layer.height = ch;
  }
  const g = layer.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.setTransform(m);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, map.width, map.height);
  // Lights: fully clear in the middle, fading out over the outer third
  g.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    if (!Number.isFinite(l.r) || l.r <= 0 || !Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
    const strength = Math.max(0, Math.min(100, l.intensity ?? 100)) / 100;
    if (!Number.isFinite(strength) || strength <= 0) continue;
    const grad = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    grad.addColorStop(0, `rgba(0,0,0,${strength})`);
    grad.addColorStop(0.65, `rgba(0,0,0,${strength})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(l.x, l.y, l.r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha * opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

export function drawMap(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], t: number,
  opts: DrawMapOptions = {},
): void {
  const theme = map.theme;
  const timeOf = (i: number) => opts.clock?.[i] ?? t;
  const shown = (i: number) => !opts.hidden?.[i];
  const channels = opts.channels ?? initialChannels(map);
  const doorOpenAt = (m: MapObject, i: number) => opts.doorOpen?.[i] ?? (m.door!.mode === 'auto' ? autoDoorOpen(m.door!, t) : channels[m.door!.color] ? 1 : 0);
  const isDoor = (m: MapObject | undefined) => m?.role === 'door' && !!m.door && m.shape.type === 'rect';

  // Moving paths, moving walls and doors join the static scene: paths cut the wall mass, walls
  // and door panels add to it, all in the same world-aligned fill, shadow and rim
  const st = staticLayer(ctx, map, objects);
  st.secretReady = false;
  const conceal = opts.secretCursor !== undefined && objects.some((o, i) => o.role === 'secret' && shown(i));
  const isSaw = (i: number) => !!map.objects[i]?.saw;
  const moving = objects.some((o, i) => (o.dynamic && (o.role === 'path' || (o.role === 'wall' && !isSaw(i)))) || isDoor(map.objects[i]));
  let reuseComposite = false;
  if (moving || conceal) {
    const previous = st.compositeState;
    const values = previous ?? [];
    let changed = !previous;
    let at = 0;
    const check = (value: number) => {
      if (values[at] !== value) changed = true;
      values[at++] = value;
    };
    check(conceal ? 1 : 0);
    check(conceal && opts.secretCursor ? 1 : 0);
    check(conceal ? opts.secretCursor?.x ?? 0 : 0);
    check(conceal ? opts.secretCursor?.y ?? 0 : 0);
    objects.forEach((o, i) => {
      const door = isDoor(map.objects[i]);
      if (!(o.dynamic && (o.role === 'path' || (o.role === 'wall' && !isSaw(i))))
        && !door && !(conceal && o.role === 'secret')) return;
      check(i);
      check(shown(i) ? 1 : 0);
      check(shown(i) && (o.motion || o.rotation) ? timeOf(i) : 0);
      check(door && shown(i) ? doorOpenAt(map.objects[i], i) : 0);
    });
    if (values.length !== at) changed = true;
    values.length = at;
    st.compositeState = values;
    reuseComposite = !changed;
  }
  if (!moving && !conceal) {
    ctx.drawImage(st.layer, 0, 0, map.width, map.height);
  } else if (reuseComposite) {
    st.secretReady = conceal;
    ctx.drawImage(st.composite, 0, 0, map.width, map.height);
  } else {
    const scale = st.scale;
    const g = st.frame.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, st.frame.width, st.frame.height);
    // Moving paths open up the area outside the floor; only wall-piercing ones cut the wall pieces
    const cut = (pierce: boolean) => {
      g.setTransform(scale, 0, 0, scale, 0, 0);
      const path = new Path2D();
      let any = false;
      objects.forEach((o, i) => {
        if (o.dynamic && o.role === 'path' && !!o.src?.pierce === pierce && shown(i)) {
          tracePosed(path, o, timeOf(i));
          any = true;
        }
      });
      if (any) {
        g.globalCompositeOperation = 'destination-out';
        g.fill(path, 'nonzero');
        g.globalCompositeOperation = 'source-over';
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    };
    g.drawImage(st.outside, 0, 0);
    cut(false);
    g.drawImage(st.wallPieces, 0, 0);
    cut(true);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const walls = new Path2D();
    objects.forEach((o, i) => {
      if (o.dynamic && o.role === 'wall' && !isSaw(i) && shown(i)) tracePosed(walls, o, timeOf(i));
    });
    map.objects.forEach((m, i) => {
      if (!isDoor(m) || !shown(i)) return;
      const open = doorOpenAt(m, i);
      const s = m.shape as { x: number; y: number; w: number; h: number };
      const panels = new Path2D();
      for (const half of doorPanels(s)) {
        panels.rect(half.rect.x + half.slide.x * open, half.rect.y + half.slide.y * open, half.rect.w, half.rect.h);
      }
      walls.addPath(panels, m.tilt ? tiltMatrix(m.tilt, s.x + s.w / 2, s.y + s.h / 2) : undefined);
    });
    g.fillStyle = theme ? fillStyle(g, theme.wall.fill, { minX: 0, minY: 0, maxX: map.width, maxY: map.height }) : COLORS.wall;
    g.fill(walls, 'nonzero');
    if (conceal) {
      // Build the covering at wall-layer resolution and union it BEFORE shadows.
      // This removes internal seams and lets both surfaces share pattern sampling.
      const secret = st.secret ??= offscreen(st.frame.width, st.frame.height)[0];
      const sg = secret.getContext('2d')!;
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, secret.width, secret.height);
      sg.setTransform(scale, 0, 0, scale, 0, 0);
      paintSecretWalls(sg, map, objects, t, opts.secretCursor ?? null, 1, opts);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(secret, 0, 0);
      st.secretReady = true;
    }
    // Compose at layer resolution, then place it on the map (zoom and letterbox included)
    const c = st.composite.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, st.composite.width, st.composite.height);
    c.drawImage(st.floor, 0, 0);
    drawWallMass(c, st.frame, theme, scale);
    ctx.drawImage(st.composite, 0, 0, map.width, map.height);
  }

  zone(ctx, map.start, COLORS.start, COLORS.startEdge, tr('zone.start'));
  // Locked GOAL (coins still to collect): dark gray, with the coins collected so far, e.g. "3/10"
  const left = opts.coinsLeft ?? 0;
  if (left > 0) {
    const total = map.objects.reduce((n, o) => n + (o.role === 'coin' ? 1 : 0), 0);
    zone(ctx, map.goal, COLORS.goalLocked, COLORS.goalLockedEdge, `${Math.max(0, total - left)}/${total}`, false);
  } else zone(ctx, map.goal, COLORS.goal, COLORS.goalEdge, tr('zone.goal'));

  // Event zones lie on the floor
  objects.forEach((o, i) => {
    const trig = map.objects[i]?.trigger;
    if (trig && (trig.kind === 'startZone' || trig.kind === 'stopZone') && shown(i)) drawEventZone(ctx, o, timeOf(i), map.objects[i]);
  });

  // Dotted routes of obstacles set to show them (motion.showPath), on the floor and walls but
  // behind every moving path and wall (later layers like coins and switches cover them anyway)
  if (objects.some((o, i) => o.src?.motion?.showPath && shown(i))) {
    ctx.save();
    const clip = new Path2D();
    clip.rect(0, 0, map.width, map.height);
    objects.forEach((o, i) => {
      if (o.dynamic && (o.role === 'path' || o.role === 'wall') && shown(i)) tracePosed(clip, o, timeOf(i), true);
    });
    ctx.clip(clip, 'nonzero');
    objects.forEach((o, i) => {
      if (o.src?.motion?.showPath && shown(i)) drawRoute(ctx, o, COLORS.ink);
    });
    ctx.restore();
  }

  // Text boxes lie on the floor and walls
  objects.forEach((o, i) => {
    const m = map.objects[i];
    if (o.role === 'text' && m?.text && shown(i)) drawTextBox(ctx, o, timeOf(i), m.text);
  });
  // Grinders and saw blades sit behind the walls they cut into, throwing dust where they touch one
  if (objects.some((o, i) => map.objects[i]?.saw && o.role === 'wall' && shown(i))) {
    const mask = wallMask(st, map);
    const dust = theme ? theme.wall.edge : COLORS.wallEdge;
    const [layer, g] = sawLayer(ctx);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, layer.width, layer.height);
    g.setTransform(ctx.getTransform());
    const sprays: ((target: CanvasRenderingContext2D) => void)[] = [];
    objects.forEach((o, i) => {
      const m = map.objects[i];
      if (m?.saw && o.role === 'wall' && shown(i)) sprays.push(drawSaw(g, o, timeOf(i), m, mask, dust, i));
    });
    const ghost = Math.max(0, Math.min(1, opts.sawGhost ?? 0));
    if (ghost > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = ghost;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
    // Erase what lies inside the wall mass this frame (static walls, or the per-frame mass with
    // moving walls and doors)
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(moving || conceal ? st.frame : st.walls, 0, 0, map.width, map.height);
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    for (const spray of sprays) spray(ctx);
  }
  // Screws on the pivots of rotating obstacles set to show them
  objects.forEach((o, i) => {
    if (o.src?.rotation?.showPivot && !o.src.boulder && !o.src.saw && shown(i)) drawPivotScrew(ctx, o, timeOf(i));
  });
  // Switch doors: a stripe in the switch color along each panel
  map.objects.forEach((m, i) => {
    if (isDoor(m) && m.door!.mode === 'switch' && shown(i)) drawDoorStripes(ctx, m, doorOpenAt(m, i));
  });
  // Switches
  objects.forEach((o, i) => {
    const trig = map.objects[i]?.trigger;
    if (!trig || trig.kind === 'startZone' || trig.kind === 'stopZone' || !shown(i)) return;
    drawSwitch(ctx, o, timeOf(i), map.objects[i], channels[trig.color] === 1, opts.progress?.[i] ?? 0);
  });
  objects.forEach((o, i) => {
    if (o.role === 'coin' && shown(i)) drawCoin(ctx, o, timeOf(i));
  });
  // Falling rocks (#51): a shadow growing where the rock will land, and shards once it has
  const fallEdge = theme ? theme.wall.edge : COLORS.wallEdge;
  objects.forEach((o, i) => {
    const f = map.objects[i]?.fall;
    if (f) drawFallEffects(ctx, o, f, timeOf(i), fallEdge, i);
  });
  // Pulleys (#52)
  objects.forEach((o, i) => {
    const p = map.objects[i]?.pulley;
    if (p && o.role === 'pulley' && shown(i)) drawPulley(ctx, o, timeOf(i), p, opts.pulleyAngle?.[i] ?? 0);
  });
  // Crystal stars (#59)
  objects.forEach((o, i) => {
    if (o.role === 'crystal' && shown(i)) drawCrystal(ctx, o, timeOf(i), opts.now ?? t);
  });
  // Torches (#57 / #58), unless being carried
  objects.forEach((o, i) => {
    if (o.role === 'torch' && shown(i) && !opts.carried?.[i]) drawTorch(ctx, o, timeOf(i), opts.now ?? t, i);
  });
  objects.forEach((o, i) => {
    if (!shown(i)) return;
    const m = map.objects[i];
    if (o.role === 'portal' && m?.portal) drawPortal(ctx, o, timeOf(i), m, opts.now ?? t);
    else if (o.role === 'mirror') drawMirror(ctx, o, timeOf(i));
  });
  if (opts.beams) drawBeams(ctx, opts.beams);
  // Emitters on top of their own beams
  objects.forEach((o, i) => {
    const m = map.objects[i];
    if (o.role === 'laser' && m?.laser && shown(i)) drawEmitter(ctx, o, timeOf(i), m);
  });
  // Safe zones on top: whatever passes under them is harmless there
  objects.forEach((o, i) => {
    if (o.role === 'safe' && shown(i)) drawSafeZone(ctx, o, timeOf(i));
  });
  if (opts.gridOnTop) drawGrid(ctx, map, COLORS.gridTop);
}

const routeCache = new WeakMap<CompiledObject, number[]>();

/** An obstacle's route as a dotted line (map units) */
function drawRoute(ctx: CanvasRenderingContext2D, o: CompiledObject, color: string): void {
  const m = o.src!;
  let route = routeCache.get(o);
  if (!route) routeCache.set(o, (route = new CompiledMotion(m.motion!, shapeCenter(m.shape)).route()));
  if (route.length < 4) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([0.1, 12]);
  ctx.beginPath();
  ctx.moveTo(route[0], route[1]);
  for (let k = 2; k < route.length; k += 2) ctx.lineTo(route[k], route[k + 1]);
  // Light halo under dark dots, so the route reads on any floor or wall
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

/** A screw head on a rotating obstacle's pivot, turning with it */
function drawPivotScrew(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  transformAt(o, t, tf);
  const r = Math.max(2.5, Math.min(6, Math.min(o.maxX - o.minX, o.maxY - o.minY) * 0.3));
  ctx.save();
  ctx.transform(tf.cos, tf.sin, -tf.sin, tf.cos, o.px + tf.dx, o.py + tf.dy);
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#f4f6f9');
  g.addColorStop(1, '#9aa3b0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#5d6674';
  ctx.lineWidth = Math.max(0.8, r * 0.18);
  ctx.stroke();
  // Cross slot
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, r * 0.26);
  ctx.strokeStyle = '#4a525e';
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, 0);
  ctx.lineTo(r * 0.55, 0);
  ctx.moveTo(0, -r * 0.55);
  ctx.lineTo(0, r * 0.55);
  ctx.stroke();
  ctx.restore();
}

/**
 * Enter an object's posed frame, before its tilt: the untilted shape (`o.box`, `o.src.shape`)
 * draws where the object is at time t
 */
function enterPose(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  transformAt(o, t, tf);
  ctx.transform(
    tf.cos, tf.sin, -tf.sin, tf.cos,
    o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  );
  tiltFrame(ctx, o);
}

/** Turn the current frame by the object's static tilt about its center */
function tiltFrame(ctx: CanvasRenderingContext2D, o: CompiledObject): void {
  if (!o.tilt) return;
  ctx.translate(o.cx, o.cy);
  ctx.rotate(o.tilt);
  ctx.translate(-o.cx, -o.cy);
}

/** How long a falling rock's shards fly after it lands (ms) */
const SHATTER_MS = 450;

/**
 * Around a falling rock (#51): while it falls, a shadow on its landing place that darkens as it
 * nears; right after it lands, shards flying apart and a puff of dust.
 */
function drawFallEffects(ctx: CanvasRenderingContext2D, o: CompiledObject, f: Fall, t: number, color: string, seed: number): void {
  const s = fallState(f, t);
  const cx = (o.minX + o.maxX) / 2;
  const cy = (o.minY + o.maxY) / 2;
  const r = Math.min(o.maxX - o.minX, o.maxY - o.minY) / 2;
  ctx.save();
  if (s.falling) {
    ctx.fillStyle = `rgba(20,24,34,${0.12 + 0.3 * s.u * s.u})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.55, r * (0.45 + 0.55 * s.u), r * (0.18 + 0.22 * s.u), 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.sinceLanding < SHATTER_MS) {
    const k = s.sinceLanding / SHATTER_MS;
    // Dust
    ctx.fillStyle = `rgba(200,190,170,${0.45 * (1 - k)})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.4, r * (0.8 + 0.9 * k), r * (0.35 + 0.3 * k), 0, 0, Math.PI * 2);
    ctx.fill();
    // Shards: fixed directions per rock, flying out and falling back with gravity
    ctx.fillStyle = color;
    ctx.globalAlpha = 1 - k;
    for (let n = 0; n < 8; n++) {
      const a = -Math.PI + (n / 7) * Math.PI + Math.sin(seed * 7.3 + n) * 0.25;
      const v = r * (1.6 + ((n * 37 + seed * 11) % 7) / 6);
      const x = cx + Math.cos(a) * v * k;
      const y = cy + Math.sin(a) * v * k + r * 2.2 * k * k;
      const size = r * (0.22 + ((n * 13 + seed) % 5) / 20);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(k * (n % 2 ? 6 : -5));
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.4);
      ctx.lineTo(size * 0.6, -size * 0.7);
      ctx.lineTo(size, size * 0.5);
      ctx.lineTo(-size * 0.3, size * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Pulley (#52): a wheel with a rim in its switch color and spokes that turn as it is turned */
function drawPulley(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, p: Pulley, angle: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  const cx = (o.box.minX + o.box.maxX) / 2;
  const cy = (o.box.minY + o.box.maxY) / 2;
  const r = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2;
  const hex = switchColor(p.color).hex;
  // Wheel
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = hex;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.beginPath();
  ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Groove
  ctx.strokeStyle = 'rgba(36,52,80,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  // Spokes, turning with the pulley
  ctx.strokeStyle = hex;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = angle + (k * Math.PI) / 3;
    ctx.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2);
    ctx.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
  }
  ctx.stroke();
  // Handle on the rim, so the turning reads clearly
  ctx.fillStyle = '#243450';
  ctx.beginPath();
  ctx.arc(cx + Math.cos(angle) * r * 0.82, cy + Math.sin(angle) * r * 0.82, Math.max(2, r * 0.1), 0, Math.PI * 2);
  ctx.fill();
  // Hub
  ctx.fillStyle = hex;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#243450';
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.stroke();
  // ↻ hint: which way winds forward
  ctx.strokeStyle = 'rgba(36,52,80,0.4)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, -Math.PI * 0.9, -Math.PI * 0.55);
  ctx.stroke();
  ctx.restore();
}

/** Five-pointed star outline centered at (cx, cy) */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner: number, turn = 0): void {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + turn + (k * Math.PI) / 5;
    const rr = k % 2 ? inner : r;
    if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** One crystal-star pulse (ms) */
const CRYSTAL_PULSE_MS = 1200;

/**
 * A crystal star (#59) `size` across at (cx, cy): a faceted ice-blue to violet star that pulses:
 * it swells a little and brightens, and a ring of light spreads from it and fades. `now` drives
 * the pulse; `alpha` fades it all.
 */
export function drawCrystalAt(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, now: number, alpha = 1): void {
  const phase = (now % CRYSTAL_PULSE_MS) / CRYSTAL_PULSE_MS;
  // 0 → 1 → 0 early in each pulse, then rest
  const beat = Math.pow(Math.sin(Math.PI * Math.min(1, phase * 1.6)), 2);
  const r = (size / 2) * (1 + 0.08 * beat);
  const inner = r * 0.48;
  ctx.save();
  ctx.globalAlpha *= alpha;
  // Halo, brighter at the peak
  const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.3);
  halo.addColorStop(0, `rgba(170,230,255,${0.3 + 0.35 * beat})`);
  halo.addColorStop(1, 'rgba(170,230,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
  ctx.fill();
  // Ring of light spreading out and fading over the pulse
  ctx.strokeStyle = `rgba(150,220,255,${0.6 * (1 - phase)})`;
  ctx.lineWidth = Math.max(0.8, r * 0.08 * (1 - phase));
  ctx.beginPath();
  ctx.arc(cx, cy, r * (0.9 + 0.8 * phase), 0, Math.PI * 2);
  ctx.stroke();
  // Body
  const body = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  body.addColorStop(0, '#d9fbff');
  body.addColorStop(0.45, '#6fd6ff');
  body.addColorStop(1, '#8a6cff');
  starPath(ctx, cx, cy, r, inner);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#4b3fb8';
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.stroke();
  // Facets: a line from the center to every point and notch, lighter on the upper-left
  ctx.save();
  starPath(ctx, cx, cy, r, inner);
  ctx.clip();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? inner : r;
    const next = -Math.PI / 2 + ((k + 1) * Math.PI) / 5;
    const nr = (k + 1) % 2 ? inner : r;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    ctx.lineTo(cx + Math.cos(next) * nr, cy + Math.sin(next) * nr);
    ctx.closePath();
    ctx.fillStyle = k % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(40,20,120,0.12)';
    ctx.fill();
  }
  // Pulse: the whole star brightens at the peak
  ctx.fillStyle = `rgba(255,255,255,${0.35 * beat})`;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  // Center sparkle
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - r * 0.12, cy - r * 0.14, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrystal(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, now: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  // A gentle bob so it reads as a pickup
  const bob = Math.sin(now / 420) * 2;
  drawCrystalAt(ctx, (o.box.minX + o.box.maxX) / 2, (o.box.minY + o.box.maxY) / 2 + bob, Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY), now);
  ctx.restore();
}

/**
 * A torch standing at (cx, cy) in a w×h box (map units): a wooden handle, a wrapped head and a
 * flickering flame with a warm glow. `now` animates the flame; `seed` keeps torches out of step.
 */
export function drawTorchAt(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, now: number, seed = 0): void {
  const top = cy - h / 2;
  const flameH = h * 0.46;
  const flameW = w * 0.62;
  const flicker = 1 + 0.08 * Math.sin(now / 95 + seed * 1.7) + 0.05 * Math.sin(now / 37 + seed);
  const sway = Math.sin(now / 140 + seed) * w * 0.05;
  const fy = top + flameH; // flame base
  ctx.save();
  // Glow
  const glowR = Math.max(w, h) * 0.9;
  const glow = ctx.createRadialGradient(cx, fy - flameH * 0.4, 0, cx, fy - flameH * 0.4, glowR);
  glow.addColorStop(0, 'rgba(255,190,90,0.38)');
  glow.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, fy - flameH * 0.4, glowR, 0, Math.PI * 2);
  ctx.fill();
  // Handle: tapers toward the bottom
  ctx.fillStyle = '#8a5a2b';
  ctx.strokeStyle = '#5b3a1e';
  ctx.lineWidth = Math.max(0.8, w * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.17, fy);
  ctx.lineTo(cx + w * 0.17, fy);
  ctx.lineTo(cx + w * 0.1, cy + h / 2);
  ctx.lineTo(cx - w * 0.1, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Wrapped head
  ctx.fillStyle = '#5b3a1e';
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.24, fy - h * 0.02, w * 0.48, h * 0.12, w * 0.06);
  ctx.fill();
  // Flame: outer orange, inner yellow
  const flame = (scale: number, color: string) => {
    const fh = flameH * flicker * scale;
    const fw = flameW * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + sway * scale, fy - fh);
    ctx.bezierCurveTo(cx + fw * 0.55, fy - fh * 0.55, cx + fw * 0.5, fy, cx, fy);
    ctx.bezierCurveTo(cx - fw * 0.5, fy, cx - fw * 0.55, fy - fh * 0.55, cx + sway * scale, fy - fh);
    ctx.fill();
  };
  flame(1, '#ff8a1f');
  flame(0.62, '#ffd45e');
  flame(0.3, '#fff6c8');
  ctx.restore();
}

function drawTorch(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, now: number, seed: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  drawTorchAt(ctx, (o.box.minX + o.box.maxX) / 2, (o.box.minY + o.box.maxY) / 2, o.box.maxX - o.box.minX, o.box.maxY - o.box.minY, now, seed);
  ctx.restore();
}

const secretLayers = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();

/**
 * Secret walls (#55): drawn like the wall mass over everything under them. Around `cursor`, each
 * one fades away within its reveal radius so the player sees what lies beneath. `alpha` < 1 is the
 * see-through editor view.
 */
export function drawSecretWalls(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], t: number,
  cursor: Point | null, alpha = 1, state: { hidden?: ArrayLike<number>; clock?: ArrayLike<number> } = {},
): void {
  const st = layerCache.get(objects)?.layer;
  if (alpha === 1 && st?.secretReady && st.secret) {
    // Cover objects and the cursor trail with the SAME pixels used in the wall union.
    ctx.drawImage(st.secret, 0, 0, map.width, map.height);
    return;
  }
  paintSecretWalls(ctx, map, objects, t, cursor, alpha, state);
}

function paintSecretWalls(
  ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[], t: number,
  cursor: Point | null, alpha = 1, state: { hidden?: ArrayLike<number>; clock?: ArrayLike<number> } = {},
): void {
  const secrets = objects.flatMap((o, i) => (o.role === 'secret' && !state.hidden?.[i] ? [i] : []));
  if (!secrets.length || alpha <= 0) return;
  const m = ctx.getTransform();
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  let layer = secretLayers.get(ctx);
  if (!layer) secretLayers.set(ctx, (layer = document.createElement('canvas')));
  if (layer.width !== cw || layer.height !== ch) {
    layer.width = cw;
    layer.height = ch;
  }
  const g = layer.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.setTransform(m);
  const theme = map.theme;
  const whole: Bounds = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
  const fill = theme ? fillStyle(g, theme.wall.fill, whole) : COLORS.wall;
  const edge = theme ? theme.wall.edge : COLORS.wallEdge;
  for (const i of secrets) {
    const o = objects[i];
    const pose = transformAt(o, state.clock?.[i] ?? t, tf);
    g.beginPath();
    traceObject(g, o, pose);
    g.fillStyle = fill;
    g.fill();
    // In play there is no outline: the secret wall must look exactly like the wall mass around it.
    // The see-through editor view keeps it so the object can be found.
    if (alpha < 1) {
      g.strokeStyle = edge;
      g.lineWidth = 2;
      g.stroke();
    }
    if (cursor) {
      // Reveal: clear within the radius, fading out over the outer third
      const r = o.src?.secret?.radius ?? 60;
      g.save();
      g.beginPath();
      traceObject(g, o, pose);
      g.clip();
      g.globalCompositeOperation = 'destination-out';
      const grad = g.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.65, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(cursor.x - r, cursor.y - r, r * 2, r * 2);
      g.restore();
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** Safe zone (#48): see-through grey */
function drawSafeZone(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  ctx.beginPath();
  const { poly } = o.box;
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fillStyle = COLORS.safe;
  ctx.fill();
  ctx.strokeStyle = COLORS.safeEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

const TEXT_FONTS: Record<string, string> = {
  title: FONT_TITLE,
  main: FONT_MAIN,
  timer: FONT_TIMER,
  serif: "Georgia, 'Times New Roman', serif",
  heavy: "'Arial Black', Impact, 'Segoe UI Black', sans-serif",
  mono: "Consolas, 'Courier New', monospace",
  hand: "'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive",
};

/** Text box fonts: the base names, or a library font id */
export const TEXT_BASE_FONTS: [string, string][] = [
  ['main', 'Rounded (main)'], ['title', 'Title'], ['timer', 'Digital'], ['serif', 'Serif'], ['heavy', 'Heavy'], ['mono', 'Mono'], ['hand', 'Handwriting'],
];

function textFontCss(font: string): string {
  return TEXT_FONTS[font] ?? (isLibraryFont(font) ? libraryFontCss(font) : FONT_MAIN);
}

/** Lines that fit `maxW`: breaks at spaces, and inside words that are too long on their own */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (!line || ctx.measureText(next).width <= maxW) {
        line = next;
        // A single word wider than the box: break it by characters
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
        continue;
      }
      out.push(line.trimEnd());
      line = word.trimStart();
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Text box (#47) */
function drawTextBox(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, tb: TextBox): void {
  const s = o.src?.shape;
  if (!s || s.type !== 'rect') return;
  ctx.save();
  enterPose(ctx, o, t);
  if (tb.background) {
    ctx.fillStyle = tb.background;
    ctx.beginPath();
    ctx.roundRect(s.x, s.y, s.w, s.h, Math.min(6, s.w / 4, s.h / 4));
    ctx.fill();
  }
  if (tb.text) {
    const pad = Math.min(8, s.w / 6);
    ctx.font = `${tb.bold ? 700 : 400} ${tb.size}px ${textFontCss(tb.font)}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = tb.align;
    const lines = wrapText(ctx, tb.text, Math.max(1, s.w - pad * 2));
    const lh = tb.size * 1.2;
    const x = tb.align === 'left' ? s.x + pad : tb.align === 'right' ? s.x + s.w - pad : s.x + s.w / 2;
    let y = s.y + s.h / 2 - ((lines.length - 1) * lh) / 2;
    // Keep text inside its box, with room for effects that spill past the letters
    const spill = Math.max(tb.glow ? tb.size * 0.6 : 0, (tb.depth ?? 0) + (tb.shadow ? tb.size * 0.1 : 0) + (tb.outline ? tb.outlineWidth : 0));
    ctx.beginPath();
    ctx.rect(s.x - spill, s.y - spill, s.w + spill * 2, s.h + spill * 2);
    ctx.clip();
    for (const line of lines) {
      fillTextFx(ctx, line, x, y, tb.size, tb);
      y += lh;
    }
  }
  ctx.restore();
}

/** Text effects shared by text boxes: outline, drop shadow, neon glow, gradient and 3D extrusion */
export interface TextFx {
  color: string;
  outline?: string;
  outlineWidth?: number;
  shadow?: string;
  glow?: string;
  gradient?: string;
  depth?: number;
  depthColor?: string;
}

/** One line of text with its effects, centered on `y` (needs textBaseline 'middle') */
export function fillTextFx(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, size: number, fx: TextFx, maxWidth?: number): void {
  // Squeeze like fillText(…, maxWidth) does, for every layer at once
  if (maxWidth !== undefined) {
    const w = ctx.measureText(line).width;
    if (w > maxWidth) {
      // Scaling around x keeps the alignment (left / center / right are all relative to x)
      ctx.save();
      ctx.translate(x, 0);
      ctx.scale(maxWidth / w, 1);
      fillTextFx(ctx, line, 0, y, size, fx);
      ctx.restore();
      return;
    }
  }
  const ow = fx.outline && fx.outlineWidth ? fx.outlineWidth : 0;
  const depth = Math.min(30, fx.depth ?? 0);
  // The letter shape (outline included) in one color, for the shadow and the 3D sides
  const solid = (dx: number, dy: number, color: string) => {
    if (ow > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = ow * 2;
      ctx.strokeStyle = color;
      ctx.strokeText(line, x + dx, y + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(line, x + dx, y + dy);
  };
  ctx.save();
  if (fx.shadow) {
    const off = Math.max(2, size * 0.08) + depth * 0.8;
    ctx.save();
    ctx.globalAlpha *= 0.5;
    solid(off * 0.75, off, fx.shadow);
    ctx.restore();
  }
  // 3D: stacked copies 1px apart toward the bottom right, the farthest first
  for (let k = depth; k >= 1; k--) solid(k * 0.6, k * 0.8, fx.depthColor ?? '#000000');
  if (fx.glow) {
    // shadowBlur is in screen pixels, so scale it with the current zoom
    const m = ctx.getTransform();
    ctx.save();
    ctx.shadowColor = fx.glow;
    ctx.shadowBlur = size * 0.45 * Math.hypot(m.a, m.b);
    ctx.fillStyle = fx.glow;
    ctx.fillText(line, x, y);
    ctx.fillText(line, x, y);
    ctx.restore();
  }
  if (ow > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = ow * 2;
    ctx.strokeStyle = fx.outline!;
    ctx.strokeText(line, x, y);
  }
  if (fx.gradient) {
    const g = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
    g.addColorStop(0, fx.color);
    g.addColorStop(1, fx.gradient);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = fx.color;
  }
  ctx.fillText(line, x, y);
  ctx.restore();
}

/** Deterministic 0–1 noise, so the dust needs no state and looks the same in replays */
function hash01(a: number, b: number, c: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Dust thrown off at the points of a saw that are inside a wall: each point sprays short-lived
 * specks along `dir` (unit vector), spread a little, falling slightly.
 */
function drawDust(ctx: CanvasRenderingContext2D, pts: { x: number; y: number; dx: number; dy: number }[], t: number, color: string, seed: number): void {
  if (!pts.length) return;
  ctx.save();
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    for (let j = 0; j < 7; j++) {
      const h1 = hash01(seed, k, j);
      const life = 260 + 220 * hash01(seed, j, k + 9);
      const phase = (((t + h1 * life) % life) + life) % life / life;
      const spread = (hash01(seed + 3, k, j) - 0.5) * 1.1;
      const c = Math.cos(spread);
      const sn = Math.sin(spread);
      const dx = p.dx * c - p.dy * sn;
      const dy = p.dx * sn + p.dy * c;
      const dist = phase * (14 + 18 * hash01(seed + 7, j, k));
      const x = p.x + dx * dist;
      const y = p.y + dy * dist + phase * phase * 8;
      ctx.globalAlpha = (1 - phase) * 0.9;
      ctx.fillStyle = j % 3 === 0 ? '#ffffff' : color;
      const r = 0.8 + 1.4 * (1 - phase) * hash01(seed + 5, k, j);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Per target canvas: a same-size scratch layer for the saw blades */
const sawLayers = new WeakMap<CanvasRenderingContext2D, [HTMLCanvasElement, CanvasRenderingContext2D]>();
function sawLayer(ctx: CanvasRenderingContext2D): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const { width, height } = ctx.canvas;
  let l = sawLayers.get(ctx);
  if (!l) sawLayers.set(ctx, l = offscreen(width, height));
  if (l[0].width !== width || l[0].height !== height) {
    l[0].width = width;
    l[0].height = height;
  }
  return l;
}

/**
 * Grinder disc (#43, #45) or saw blade (#44, #46), drawn into `ctx`. Returns a painter for its
 * dust, which goes on the map itself (over the walls).
 */
function drawSaw(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, m: MapObject, mask: WallMask, dust: string, seed: number): (target: CanvasRenderingContext2D) => void {
  const saw = m.saw!;
  const s = m.shape;
  transformAt(o, t, tf);
  const contact: { x: number; y: number; dx: number; dy: number }[] = [];
  if (saw.kind === 'disc' && s.type === 'ellipse') {
    const r = Math.min(s.rx, s.ry);
    const c = toWorld(o, tf, s.cx, s.cy, { x: 0, y: 0 });
    const dir = saw.clockwise ? 1 : -1;
    const N = 28;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (!isWallAt(mask, x, y)) continue;
      // Thrown along the rim in the spin direction, a little outward
      contact.push({ x, y, dx: -Math.sin(a) * dir * 0.85 + Math.cos(a) * 0.5, dy: Math.cos(a) * dir * 0.85 + Math.sin(a) * 0.5 });
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(Math.atan2(tf.sin, tf.cos) + o.tilt);
    // Teeth
    const teeth = Math.max(10, Math.round(r / 2.4));
    ctx.beginPath();
    for (let k = 0; k < teeth; k++) {
      const a0 = (k / teeth) * Math.PI * 2;
      const a1 = ((k + 0.72) / teeth) * Math.PI * 2;
      const inner = r * 0.84;
      if (k === 0) ctx.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
      else ctx.lineTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#f4f6f9');
    g.addColorStop(0.65, '#b9c1cc');
    g.addColorStop(1, '#7d8794');
    ctx.fillStyle = g;
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#4b5361';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Slots, so the spin shows
    ctx.strokeStyle = 'rgba(60,68,80,0.55)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38);
      ctx.lineTo(Math.cos(a + 0.35) * r * 0.66, Math.sin(a + 0.35) * r * 0.66);
      ctx.stroke();
    }
    // Hub
    ctx.fillStyle = '#5a6272';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9edf2';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (s.type === 'rect') {
    const long = s.w >= s.h;
    // Sawing direction right now, for the dust
    const v = Math.cos((2 * Math.PI * t) / Math.max(1, saw.strokeMs));
    const along = v >= 0 ? 1 : -1;
    const N = 10;
    for (const side of [-1, 1]) {
      for (let k = 0; k <= N; k++) {
        const lx = long ? s.x + (s.w * k) / N : side < 0 ? s.x : s.x + s.w;
        const ly = long ? (side < 0 ? s.y : s.y + s.h) : s.y + (s.h * k) / N;
        const q = tiltPoint(o, lx, ly, { x: 0, y: 0 });
        const p = toWorld(o, tf, q.x, q.y, q);
        if (!isWallAt(mask, p.x, p.y)) continue;
        contact.push(long
          ? { x: p.x, y: p.y, dx: along * 0.8, dy: side * 0.6 }
          : { x: p.x, y: p.y, dx: side * 0.6, dy: along * 0.8 });
      }
    }
    ctx.save();
    enterPose(ctx, o, t);
    // Work in a frame where the blade lies along x
    const len = long ? s.w : s.h;
    const thick = long ? s.h : s.w;
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
    if (!long) ctx.rotate(Math.PI / 2);
    const tooth = Math.min(6, thick * 0.3);
    const body = thick - tooth * 2;
    const g = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
    g.addColorStop(0, '#eef1f5');
    g.addColorStop(0.5, '#b4bcc8');
    g.addColorStop(1, '#848e9b');
    ctx.fillStyle = g;
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    // Teeth along both edges
    const n = Math.max(3, Math.round(len / (tooth * 1.6 || 1)));
    const step = len / n;
    ctx.moveTo(-len / 2, -body / 2);
    for (let k = 0; k < n; k++) {
      ctx.lineTo(-len / 2 + step * k + step * 0.7, -thick / 2);
      ctx.lineTo(-len / 2 + step * (k + 1), -body / 2);
    }
    ctx.lineTo(len / 2, body / 2);
    for (let k = n - 1; k >= 0; k--) {
      ctx.lineTo(-len / 2 + step * k + step * 0.3, thick / 2);
      ctx.lineTo(-len / 2 + step * k, body / 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#4b5361';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Spine with rivets
    ctx.fillStyle = 'rgba(70,78,90,0.45)';
    ctx.fillRect(-len / 2 + 2, -Math.max(1, body * 0.12), len - 4, Math.max(2, body * 0.24));
    ctx.fillStyle = '#5a6272';
    for (const fx of [-0.36, 0, 0.36]) {
      ctx.beginPath();
      ctx.arc(len * fx, 0, Math.max(1.2, body * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // At most a handful of spray points, spread around the contact
  const step = Math.max(1, Math.ceil(contact.length / 5));
  const points = contact.filter((_, k) => k % step === 0);
  return (target) => drawDust(target, points, t, dust, seed);
}

/** Laser beams: a soft colored glow with a bright core */
export function drawBeams(ctx: CanvasRenderingContext2D, beams: readonly Beam[]): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const b of beams) {
    const col = switchColor(b.color).hex;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(b.pts[0], b.pts[1]);
      for (let k = 2; k < b.pts.length; k += 2) ctx.lineTo(b.pts[k], b.pts[k + 1]);
    };
    ctx.strokeStyle = `${col}66`;
    ctx.lineWidth = 9;
    trace();
    ctx.stroke();
    ctx.strokeStyle = b.color === 15 ? '#4b4f5c' : col;
    ctx.lineWidth = 4;
    trace();
    ctx.stroke();
    ctx.strokeStyle = b.color === 15 ? '#9aa0ad' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.4;
    trace();
    ctx.stroke();
  }
  ctx.restore();
}

/** Laser emitter (#37): a dark housing with a lens in the beam color, pointing along the beam */
function drawEmitter(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, m: MapObject): void {
  const l = m.laser!;
  const col = switchColor(l.color).hex;
  inFrame(ctx, o, t, () => {
    polyPath(ctx, o.box);
    ctx.fillStyle = '#3a3f4b';
    ctx.fill();
    ctx.strokeStyle = '#1d2027';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const cx = (o.box.minX + o.box.maxX) / 2;
    const cy = (o.box.minY + o.box.maxY) / 2;
    const s = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY);
    // The beam angle is in map space; this frame is turned by the tilt
    const a = (l.angle * Math.PI) / 180 - o.tilt;
    // Barrel toward the beam
    ctx.strokeStyle = '#1d2027';
    ctx.lineWidth = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Mirror (#38): silver glass with a bright rim */
function drawMirror(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  inFrame(ctx, o, t, () => {
    polyPath(ctx, o.box);
    const g = ctx.createLinearGradient(o.box.minX, o.box.minY, o.box.maxX, o.box.maxY);
    g.addColorStop(0, '#eef6ff');
    g.addColorStop(0.5, '#b8c8dc');
    g.addColorStop(1, '#f6fbff');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#7d8fa8';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
}

/** Teleport portal (#39): swirling rings in its color; arrows show entrance / exit only */
function drawPortal(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, m: MapObject, now: number): void {
  const p = m.portal!;
  const col = switchColor(p.color).hex;
  const edge = p.color === 15 ? '#111217' : darker(col);
  inFrame(ctx, o, t, () => {
    const cx = (o.box.minX + o.box.maxX) / 2;
    const cy = (o.box.minY + o.box.maxY) / 2;
    const s = Math.min(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2;
    polyPath(ctx, o.box);
    ctx.fillStyle = `${col}40`;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Swirl: three arcs turning inward
    const spin = (now / 600) % (Math.PI * 2);
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const r = s * (0.8 - k * 0.22);
      ctx.strokeStyle = k === 1 ? edge : col;
      ctx.lineWidth = Math.max(1.5, s * 0.12);
      ctx.beginPath();
      const a0 = spin * (k % 2 ? -1 : 1) + k * 2.1;
      ctx.arc(cx, cy, r, a0, a0 + Math.PI * 1.3);
      ctx.stroke();
    }
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
    // One-way marks at the corners: ▸ pointing in (entrance) or out (exit)
    if (p.mode !== 'both') {
      const inward = p.mode === 'in';
      ctx.fillStyle = edge;
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const tipIn = inward ? 0.55 : 0.95;
        const baseIn = inward ? 0.95 : 0.55;
        const tx = cx + dx * s * tipIn;
        const ty = cy + dy * s * tipIn;
        const bx = cx + dx * s * baseIn;
        const by = cy + dy * s * baseIn;
        const w = s * 0.16;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx + dy * w, by - dx * w);
        ctx.lineTo(bx - dy * w, by + dx * w);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Order within its color
    ctx.fillStyle = p.color === 15 ? '#fff' : '#243450';
    ctx.font = `700 ${Math.max(8, s * 0.42)}px ${FONT_MAIN}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(p.order + 1), o.box.maxX - 2, o.box.maxY - 1);
  });
}

/** Run `draw` in the object's posed frame at time t (before its tilt, like `enterPose`) */
function inFrame(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, draw: () => void): void {
  ctx.save();
  enterPose(ctx, o, t);
  draw();
  ctx.restore();
}

function polyPath(ctx: CanvasRenderingContext2D, o: { poly: Float64Array }): void {
  const { poly } = o;
  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
}

/** Darker shade of a #rrggbb color for outlines */
function darker(hex: string, k = 0.62): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * Switch button (#32–34): a square in its color, lit and "pressed" while its color is ON.
 * Timer / hold switches show a clock wipe: time left, or how long you've held it.
 */
function drawSwitch(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, m: MapObject, on: boolean, progress: number): void {
  const trig = m.trigger!;
  const col = switchColor(trig.color).hex;
  const edge = trig.color === 15 ? '#111217' : darker(col);
  inFrame(ctx, o, t, () => {
    const x = o.box.minX;
    const y = o.box.minY;
    const w = o.box.maxX - o.box.minX;
    const h = o.box.maxY - o.box.minY;
    const s = Math.min(w, h);
    const r = Math.min(8, s * 0.22);
    // Base plate
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    // Button face: raised when OFF, pressed in (and lit) when ON
    const inset = s * (on ? 0.16 : 0.1);
    ctx.save();
    if (on) {
      ctx.shadowColor = col;
      ctx.shadowBlur = s * 0.5;
    }
    ctx.fillStyle = on ? col : `${col}b3`;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset - (on ? 0 : s * 0.04), w - inset * 2, h - inset * 2, r * 0.7);
    ctx.fill();
    ctx.restore();
    // Clock wipe: from 12 o'clock, clockwise
    if ((trig.kind === 'timer' || trig.kind === 'hold') && progress > 0) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.fillStyle = trig.color === 15 ? 'rgba(255,255,255,0.45)' : 'rgba(36,52,80,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, s * 0.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
      ctx.closePath();
      ctx.fill();
    }
    // Small mark of the kind: ring for a timer, dot for hold, hand for click
    ctx.strokeStyle = trig.color === 15 ? 'rgba(255,255,255,0.8)' : 'rgba(36,52,80,0.55)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    if (trig.kind === 'timer' || trig.kind === 'hold') {
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, s * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (trig.click) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Event start / stop zone (#35 / #36): a tinted area with a ▶ or ■ mark */
function drawEventZone(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, m: MapObject): void {
  const trig = m.trigger!;
  const col = switchColor(trig.color).hex;
  inFrame(ctx, o, t, () => {
    polyPath(ctx, o.box);
    ctx.fillStyle = `${col}55`;
    ctx.fill();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = trig.color === 15 ? '#111217' : darker(col);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    const cx = (o.box.minX + o.box.maxX) / 2;
    const cy = (o.box.minY + o.box.maxY) / 2;
    const s = Math.min(16, (o.box.maxX - o.box.minX) * 0.3, (o.box.maxY - o.box.minY) * 0.3);
    ctx.fillStyle = trig.color === 15 ? '#111217' : darker(col);
    ctx.beginPath();
    if (trig.kind === 'startZone') {
      ctx.moveTo(cx - s * 0.5, cy - s * 0.6);
      ctx.lineTo(cx + s * 0.6, cy);
      ctx.lineTo(cx - s * 0.5, cy + s * 0.6);
      ctx.closePath();
    } else {
      ctx.rect(cx - s * 0.5, cy - s * 0.5, s, s);
    }
    ctx.fill();
  });
}

/** Sliding door (#40) panels are part of the wall mass; a switch door also shows its color */
function drawDoorStripes(ctx: CanvasRenderingContext2D, m: MapObject, open: number): void {
  const s = m.shape as { x: number; y: number; w: number; h: number };
  ctx.save();
  if (m.tilt) ctx.transform(...tiltMatrixArgs(m.tilt, s.x + s.w / 2, s.y + s.h / 2));
  ctx.fillStyle = switchColor(m.door!.color).hex;
  for (const half of doorPanels(s)) {
    const x = half.rect.x + half.slide.x * open;
    const y = half.rect.y + half.slide.y * open;
    if (s.w >= s.h) ctx.fillRect(x + 2, y + half.rect.h / 2 - 2, half.rect.w - 4, 4);
    else ctx.fillRect(x + half.rect.w / 2 - 2, y + 2, 4, half.rect.h - 4);
  }
  ctx.restore();
}

/** Canvas transform turning `deg` degrees clockwise about (cx, cy) */
function tiltMatrixArgs(deg: number, cx: number, cy: number): [number, number, number, number, number, number] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

function tiltMatrix(deg: number, cx: number, cy: number): DOMMatrix2DInit {
  const [a, b, c, d, e, f] = tiltMatrixArgs(deg, cx, cy);
  return { a, b, c, d, e, f };
}

export function drawTrail(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  if (pts.length < 4) return;
  ctx.strokeStyle = COLORS.trail;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  // NaN entries break the line (teleports)
  let gap = true;
  for (let i = 0; i < pts.length; i += 2) {
    if (Number.isNaN(pts[i])) {
      gap = true;
      continue;
    }
    if (gap) ctx.moveTo(pts[i], pts[i + 1]);
    else ctx.lineTo(pts[i], pts[i + 1]);
    gap = false;
  }
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
  const total = displayTime(ms);
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
