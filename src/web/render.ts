import { createPatternTile, PATTERN_RES } from './theme-pattern';
import { toWorld, transformAt, type CompiledObject, type Transform } from '../core/object';
import { primaryColor, secondaryColor, shade } from '../core/theme';
import { switchColor } from '../core/colors';
import type { Beam } from '../core/laser';
import { autoDoorOpen, doorPanels, initialChannels } from '../core/switches';
import { isLibraryFont } from '../core/font-catalog';
import type { Fill, MapData, MapObject, Point, Rect, TextBox } from '../core/types';
import { libraryFontCss } from './library-fonts';

export const COLORS = {
  bg: '#f6fbff',
  /** Bars around maps that aren't 16:9 */
  letterbox: '#dfe8f3',
  floor: '#ffffff',
  floorEdge: '#9cc3e6',
  grid: 'rgba(60,100,160,0.08)',
  /** Grid drawn over walls and obstacles (editor option): stronger so it shows on any surface */
  gridTop: 'rgba(36,52,80,0.28)',
  wall: '#8fa3bf',
  wallEdge: '#6a809f',
  /** Safe zone (#48) */
  safe: 'rgba(120,124,132,0.38)',
  safeEdge: 'rgba(90,94,104,0.55)',
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
  coin: '#ffd25e',
  coinEdge: '#d39a12',
  coinShine: '#fff4c4',
  dark: '#000000',
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
  /** Static wall mass alone (no shadow / rim) */
  walls: HTMLCanvasElement;
  /** Scratch canvas for the per-frame wall mass */
  frame: HTMLCanvasElement;
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
  const [floor, f] = offscreen(w, h);
  f.scale(scale, scale);
  f.fillStyle = paths ? (theme ? fillStyle(f, theme.path.fill, whole) : COLORS.floor) : COLORS.bg;
  f.fillRect(0, 0, map.width, map.height);
  // Default grid sits on the floor, under the walls ("Grid on top" draws another one over everything)
  drawGrid(f, map, COLORS.grid);
  const [layer, s] = offscreen(w, h);
  s.drawImage(floor, 0, 0);
  drawWallMass(s, wallCanvas, theme, scale);
  return { layer, floor, walls: wallCanvas, frame: offscreen(w, h)[0] };
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

/** Add an object's posed outline (world coordinates) to the current path */
function tracePosed(g: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  transformAt(o, t, tf);
  const { poly } = o;
  for (let i = 0; i < poly.length; i += 2) {
    const lx = poly[i] - o.px;
    const ly = poly[i + 1] - o.py;
    const x = tf.cos * lx - tf.sin * ly + o.px + tf.dx;
    const y = tf.sin * lx + tf.cos * ly + o.py + tf.dy;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

const layerCache = new WeakMap<readonly CompiledObject[], { key: string; layer: StaticLayer }>();

function staticLayer(ctx: CanvasRenderingContext2D, map: MapData, objects: readonly CompiledObject[]): StaticLayer {
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
  /** Animation time for portal swirls (ms); default `t` */
  now?: number;
  /** Coins still needed: GOAL shows how many are left and looks locked */
  coinsLeft?: number;
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
  const { poly } = o;
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
  const cx = (o.minX + o.maxX) / 2;
  const cy = (o.minY + o.maxY) / 2;
  const r = Math.min(o.maxX - o.minX, o.maxY - o.minY) / 2;
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
  ctx: CanvasRenderingContext2D, map: MapData, lights: readonly { x: number; y: number; r: number }[], alpha = 1,
): void {
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
    const grad = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.65, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(l.x, l.y, l.r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
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
  const isSaw = (i: number) => !!map.objects[i]?.saw;
  const moving = objects.some((o, i) => (o.dynamic && (o.role === 'path' || (o.role === 'wall' && !isSaw(i)))) || isDoor(map.objects[i]));
  if (!moving) {
    ctx.drawImage(st.layer, 0, 0, map.width, map.height);
  } else {
    const scale = ctx.getTransform().a;
    const g = st.frame.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, st.frame.width, st.frame.height);
    g.drawImage(st.walls, 0, 0);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.beginPath();
    objects.forEach((o, i) => {
      if (o.dynamic && o.role === 'path' && shown(i)) tracePosed(g, o, timeOf(i));
    });
    g.globalCompositeOperation = 'destination-out';
    g.fill('nonzero');
    g.globalCompositeOperation = 'source-over';
    g.beginPath();
    objects.forEach((o, i) => {
      if (o.dynamic && o.role === 'wall' && !isSaw(i) && shown(i)) tracePosed(g, o, timeOf(i));
    });
    map.objects.forEach((m, i) => {
      if (!isDoor(m) || !shown(i)) return;
      const open = doorOpenAt(m, i);
      for (const half of doorPanels(m.shape as { x: number; y: number; w: number; h: number })) {
        g.rect(half.rect.x + half.slide.x * open, half.rect.y + half.slide.y * open, half.rect.w, half.rect.h);
      }
    });
    g.fillStyle = theme ? fillStyle(g, theme.wall.fill, { minX: 0, minY: 0, maxX: map.width, maxY: map.height }) : COLORS.wall;
    g.fill('nonzero');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(st.floor, 0, 0);
    drawWallMass(ctx, st.frame, theme, scale);
    ctx.restore();
  }

  zone(ctx, map.start, COLORS.start, COLORS.startEdge, 'START');
  const left = opts.coinsLeft ?? 0;
  zone(ctx, map.goal, COLORS.goal, COLORS.goalEdge, left > 0 ? `🔒${left}` : 'GOAL');

  // Event zones lie on the floor
  objects.forEach((o, i) => {
    const trig = map.objects[i]?.trigger;
    if (trig && (trig.kind === 'startZone' || trig.kind === 'stopZone') && shown(i)) drawEventZone(ctx, o, timeOf(i), map.objects[i]);
  });

  // Text boxes lie on the floor and walls
  objects.forEach((o, i) => {
    const m = map.objects[i];
    if (o.role === 'text' && m?.text && shown(i)) drawTextBox(ctx, o, timeOf(i), m.text);
  });
  // Grinders and saw blades, throwing dust where they cut into a wall
  if (map.objects.some((m) => m.saw)) {
    const mask = wallMask(st, map);
    const dust = theme ? theme.wall.edge : COLORS.wallEdge;
    objects.forEach((o, i) => {
      const m = map.objects[i];
      if (m?.saw && o.role === 'wall' && shown(i)) drawSaw(ctx, o, timeOf(i), m, mask, dust, i);
    });
  }
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

/** Enter an object's posed frame (rest-pose coordinates draw where the object is at time t) */
function enterPose(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  transformAt(o, t, tf);
  ctx.transform(
    tf.cos, tf.sin, -tf.sin, tf.cos,
    o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  );
}

/** Safe zone (#48): see-through grey */
function drawSafeZone(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number): void {
  ctx.save();
  enterPose(ctx, o, t);
  ctx.beginPath();
  const { poly } = o;
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
    ctx.beginPath();
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    for (const line of lines) {
      if (tb.outline && tb.outlineWidth > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = tb.outlineWidth * 2;
        ctx.strokeStyle = tb.outline;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = tb.color;
      ctx.fillText(line, x, y);
      y += lh;
    }
  }
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

/** Grinder disc (#43, #45) or saw blade (#44, #46) */
function drawSaw(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, m: MapObject, mask: WallMask, dust: string, seed: number): void {
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
    ctx.rotate(Math.atan2(tf.sin, tf.cos));
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
        const p = toWorld(o, tf, lx, ly, { x: 0, y: 0 });
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
  drawDust(ctx, contact.filter((_, k) => k % step === 0), t, dust, seed);
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
    polyPath(ctx, o);
    ctx.fillStyle = '#3a3f4b';
    ctx.fill();
    ctx.strokeStyle = '#1d2027';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const cx = (o.minX + o.maxX) / 2;
    const cy = (o.minY + o.maxY) / 2;
    const s = Math.min(o.maxX - o.minX, o.maxY - o.minY);
    const a = (l.angle * Math.PI) / 180;
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
    polyPath(ctx, o);
    const g = ctx.createLinearGradient(o.minX, o.minY, o.maxX, o.maxY);
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
    const cx = (o.minX + o.maxX) / 2;
    const cy = (o.minY + o.maxY) / 2;
    const s = Math.min(o.maxX - o.minX, o.maxY - o.minY) / 2;
    polyPath(ctx, o);
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
    ctx.fillText(String(p.order + 1), o.maxX - 2, o.maxY - 1);
  });
}

/** Run `draw` in the object's posed frame at time t */
function inFrame(ctx: CanvasRenderingContext2D, o: CompiledObject, t: number, draw: () => void): void {
  transformAt(o, t, tf);
  ctx.save();
  ctx.transform(
    tf.cos, tf.sin, -tf.sin, tf.cos,
    o.px + tf.dx - tf.cos * o.px + tf.sin * o.py,
    o.py + tf.dy - tf.sin * o.px - tf.cos * o.py,
  );
  draw();
  ctx.restore();
}

function polyPath(ctx: CanvasRenderingContext2D, o: CompiledObject): void {
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
    const x = o.minX;
    const y = o.minY;
    const w = o.maxX - o.minX;
    const h = o.maxY - o.minY;
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
    polyPath(ctx, o);
    ctx.fillStyle = `${col}55`;
    ctx.fill();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = trig.color === 15 ? '#111217' : darker(col);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    const cx = (o.minX + o.maxX) / 2;
    const cy = (o.minY + o.maxY) / 2;
    const s = Math.min(16, (o.maxX - o.minX) * 0.3, (o.maxY - o.minY) * 0.3);
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
  ctx.fillStyle = switchColor(m.door!.color).hex;
  for (const half of doorPanels(s)) {
    const x = half.rect.x + half.slide.x * open;
    const y = half.rect.y + half.slide.y * open;
    if (s.w >= s.h) ctx.fillRect(x + 2, y + half.rect.h / 2 - 2, half.rect.w - 4, 4);
    else ctx.fillRect(x + half.rect.w / 2 - 2, y + 2, 4, half.rect.h - 4);
  }
}

export function drawTrail(ctx: CanvasRenderingContext2D, pts: readonly number[], color?: string): void {
  if (pts.length < 4) return;
  // A custom cursor color tints the trail to match (semi-transparent like the default)
  ctx.strokeStyle = color ? `${color}8c` : COLORS.trail;
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
