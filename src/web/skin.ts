/**
 * Cursor skin: the pointer shape, the trail style and two colors picked from a fixed 64-color
 * palette. `primary` is the main color of the pointer and trail, `accent` their detail color.
 * Cosmetic only: the simulation always checks the exact cursor point.
 */

/** Pointer skins by number. #0 'none': no skin, the system mouse cursor stays visible during a run */
export const POINTER_SKINS = ['none', 'dot', 'ring', 'square', 'diamond', 'triangle', 'star', 'cross', 'arrow', 'sword'] as const;
/** Trail skins by number. #0 'none': no trail */
export const TRAIL_SKINS = ['none', 'line', 'glow', 'dual', 'dashed', 'dots', 'fade', 'solidDashed', 'stars', 'slash'] as const;
export type PointerShape = (typeof POINTER_SKINS)[number];
export type TrailStyle = (typeof TRAIL_SKINS)[number];

export interface Skin {
  /** Index into POINTER_SKINS */
  pointer: number;
  /** Index into TRAIL_SKINS */
  trail: number;
  primary: string;
  accent: string;
}

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Palette rows: neutral, then hue families (red, orange, yellow, green, teal, blue, violet) */
const HUES = [0, 28, 50, 125, 175, 212, 280];
/** Palette columns, light to dark */
const LIGHTNESS = [0.9, 0.8, 0.7, 0.6, 0.52, 0.42, 0.32, 0.22];
const NEUTRALS = ['#ffffff', '#e3e8ef', '#c3cbd6', '#9aa5b4', '#6f7b8c', '#4a5566', '#2a3240', '#0f141c'];

/** 64 colors: 8 rows (neutral, then 7 hues) of 8 columns (light → dark) */
export const PALETTE: readonly string[] = [...NEUTRALS, ...HUES.flatMap((h) => LIGHTNESS.map((l) => hsl(h, 0.78, l)))];
export const PALETTE_COLUMNS = 8;

/** The original look: a blue dot with a white rim and a plain blue line */
export const DEFAULT_SKIN: Readonly<Skin> = {
  pointer: 1,
  trail: 1,
  primary: PALETTE[(1 + HUES.indexOf(212)) * PALETTE_COLUMNS + LIGHTNESS.indexOf(0.52)],
  accent: '#ffffff',
};

export function pointerShape(skin: Skin): PointerShape {
  return POINTER_SKINS[skin.pointer] ?? 'dot';
}

export function trailStyle(skin: Skin): TrailStyle {
  return TRAIL_SKINS[skin.trail] ?? 'line';
}

export function isPaletteColor(v: unknown): v is string {
  return typeof v === 'string' && PALETTE.includes(v);
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Color between hex colors `a` (k = 0) and `b` (k = 1), with alpha */
function mix(a: string, b: string, k: number, alpha: number): string {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((p >> shift) & 255) * (1 - k) + ((q >> shift) & 255) * k);
  return `rgba(${ch(16)},${ch(8)},${ch(0)},${alpha})`;
}

function star(ctx: CanvasRenderingContext2D, r: number, inner: number, n: number): void {
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const d = i % 2 ? inner : r;
    if (i === 0) ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
    else ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  ctx.closePath();
}

/**
 * Pointer at (x, y). `unit` is map units per screen pixel and `size` the pointer's screen size in
 * pixels, so it looks the same at any zoom. The point itself is always the shape's hotspot
 * (the center, or the tip for the arrow).
 */
export function drawPointer(ctx: CanvasRenderingContext2D, skin: Skin, x: number, y: number, unit: number, size = 8): void {
  const shape = pointerShape(skin);
  if (shape === 'none') return;
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(unit, unit);
  ctx.fillStyle = skin.primary;
  ctx.strokeStyle = skin.accent;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'dot':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'ring':
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = skin.primary;
      ctx.arc(0, 0, r + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.rect(-r, -r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'diamond':
      ctx.moveTo(0, -r * 1.3);
      ctx.lineTo(r * 1.3, 0);
      ctx.lineTo(0, r * 1.3);
      ctx.lineTo(-r * 1.3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'triangle':
      ctx.moveTo(0, -r * 1.35);
      ctx.lineTo(r * 1.25, r * 0.85);
      ctx.lineTo(-r * 1.25, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'star':
      star(ctx, r * 1.5, r * 0.65, 5);
      ctx.fill();
      ctx.stroke();
      break;
    case 'cross': {
      const a = r * 1.4;
      const b = r * 0.45;
      ctx.moveTo(-b, -a);
      ctx.lineTo(b, -a);
      ctx.lineTo(b, -b);
      ctx.lineTo(a, -b);
      ctx.lineTo(a, b);
      ctx.lineTo(b, b);
      ctx.lineTo(b, a);
      ctx.lineTo(-b, a);
      ctx.lineTo(-b, b);
      ctx.lineTo(-a, b);
      ctx.lineTo(-a, -b);
      ctx.lineTo(-b, -b);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'arrow': {
      // Classic arrow pointer, tip on the cursor point
      const k = size / 8;
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 15 * k);
      ctx.lineTo(3.6 * k, 11.6 * k);
      ctx.lineTo(6.2 * k, 17 * k);
      ctx.lineTo(8.4 * k, 16 * k);
      ctx.lineTo(5.9 * k, 10.7 * k);
      ctx.lineTo(10.6 * k, 10.7 * k);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'sword': {
      // A sword held point-first: the tip is the cursor point, the blade runs down-right.
      // Blade in the primary color, guard and pommel in the accent.
      const k = size / 8;
      ctx.rotate(-Math.PI / 4);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(20,26,36,0.55)';
      // Blade: point, then straight edges to the guard
      ctx.moveTo(0, 0);
      ctx.lineTo(1.7 * k, 3.2 * k);
      ctx.lineTo(1.7 * k, 15 * k);
      ctx.lineTo(-1.7 * k, 15 * k);
      ctx.lineTo(-1.7 * k, 3.2 * k);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Fuller: a light line down the middle of the blade
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.moveTo(0, 3 * k);
      ctx.lineTo(0, 13.5 * k);
      ctx.stroke();
      // Guard, grip, pommel
      ctx.fillStyle = skin.accent;
      ctx.strokeStyle = 'rgba(20,26,36,0.55)';
      ctx.beginPath();
      ctx.roundRect(-5 * k, 15 * k, 10 * k, 1.8 * k, 0.8 * k);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = skin.primary;
      ctx.beginPath();
      ctx.rect(-0.9 * k, 16.8 * k, 1.8 * k, 4.4 * k);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.arc(0, 22.3 * k, 1.4 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Calls `fn` for each unbroken run of the trail (NaN entries break it at teleports) */
function eachRun(pts: readonly number[], fn: (from: number, to: number) => void): void {
  let start = -1;
  for (let i = 0; i <= pts.length; i += 2) {
    const gap = i === pts.length || Number.isNaN(pts[i]);
    if (gap) {
      if (start >= 0 && i - start >= 4) fn(start, i);
      start = -1;
    } else if (start < 0) start = i;
  }
}

/**
 * Tapered ribbon along one run of the trail: `width(k)` gives the full width at k (0 = tail,
 * 1 = head); `shift` moves its center line sideways by that fraction of the width.
 */
function taperedRibbon(path: Path2D, pts: readonly number[], from: number, to: number, minStep: number, width: (k: number) => number, shift = 0): void {
  // Drop points closer than minStep, so the normals stay stable
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = from; i < to; i += 2) {
    const n = xs.length;
    if (n && Math.hypot(pts[i] - xs[n - 1], pts[i + 1] - ys[n - 1]) < minStep && i < to - 2) continue;
    xs.push(pts[i]);
    ys.push(pts[i + 1]);
  }
  const n = xs.length;
  if (n < 2) return;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = xs[b] - xs[a];
    let dy = ys[b] - ys[a];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const w = width(i / (n - 1)) / 2;
    const cx = xs[i] - dy * w * 2 * shift;
    const cy = ys[i] + dx * w * 2 * shift;
    left.push(cx - dy * w, cy + dx * w);
    right.push(cx + dy * w, cy - dx * w);
  }
  path.moveTo(left[0], left[1]);
  for (let i = 2; i < left.length; i += 2) path.lineTo(left[i], left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) path.lineTo(right[i], right[i + 1]);
  path.closePath();
}

function tracePath(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  ctx.beginPath();
  eachRun(pts, (from, to) => {
    ctx.moveTo(pts[from], pts[from + 1]);
    for (let i = from + 2; i < to; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  });
}

/**
 * The cursor's trail (map units). `unit` is map units per screen pixel; the plain line keeps its
 * original map-unit width, the decorated styles scale with the screen like the pointer.
 */
export function drawSkinTrail(ctx: CanvasRenderingContext2D, skin: Skin, pts: readonly number[], unit: number): void {
  const style = trailStyle(skin);
  if (pts.length < 4 || style === 'none') return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const u = Math.max(unit, 1e-6);
  switch (style) {
    case 'line':
      ctx.strokeStyle = rgba(skin.primary, 0.75);
      ctx.lineWidth = 1.5;
      tracePath(ctx, pts);
      ctx.stroke();
      break;
    case 'glow':
      tracePath(ctx, pts);
      ctx.strokeStyle = rgba(skin.accent, 0.3);
      ctx.lineWidth = 7 * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(skin.primary, 0.9);
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      break;
    case 'dual':
      tracePath(ctx, pts);
      ctx.strokeStyle = rgba(skin.primary, 0.85);
      ctx.lineWidth = 4 * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(skin.accent, 0.95);
      ctx.lineWidth = 1.4 * u;
      ctx.stroke();
      break;
    case 'dashed':
      tracePath(ctx, pts);
      ctx.lineWidth = 2.5 * u;
      ctx.lineCap = 'butt';
      ctx.setLineDash([7 * u, 7 * u]);
      ctx.strokeStyle = rgba(skin.primary, 0.9);
      ctx.stroke();
      ctx.lineDashOffset = 7 * u;
      ctx.strokeStyle = rgba(skin.accent, 0.9);
      ctx.stroke();
      break;
    case 'dots': {
      // A dot every few pixels along the path, alternating colors
      const gap = 6 * u;
      const r = 1.6 * u;
      const paths = [new Path2D(), new Path2D()];
      let n = 0;
      eachRun(pts, (from, to) => {
        let left = 0;
        for (let i = from + 2; i < to; i += 2) {
          const x0 = pts[i - 2];
          const y0 = pts[i - 1];
          const dx = pts[i] - x0;
          const dy = pts[i + 1] - y0;
          const len = Math.hypot(dx, dy);
          let d = left;
          while (d <= len) {
            const x = x0 + (dx * d) / (len || 1);
            const y = y0 + (dy * d) / (len || 1);
            const p = paths[n++ % 2];
            p.moveTo(x + r, y);
            p.arc(x, y, r, 0, Math.PI * 2);
            d += gap;
          }
          left = d - len;
        }
      });
      ctx.fillStyle = rgba(skin.primary, 0.9);
      ctx.fill(paths[0]);
      ctx.fillStyle = rgba(skin.accent, 0.9);
      ctx.fill(paths[1]);
      break;
    }
    case 'fade': {
      // Tapers and fades toward the tail; the color blends smoothly from the accent at the tail
      // to the primary color at the head
      const total = pts.length / 2;
      const STEPS = 32;
      const per = Math.max(2, Math.ceil(total / STEPS));
      // Butt ends: neighboring pieces meet without overlapping, so the blend has no darker joins
      ctx.lineCap = 'butt';
      for (let s = 0; s < STEPS; s++) {
        const a = s * per * 2;
        const b = Math.min(pts.length, (s + 1) * per * 2 + 2);
        if (b - a < 4) continue;
        const k = (s + 1) / STEPS;
        tracePath(ctx, pts.slice(a, b));
        ctx.strokeStyle = mix(skin.accent, skin.primary, k, 0.15 + 0.75 * k);
        ctx.lineWidth = (0.6 + 3.4 * k) * u;
        ctx.stroke();
      }
      break;
    }
    case 'solidDashed':
      // Dashes in the primary color only, gaps left empty
      tracePath(ctx, pts);
      ctx.lineWidth = 2.5 * u;
      ctx.lineCap = 'butt';
      ctx.setLineDash([7 * u, 6 * u]);
      ctx.strokeStyle = rgba(skin.primary, 0.9);
      ctx.stroke();
      break;
    case 'stars': {
      // Small five-pointed stars along the path, alternating colors, growing toward the head
      const gap = 9 * u;
      const outer = 2.8 * u;
      const inner = outer * 0.45;
      const total = pts.length;
      const paths = [new Path2D(), new Path2D()];
      let n = 0;
      eachRun(pts, (from, to) => {
        let left = 0;
        for (let i = from + 2; i < to; i += 2) {
          const x0 = pts[i - 2];
          const y0 = pts[i - 1];
          const dx = pts[i] - x0;
          const dy = pts[i + 1] - y0;
          const len = Math.hypot(dx, dy);
          const s = 0.45 + 0.55 * (i / total);
          let d = left;
          while (d <= len) {
            const x = x0 + (dx * d) / (len || 1);
            const y = y0 + (dy * d) / (len || 1);
            const p = paths[n % 2];
            const turn = (n++ * 0.7) % (Math.PI * 2);
            for (let j = 0; j < 10; j++) {
              const r = (j % 2 ? inner : outer) * s;
              const a = turn - Math.PI / 2 + (j * Math.PI) / 5;
              if (j === 0) p.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
              else p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            }
            p.closePath();
            d += gap;
          }
          left = d - len;
        }
      });
      ctx.fillStyle = rgba(skin.primary, 0.9);
      ctx.fill(paths[0]);
      ctx.fillStyle = rgba(skin.accent, 0.9);
      ctx.fill(paths[1]);
      break;
    }
    case 'slash': {
      // A blade cut: hair-thin at both ends, widest just behind the cursor, with a bright edge
      // (accent) along one side
      const cut = new Path2D();
      const edge = new Path2D();
      const shape = (k: number) => Math.pow(Math.sin(Math.PI * Math.pow(k, 1.8)), 0.9);
      eachRun(pts, (from, to) => {
        taperedRibbon(cut, pts, from, to, 1.5 * u, (k) => 7 * u * shape(k));
        taperedRibbon(edge, pts, from, to, 1.5 * u, (k) => 2 * u * shape(k), 0.9);
      });
      ctx.fillStyle = rgba(skin.primary, 0.9);
      ctx.fill(cut);
      ctx.fillStyle = rgba(skin.accent, 0.95);
      ctx.fill(edge);
      break;
    }
  }
  ctx.restore();
}

// ───────────────────────── The player's skin (per browser) ─────────────────────────

const STORAGE_KEY = 'avoid-n-survive:skin';
/** Before skins, Options had a plain on/off trail toggle */
const LEGACY_OPTIONS_KEY = 'avoid-n-survive:options';
const listeners = new Set<(s: Readonly<Skin>) => void>();
/** Trail skin to restore when the Options trail toggle is turned back on */
let lastTrail = DEFAULT_SKIN.trail;

function validIndex(v: unknown, count: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < count;
}

function loadSkin(): Skin {
  const out: Skin = { ...DEFAULT_SKIN };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_OPTIONS_KEY) ?? '{}') as Record<string, unknown>;
      if (legacy.showTrail === false) out.trail = 0;
      return out;
    }
    const saved = JSON.parse(raw) as Record<string, unknown>;
    if (validIndex(saved.pointer, POINTER_SKINS.length)) out.pointer = saved.pointer;
    if (validIndex(saved.trail, TRAIL_SKINS.length)) out.trail = saved.trail;
    if (validIndex(saved.lastTrail, TRAIL_SKINS.length) && saved.lastTrail > 0) lastTrail = saved.lastTrail;
    if (isPaletteColor(saved.primary)) out.primary = saved.primary;
    if (isPaletteColor(saved.accent)) out.accent = saved.accent;
  } catch {
    /* storage unavailable or corrupted → defaults */
  }
  if (out.trail > 0) lastTrail = out.trail;
  return out;
}

/** The player's saved choice, which may include a reward skin they can't use right now */
const chosen: Skin = loadSkin();

/** Whether a pointer/trail skin may be used (reward skins need their achievement) */
let skinGate: (kind: 'pointer' | 'trail', n: number) => boolean = () => true;

export function skinAllowed(kind: 'pointer' | 'trail', n: number): boolean {
  return skinGate(kind, n);
}

/** Live skin (the choice, with locked skins replaced by the defaults); change it through setSkin / resetSkin */
export const skin: Readonly<Skin> = { ...chosen };

function applyGate(): void {
  Object.assign(skin as Skin, chosen);
  if (!skinGate('pointer', chosen.pointer)) (skin as Skin).pointer = DEFAULT_SKIN.pointer;
  if (!skinGate('trail', chosen.trail)) (skin as Skin).trail = DEFAULT_SKIN.trail;
}

/** Install the unlock check; call refreshSkinGate() whenever what it answers changes */
export function setSkinGate(fn: (kind: 'pointer' | 'trail', n: number) => boolean): void {
  skinGate = fn;
  refreshSkinGate();
}

export function refreshSkinGate(): void {
  const before = `${skin.pointer}/${skin.trail}`;
  applyGate();
  if (`${skin.pointer}/${skin.trail}` !== before) for (const fn of listeners) fn(skin);
}

function commitSkin(): void {
  if (chosen.trail > 0) lastTrail = chosen.trail;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...chosen, lastTrail }));
  } catch {
    /* ignore when storage is unavailable */
  }
  applyGate();
  for (const fn of listeners) fn(skin);
}

export function setSkin(patch: Partial<Skin>): void {
  if (validIndex(patch.pointer, POINTER_SKINS.length) && skinGate('pointer', patch.pointer)) chosen.pointer = patch.pointer;
  if (validIndex(patch.trail, TRAIL_SKINS.length) && skinGate('trail', patch.trail)) chosen.trail = patch.trail;
  if (isPaletteColor(patch.primary)) chosen.primary = patch.primary;
  if (isPaletteColor(patch.accent)) chosen.accent = patch.accent;
  commitSkin();
}

export function resetSkin(): void {
  Object.assign(chosen, DEFAULT_SKIN);
  commitSkin();
}

export function onSkinChange(fn: (s: Readonly<Skin>) => void): void {
  listeners.add(fn);
}
