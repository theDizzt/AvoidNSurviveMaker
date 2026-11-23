import { DEFAULT_BADGE, type BadgeAnim, type BadgeFont, type BadgePartId, type BadgeStyle, type BadgeTextFormat } from './localized/theme-pack';
import type { MapData } from '../core/types';
import { isLibraryFont } from './localized/font-catalog';
import { libraryFontCss } from './library-fonts';
import { animCycle, fillTextFx, FONT_MAIN, FONT_TIMER, FONT_TITLE, ZH_HANZI, type TextFx } from './render';
import { options } from './options';

/**
 * The in-game level badge at the top-left: the level number in a theme-specific design, with
 * the title (and an optional caption) beside it. Drawn in map units.
 *
 * A theme can place each part freely (style.badge.layout): the graphic (carrying the number),
 * the number inside it, and the title block, each moved, scaled and rotated around its own pivot.
 */

const BASE: Record<string, string> = {
  title: FONT_TITLE,
  main: FONT_MAIN,
  serif: `${ZH_HANZI}Georgia, 'Times New Roman', serif`,
  heavy: `${ZH_HANZI}'Arial Black', Impact, 'Segoe UI Black', sans-serif`,
  timer: FONT_TIMER,
};

/** Base fonts by name; library fonts (bundled files) by id */
const FONTS = new Proxy(BASE, {
  get: (base, k: string) => base[k] ?? (isLibraryFont(k) ? libraryFontCss(k) : FONT_TITLE),
}) as Record<BadgeFont, string>;

/** CSS font-family of a badge font (library fonts start loading on first use) */
export function badgeFontCss(font: BadgeFont): string {
  return FONTS[font];
}

const images = new Map<string, HTMLImageElement>();

/** Image for a URL, loading it the first time (drawn once it has loaded) */
export function badgeImage(url: string | undefined): HTMLImageElement | null {
  if (!url) return null;
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** The badge's own title font, or `fallback` (each design's default) when it has none */
function titleFontCss(b: BadgeStyle, fallback: string): string {
  return b.titleFont ? FONTS[b.titleFont] : fallback;
}

function numberText(map: MapData, b: BadgeStyle): string {
  const n = String(map.level ?? '');
  return b.pad > 0 ? n.padStart(b.pad, '0') : n;
}

/** A font string with the theme's lettering (weight, italic) over the design's own */
function fontOf(fmt: BadgeTextFormat | undefined, weight: number, size: number, family: string, italic = false): string {
  return `${fmt?.italic ?? italic ? 'italic ' : ''}${fmt?.weight ?? weight} ${size}px ${family}`;
}

function cased(text: string, fmt: BadgeTextFormat | undefined): string {
  return fmt?.transform === 'upper' ? text.toUpperCase() : fmt?.transform === 'lower' ? text.toLowerCase() : text;
}

/** Letter spacing (part of the canvas state, so save/restore undo it) */
function spaced(ctx: CanvasRenderingContext2D, spacing: number | undefined): void {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing ?? 0}px`;
}

interface Box { x: number; y: number; w: number; h: number }

/** Time of the badge being drawn (animations) */
let frameNow = 0;

/** -1 … 1 over each cycle */
function swing(a: BadgeAnim): number {
  return Math.sin((frameNow / 1000) * a.speed * Math.PI * 2);
}

/** Mix of two colors (#rrggbb or #rrggbbaa), k = 0 → a, 1 → b */
function mixColor(a: string, b: string, k: number): string {
  const parse = (h: string) => [1, 3, 5, 7].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
  const pa = parse(a), pb = parse(b);
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0'));
  return `#${out[0]}${out[1]}${out[2]}${out[3] === 'ff' ? '' : out[3]}`;
}

/** The style with this frame's color fades applied */
function animatedColors(b: BadgeStyle): BadgeStyle {
  const a = b.anim;
  if (!a) return b;
  const fade = (c: string, an: BadgeAnim | undefined) => (an?.type === 'color' && an.color ? mixColor(c, an.color, animCycle(frameNow, Math.abs(an.speed)) * an.amount) : c);
  return { ...b, primary: fade(b.primary, a.graphic), numberColor: fade(b.numberColor, a.number), titleColor: fade(b.titleColor, a.title) };
}

/** A part's motion, applied around its pivot (already translated there) */
function applyMotion(ctx: CanvasRenderingContext2D, a: BadgeAnim): void {
  switch (a.type) {
    case 'spin':
      ctx.rotate((frameNow / 1000) * a.speed * Math.PI * 2);
      break;
    case 'sway':
      ctx.rotate(swing(a) * a.amount * 0.35);
      break;
    case 'bob':
      ctx.translate(0, swing(a) * a.amount * 8);
      break;
    case 'pulse': {
      const s = 1 + swing(a) * a.amount * 0.18;
      ctx.scale(s, s);
      break;
    }
    case 'blink':
      ctx.globalAlpha *= 1 - a.amount * animCycle(frameNow, Math.abs(a.speed));
      break;
  }
}

/**
 * Text with its effects, the letters bobbing one after another (a 'wave' animation); keeps the
 * current textAlign. textBaseline must be 'middle'.
 */
function waveText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fx: TextFx, a: BadgeAnim): void {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const w = widths.reduce((s, v) => s + v, 0);
  const align = ctx.textAlign;
  let cx = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
  ctx.save();
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    const dy = Math.sin((frameNow / 1000) * a.speed * Math.PI * 2 - i * 0.55) * a.amount * size * 0.25;
    fillTextFx(ctx, c, cx, y + dy, size, fx);
    cx += widths[i];
  });
  ctx.restore();
}

/** Where a badge part was drawn this frame, in map units (the theme editor picks and drags them) */
export interface BadgeHit {
  part: BadgePartId;
  /** Corners of the part's box */
  poly: { x: number; y: number }[];
  /** The point it moves, scales and rotates around */
  pivot: { x: number; y: number };
  /** Linear map from the part's offset (x, y) to map units: [a, b, c, d] */
  frame: [number, number, number, number];
}

/** One badge drawing: the style, the transform it started from, and where the parts landed */
class Rec {
  readonly hits: BadgeHit[] = [];
  private readonly inv: DOMMatrix;
  /** Offset the title shares with the graphic (it moves along with the badge) */
  follow = { x: 0, y: 0 };
  /**
   * While drawing the graphic: the alpha its number is drawn at (the graphic may be hidden or
   * blinking), and the transform that undoes the graphic's animation for it — the number sits on
   * the badge but moves only with its own animation.
   */
  private numberAlpha: number | null = null;
  private unAnim: DOMMatrix | null = null;
  constructor(readonly ctx: CanvasRenderingContext2D, readonly b: BadgeStyle) {
    this.inv = ctx.getTransform().inverse();
  }

  /** Current drawing frame → map units */
  private local(): DOMMatrix {
    return this.inv.multiply(this.ctx.getTransform());
  }

  /** Draw part `id` placed around its pivot (ax, ay); `draw` works in unplaced coords and returns its box */
  part(id: BadgePartId, ax: number, ay: number, draw: () => Box | null): void {
    const p = this.b.layout?.[id];
    const ctx = this.ctx;
    // A hidden graphic still carries (and moves) its number
    if (p?.hidden && id !== 'graphic') return;
    const extra = id === 'title' ? this.follow : { x: 0, y: 0 };
    ctx.save();
    if (id === 'number') {
      if (this.unAnim) ctx.setTransform(this.unAnim.multiply(ctx.getTransform()));
      if (this.numberAlpha !== null) ctx.globalAlpha = this.numberAlpha;
    }
    const parent = this.local();
    const px = ax + (p?.x ?? 0) + extra.x;
    const py = ay + (p?.y ?? 0) + extra.y;
    ctx.translate(px, py);
    if (p?.rotate) ctx.rotate((p.rotate * Math.PI) / 180);
    if (p?.scale && p.scale !== 1) ctx.scale(p.scale, p.scale);
    const anim = this.b.anim?.[id];
    const still = ctx.getTransform();
    const alpha = ctx.globalAlpha;
    if (anim) applyMotion(ctx, anim);
    const isGraphic = id === 'graphic';
    if (isGraphic) {
      this.unAnim = anim ? still.multiply(ctx.getTransform().inverse()) : null;
      this.numberAlpha = anim || p?.hidden ? alpha : null;
      // A hidden graphic is drawn invisibly: it still carries (and places) its number
      if (p?.hidden) ctx.globalAlpha = 0;
    }
    ctx.translate(-ax, -ay);
    const box = draw();
    if (isGraphic) {
      this.unAnim = null;
      this.numberAlpha = null;
    }
    if (box) {
      const m = this.local();
      const pt = (x: number, y: number) => {
        const q = m.transformPoint({ x, y });
        return { x: q.x, y: q.y };
      };
      const piv = parent.transformPoint({ x: px, y: py });
      this.hits.push({
        part: id,
        poly: [pt(box.x, box.y), pt(box.x + box.w, box.y), pt(box.x + box.w, box.y + box.h), pt(box.x, box.y + box.h)],
        pivot: { x: piv.x, y: piv.y },
        frame: [parent.a, parent.b, parent.c, parent.d],
      });
    }
    ctx.restore();
  }
}

/** The level number with an outline, fit to `maxW`, as the 'number' part */
function bigNumber(r: Rec, text: string, x: number, y: number, size: number, maxW: number, opts: { italic?: boolean; outline?: string; align?: CanvasTextAlign } = {}): void {
  if (!text) return;
  const { ctx, b } = r;
  const fmt = b.numberFormat;
  const shown = cased(text, fmt);
  r.part('number', x, y, () => {
    spaced(ctx, fmt?.spacing);
    let s = size;
    ctx.font = fontOf(fmt, 900, s, FONTS[b.font], opts.italic);
    while (ctx.measureText(shown).width > maxW && s > 10) {
      s -= 2;
      ctx.font = fontOf(fmt, 900, s, FONTS[b.font], opts.italic);
    }
    const align = opts.align ?? 'center';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    // The theme's own effects; its outline replaces the design's
    const fx = b.numberFx;
    const style: TextFx = {
      ...fx,
      color: b.numberColor,
      outline: fx?.outline ?? opts.outline,
      outlineWidth: fx?.outline ? fx.outlineWidth : Math.max(3, s * 0.12) / 2,
    };
    const wave = b.anim?.number;
    if (wave?.type === 'wave') waveText(ctx, shown, x, y, s, style, wave);
    else fillTextFx(ctx, shown, x, y, s, style);
    const w = ctx.measureText(shown).width;
    return { x: align === 'left' ? x : align === 'right' ? x - w : x - w / 2, y: y - s * 0.55, w, h: s * 1.1 };
  });
}

/** The level title as shown ('' when hidden) */
function titleOf(map: MapData, b: BadgeStyle): string {
  return b.showTitle ? cased(map.title ?? map.name, b.titleFormat) : '';
}

/** A level title line with the theme's title effects (textBaseline must be 'middle') */
function titleText(ctx: CanvasRenderingContext2D, b: BadgeStyle, text: string, x: number, y: number, size: number, maxWidth?: number): void {
  const wave = b.anim?.title;
  if (wave?.type === 'wave') waveText(ctx, text, x, y, size, { ...b.titleFx, color: b.titleColor }, wave);
  else fillTextFx(ctx, text, x, y, size, { ...b.titleFx, color: b.titleColor }, maxWidth);
}

interface TitleSizes { title: number; caption: number; weight: number }
const TITLE_SIZES: TitleSizes = { title: 22, caption: 12, weight: 700 };

/**
 * Caption + title starting at x, centered on cy, as the 'title' part. `plate` is the design's
 * default for a soft plate behind it (in `plateColor`, or translucent dark) so it reads on any map.
 */
function titleBlock(r: Rec, map: MapData, b: BadgeStyle, x: number, cy: number, plate: boolean, plateColor?: string, sizes = TITLE_SIZES): void {
  const title = titleOf(map, b);
  const cap = b.caption ?? '';
  if (!title && !cap) return;
  const ctx = r.ctx;
  const fmt = b.titleFormat;
  const family = titleFontCss(b, FONTS[b.font === 'timer' ? 'title' : b.font]);
  r.part('title', x, cy, () => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${sizes.caption}px ${FONT_MAIN}`;
    const cw = cap ? ctx.measureText(cap).width : 0;
    spaced(ctx, fmt?.spacing);
    ctx.font = fontOf(fmt, sizes.weight, sizes.title, family);
    const tw = title ? ctx.measureText(title).width : 0;
    const w = Math.max(tw, cw) + 20;
    const h = Math.max(44, sizes.title + (cap ? sizes.caption + 10 : 16));
    const box = { x: x - 8, y: cy - h / 2, w, h };
    if (b.titlePlate ?? plate) {
      ctx.save();
      ctx.fillStyle = plateColor ?? 'rgba(20,24,40,0.45)';
      if (plateColor) ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, 10);
      ctx.fill();
      ctx.restore();
    }
    if (cap) {
      ctx.save();
      spaced(ctx, 0);
      ctx.fillStyle = b.titleColor;
      ctx.globalAlpha = 0.85;
      ctx.font = `600 ${sizes.caption}px ${FONT_MAIN}`;
      ctx.fillText(cap, x + 2, cy - (title ? sizes.title / 2 : 0));
      ctx.restore();
    }
    if (title) titleText(ctx, b, title, x + 2, cy + (cap ? sizes.caption * 0.7 : 0), sizes.title);
    return box;
  });
}

function snowflake(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const ex = cx + Math.cos(a) * r;
    const ey = cy + Math.sin(a) * r;
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    for (const f of [0.45, 0.72]) {
      const bx = cx + Math.cos(a) * r * f;
      const by = cy + Math.sin(a) * r * f;
      for (const s of [-1, 1]) {
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + s * 0.8) * r * 0.25, by + Math.sin(a + s * 0.8) * r * 0.25);
      }
    }
  }
  ctx.stroke();
}

/** Lit segments of each character a seven-segment readout can show (a top, b/c right, d bottom, e/f left, g middle) */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

/** #rrggbb darkened (k < 0, toward black) or lightened (k > 0, toward white) */
function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const to = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - a) + to * a).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/**
 * One seven-segment digit in a w×h box (top-left x, y), slanted a little like an LCD: the lit
 * segments in `color` with a soft glow, the others faintly showing through the glass.
 */
function sevenSegment(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, color: string): void {
  const lit = SEGMENTS[ch] ?? '';
  const t = Math.max(2, w * 0.2); // segment thickness
  const half = h / 2;
  const seg = (id: string): Path2D => {
    const p = new Path2D();
    // Horizontal (a, g, d) or vertical (b, c, e, f) bar with pointed ends
    const horiz = (cy: number) => {
      p.moveTo(x + t * 0.5, cy);
      p.lineTo(x + t, cy - t / 2);
      p.lineTo(x + w - t, cy - t / 2);
      p.lineTo(x + w - t * 0.5, cy);
      p.lineTo(x + w - t, cy + t / 2);
      p.lineTo(x + t, cy + t / 2);
      p.closePath();
    };
    const vert = (cx: number, top: number) => {
      p.moveTo(cx, top + t * 0.5);
      p.lineTo(cx + t / 2, top + t);
      p.lineTo(cx + t / 2, top + half - t);
      p.lineTo(cx, top + half - t * 0.5);
      p.lineTo(cx - t / 2, top + half - t);
      p.lineTo(cx - t / 2, top + t);
      p.closePath();
    };
    if (id === 'a') horiz(y + t / 2);
    else if (id === 'g') horiz(y + half);
    else if (id === 'd') horiz(y + h - t / 2);
    else if (id === 'b') vert(x + w - t / 2, y);
    else if (id === 'c') vert(x + w - t / 2, y + half);
    else if (id === 'e') vert(x + t / 2, y + half);
    else vert(x + t / 2, y);
    return p;
  };
  ctx.save();
  // A slight forward slant, about the digit's middle
  ctx.translate(x + w / 2, y + half);
  ctx.transform(1, 0, -0.1, 1, 0, 0);
  ctx.translate(-(x + w / 2), -(y + half));
  for (const id of 'abcdefg') {
    const p = seg(id);
    if (!lit.includes(id)) {
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = color;
      ctx.fill(p);
      continue;
    }
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke(p);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fill(p);
  }
  ctx.restore();
}

function gear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number): void {
  ctx.beginPath();
  for (let k = 0; k < teeth * 2; k++) {
    const a0 = (k * Math.PI) / teeth;
    const a1 = ((k + 1) * Math.PI) / teeth;
    const rr = k % 2 ? r * 0.84 : r;
    ctx.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
    ctx.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr);
  }
  ctx.closePath();
}

/**
 * Draw the badge; returns the y below it (where the next top-left item goes). `hits` receives
 * where each part landed.
 */
/**
 * Fill a shape with a crisp drop shadow 2 px below it: the shape traced once in the shadow color,
 * shifted, then once in its color. No canvas shadow: the badge is drawn every frame, and shadows
 * (blurred or not) are the costliest canvas drawing without a fast GPU.
 */
function dropFill(ctx: CanvasRenderingContext2D, trace: () => void, fill: string | CanvasGradient | CanvasPattern, shadow: string): void {
  if (options.shadows) {
    ctx.save();
    ctx.translate(0, 2);
    trace();
    ctx.fillStyle = shadow;
    ctx.fill();
    ctx.restore();
  }
  trace();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawLevelBadge(ctx: CanvasRenderingContext2D, map: MapData, style: BadgeStyle | undefined, image: HTMLImageElement | null, now: number, hits?: BadgeHit[]): number {
  frameNow = now;
  const b = animatedColors(style ?? DEFAULT_BADGE);
  if (map.level === undefined && !map.title) return 12;
  const num = numberText(map, b);
  ctx.save();
  ctx.shadowColor = 'transparent';
  const r = new Rec(ctx, b);
  const g = b.layout?.graphic;
  // The title moves along with the badge graphic
  r.follow = { x: g?.x ?? 0, y: g?.y ?? 0 };
  let bottom = 70;

  switch (b.kind) {
    case 'disc': {
      // Vinyl record with a tone arm, the number on the label
      const cx = 52;
      const cy = 52;
      const rad = 40;
      r.part('graphic', cx, cy, () => {
        dropFill(ctx, () => {
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        }, b.primary, 'rgba(0,0,0,0.3)');
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        for (let k = 14; k < rad - 2; k += 4) {
          ctx.beginPath();
          ctx.arc(cx, cy, k, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Sheen that turns slowly
        const a = (now / 1500) % (Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, rad - 8, a, a + 0.6);
        ctx.stroke();
        ctx.fillStyle = b.secondary;
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c9ced8';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + rad + 6, 10);
        ctx.lineTo(cx + rad - 4, cy - 6);
        ctx.lineTo(cx + 16, cy + 10);
        ctx.stroke();
        bigNumber(r, num, cx, cy + 2, 44, rad * 1.7, { italic: true, outline: b.secondary });
        return { x: cx - rad, y: 8, w: rad * 2 + 10, h: cy + rad - 8 };
      });
      titleBlock(r, map, b, cx + rad + 18, cy, false);
      bottom = cy + rad + 10;
      break;
    }
    case 'emblem': {
      // Faint emblem (snowflake) behind a large number, caption below
      const cx = 56;
      const cy = 48;
      r.part('graphic', cx, cy, () => {
        ctx.save();
        ctx.strokeStyle = b.primary;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        snowflake(ctx, cx, cy, 40);
        ctx.restore();
        bigNumber(r, num, cx, cy, 54, 90, { outline: b.secondary });
        if (b.caption) {
          ctx.fillStyle = b.titleColor;
          ctx.font = `700 14px ${FONT_MAIN}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.caption, cx, cy + 46);
        }
        return { x: cx - 44, y: cy - 44, w: 88, h: b.caption ? 100 : 88 };
      });
      titleBlock(r, map, { ...b, caption: undefined }, cx + 52, cy, true);
      bottom = cy + 60;
      break;
    }
    case 'plate': {
      // Gear with a tilted plate across it
      const cx = 52;
      const cy = 50;
      r.part('graphic', cx, cy, () => {
        dropFill(ctx, () => gear(ctx, cx, cy, 40, 12), b.primary, 'rgba(0,0,0,0.3)');
        ctx.save();
        ctx.fillStyle = b.secondary;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.28);
        ctx.fillStyle = b.secondary;
        ctx.strokeStyle = '#1b0f05';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-48, -14, 96, 28, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = b.primary;
        for (const x of [-38, 38]) {
          ctx.beginPath();
          ctx.arc(x, 0, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        bigNumber(r, num, 0, 1, 26, 58, { italic: true });
        ctx.restore();
        return { x: cx - 48, y: cy - 42, w: 96, h: 84 };
      });
      titleBlock(r, map, b, cx + 54, cy, true);
      bottom = cy + 50;
      break;
    }
    case 'slant': {
      // A diagonal band across the corner, the number standing on it
      const w = 250;
      r.part('graphic', w / 2, 63, () => {
        ctx.save();
        ctx.fillStyle = b.secondary;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w, 0);
        ctx.lineTo(w, 30);
        ctx.lineTo(0, 92);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = b.primary;
        ctx.beginPath();
        ctx.moveTo(0, 92);
        ctx.lineTo(w, 30);
        ctx.lineTo(w, 64);
        ctx.lineTo(0, 126);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.translate(18, 62);
        ctx.rotate(-0.24);
        bigNumber(r, num, 0, 0, 58, 130, { italic: true, align: 'left' });
        ctx.restore();
        return { x: 0, y: 0, w, h: 126 };
      });
      const title = titleOf(map, b);
      if (title) {
        const fmt = b.titleFormat;
        // Drawn in the band's slanted frame; the part pivots on the title's start
        r.part('title', 110, 76, () => {
          ctx.save();
          ctx.translate(110, 76);
          ctx.rotate(-0.24);
          spaced(ctx, fmt?.spacing);
          ctx.font = fontOf(fmt, 800, 17, titleFontCss(b, FONTS[b.font]));
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const tw = Math.min(140, ctx.measureText(title).width);
          if (b.titlePlate) {
            ctx.save();
            ctx.fillStyle = 'rgba(20,24,40,0.45)';
            ctx.beginPath();
            ctx.roundRect(-8, -16, tw + 16, 32, 8);
            ctx.fill();
            ctx.restore();
          }
          titleText(ctx, b, title, 0, 0, 17, 140);
          ctx.restore();
          // Its box, unrotated around the pivot
          const c = Math.cos(-0.24), s = Math.sin(-0.24);
          const pts = [[0, -11], [tw, -11], [tw, 11], [0, 11]].map(([qx, qy]) => ({ x: 110 + qx * c - qy * s, y: 76 + qx * s + qy * c }));
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        });
      }
      bottom = 130;
      break;
    }
    case 'ring': {
      // A wood slice: growth rings and bark
      const cx = 52;
      const cy = 52;
      const rad = 40;
      r.part('graphic', cx, cy, () => {
        dropFill(ctx, () => {
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        }, b.secondary, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = b.primary;
        ctx.beginPath();
        ctx.arc(cx, cy, rad - 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = b.secondary;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.2;
        for (let k = 6; k < rad - 6; k += 5) {
          ctx.beginPath();
          for (let s = 0; s <= 36; s++) {
            const a = (s / 36) * Math.PI * 2;
            const rr = k + Math.sin(a * 3 + k) * 1.2;
            ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        ctx.restore();
        bigNumber(r, num, cx, cy + 2, 40, 64, { italic: true });
        return { x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 };
      });
      titleBlock(r, map, b, cx + rad + 14, cy, true);
      bottom = cy + rad + 10;
      break;
    }
    case 'lcd': {
      // A green LCD readout in a metal bezel: seven-segment digits with the unlit segments
      // faintly showing, scanlines and a glass sheen
      const digits = num.length || 1;
      const cellW = 28;
      const sw = digits * cellW + 22;
      const x0 = 8;
      const y0 = 12;
      const sh = 64;
      const cy = y0 + sh / 2;
      r.part('graphic', x0 + sw / 2, cy, () => {
        // Bezel with four screws
        dropFill(ctx, () => {
          ctx.beginPath();
          ctx.roundRect(x0 - 6, y0 - 6, sw + 12, sh + 12, 9);
        }, b.secondary, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x0 - 3, y0 - 4, sw + 6, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (const [sx, sy] of [[x0 - 1, y0 - 1], [x0 + sw + 1, y0 - 1], [x0 - 1, y0 + sh + 1], [x0 + sw + 1, y0 + sh + 1]]) {
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        // Screen
        const screen = ctx.createLinearGradient(0, y0, 0, y0 + sh);
        screen.addColorStop(0, b.primary);
        screen.addColorStop(1, shadeHex(b.primary, -0.35));
        ctx.fillStyle = screen;
        ctx.beginPath();
        ctx.roundRect(x0, y0, sw, sh, 4);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let y = y0 + 1; y < y0 + sh; y += 3) ctx.fillRect(x0, y, sw, 1);
        ctx.restore();
        return { x: x0 - 6, y: y0 - 6, w: sw + 12, h: sh + 12 };
      });
      if (/^[0-9 -]+$/.test(num)) {
        r.part('number', x0 + sw / 2, cy, () => {
          const dw = 20;
          const dh = 42;
          const left = x0 + 11 + (cellW - dw) / 2;
          for (let k = 0; k < num.length; k++) sevenSegment(ctx, num[k], left + k * cellW, cy - dh / 2, dw, dh, b.numberColor);
          return { x: x0 + 6, y: cy - dh / 2 - 2, w: sw - 12, h: dh + 4 };
        });
      } else bigNumber(r, num, x0 + sw / 2, cy, 40, sw - 12);
      // Glass sheen over the readout
      ctx.save();
      const sheen = ctx.createLinearGradient(x0, y0, x0 + sw * 0.6, y0 + sh);
      sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
      sheen.addColorStop(0.45, 'rgba(255,255,255,0.03)');
      sheen.addColorStop(0.46, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.roundRect(x0, y0, sw, sh, 4);
      ctx.fill();
      ctx.restore();
      titleBlock(r, map, b, x0 + sw + 20, cy, true);
      bottom = y0 + sh + 16;
      break;
    }
    case 'image': {
      const cx = 52;
      const cy = 52;
      r.part('graphic', cx, cy, () => {
        if (image) ctx.drawImage(image, cx - 44, cy - 44, 88, 88);
        else {
          ctx.fillStyle = b.primary;
          ctx.beginPath();
          ctx.roundRect(cx - 40, cy - 40, 80, 80, 16);
          ctx.fill();
        }
        bigNumber(r, num, cx, cy, 44, 76, { outline: b.secondary });
        return { x: cx - 44, y: cy - 44, w: 88, h: 88 };
      });
      titleBlock(r, map, b, cx + 54, cy, true);
      bottom = cy + 50;
      break;
    }
    default: {
      // pill: a rounded plate, the number large and the title beside it. Once the title is
      // placed on its own (or the plate turned, resized or hidden) it gets a plate of its own.
      const inPlate = !b.layout?.title && !g?.rotate && (g?.scale ?? 1) === 1 && !g?.hidden;
      const title = inPlate ? titleOf(map, b) : '';
      const cap = inPlate ? b.caption ?? '' : '';
      ctx.save();
      spaced(ctx, b.numberFormat?.spacing);
      ctx.font = fontOf(b.numberFormat, 900, 40, FONTS[b.font]);
      const nw = num ? Math.min(120, ctx.measureText(cased(num, b.numberFormat)).width) : 0;
      spaced(ctx, b.titleFormat?.spacing);
      ctx.font = fontOf(b.titleFormat, 600, 15, titleFontCss(b, FONT_MAIN));
      const tw = title ? ctx.measureText(title).width : 0;
      spaced(ctx, 0);
      ctx.font = `600 11px ${FONT_MAIN}`;
      const capW = cap ? ctx.measureText(cap).width : 0;
      ctx.restore();
      const gap = num && (title || cap) ? 10 : 0;
      const w = 32 + nw + gap + Math.max(tw, capW);
      const h = num ? 52 : 32;
      const base = 12 + h / 2;
      const tx = 28 + nw + gap;
      r.part('graphic', 12 + w / 2, base, () => {
        ctx.save();
        ctx.fillStyle = b.primary;
        ctx.globalAlpha = 0.9;
        dropFill(ctx, () => {
          ctx.beginPath();
          ctx.roundRect(12, 12, w, h, 14);
        }, ctx.fillStyle, 'rgba(58,96,150,0.2)');
        ctx.restore();
        if (num) bigNumber(r, num, 28, base + 2, 40, 120, { align: 'left' });
        return { x: 12, y: 12, w, h };
      });
      if (inPlate) {
        // Caption and title inside the plate (moving with it, like any title)
        r.part('title', tx, base, () => {
          if (!title && !cap) return null;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          if (cap) {
            ctx.save();
            ctx.fillStyle = b.titleColor;
            ctx.globalAlpha = 0.7;
            ctx.font = `600 11px ${FONT_MAIN}`;
            ctx.fillText(cap, tx, base - 9);
            ctx.restore();
          }
          if (title) {
            spaced(ctx, b.titleFormat?.spacing);
            ctx.font = fontOf(b.titleFormat, 600, 15, titleFontCss(b, FONT_MAIN));
            titleText(ctx, b, title, tx, base + (cap ? 7 : 2), 15);
          }
          return { x: tx - 4, y: base - 18, w: Math.max(tw, capW) + 8, h: 36 };
        });
      } else titleBlock(r, map, b, tx, base, !g?.hidden, b.primary, { title: 15, caption: 11, weight: 600 });
      bottom = 12 + h;
    }
  }
  ctx.restore();
  if (hits) hits.push(...r.hits);
  // Placed parts may reach lower than the design's own spot
  if (b.layout) for (const hit of r.hits) for (const p of hit.poly) bottom = Math.max(bottom, p.y);
  return bottom + 8;
}
