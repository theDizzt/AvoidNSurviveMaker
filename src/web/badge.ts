import { DEFAULT_BADGE, type BadgeFont, type BadgeStyle } from '../core/theme-pack';
import type { MapData } from '../core/types';
import { isLibraryFont } from '../core/font-catalog';
import { libraryFontCss } from './library-fonts';
import { FONT_MAIN, FONT_TIMER, FONT_TITLE } from './render';

/**
 * The in-game level badge at the top-left: the level number in a theme-specific design, with
 * the title (and an optional caption) beside it. Drawn in map units.
 */

const BASE: Record<string, string> = {
  title: FONT_TITLE,
  main: FONT_MAIN,
  serif: "Georgia, 'Times New Roman', serif",
  heavy: "'Arial Black', Impact, 'Segoe UI Black', sans-serif",
  timer: FONT_TIMER,
};

/** Base fonts by name; library fonts (bundled files) by id */
const FONTS = new Proxy(BASE, {
  get: (base, k: string) => base[k] ?? (isLibraryFont(k) ? libraryFontCss(k) : FONT_TITLE),
}) as Record<BadgeFont, string>;

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

function numberText(map: MapData, b: BadgeStyle): string {
  const n = String(map.level ?? '');
  return b.pad > 0 ? n.padStart(b.pad, '0') : n;
}

/** Number with an outline, fit to `maxW` */
function bigNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, b: BadgeStyle, maxW: number, opts: { italic?: boolean; outline?: string; align?: CanvasTextAlign } = {}): void {
  let s = size;
  ctx.font = `${opts.italic ? 'italic ' : ''}900 ${s}px ${FONTS[b.font]}`;
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 2;
    ctx.font = `${opts.italic ? 'italic ' : ''}900 ${s}px ${FONTS[b.font]}`;
  }
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (opts.outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, s * 0.12);
    ctx.strokeStyle = opts.outline;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = b.numberColor;
  ctx.fillText(text, x, y);
}

/** Caption + title to the right of the badge graphic, on a soft plate so it reads on any map */
function titleBlock(ctx: CanvasRenderingContext2D, map: MapData, b: BadgeStyle, x: number, cy: number, plate: boolean): number {
  const title = b.showTitle ? map.title ?? map.name : '';
  const cap = b.caption ?? '';
  if (!title && !cap) return x;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 22px ${FONTS[b.font === 'timer' ? 'title' : b.font]}`;
  const tw = title ? ctx.measureText(title).width : 0;
  ctx.font = `600 12px ${FONT_MAIN}`;
  const cw = cap ? ctx.measureText(cap).width : 0;
  const w = Math.max(tw, cw) + 20;
  if (plate) {
    ctx.fillStyle = 'rgba(20,24,40,0.45)';
    ctx.beginPath();
    ctx.roundRect(x - 8, cy - 22, w, 44, 10);
    ctx.fill();
  }
  if (cap) {
    ctx.fillStyle = b.titleColor;
    ctx.globalAlpha = 0.85;
    ctx.font = `600 12px ${FONT_MAIN}`;
    ctx.fillText(cap, x + 2, cy - (title ? 11 : 0));
    ctx.globalAlpha = 1;
  }
  if (title) {
    ctx.fillStyle = b.titleColor;
    ctx.font = `700 22px ${FONTS[b.font === 'timer' ? 'title' : b.font]}`;
    ctx.fillText(title, x + 2, cy + (cap ? 8 : 0));
  }
  return x + w;
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

/** Draw the badge; returns the y below it (where the next top-left item goes) */
export function drawLevelBadge(ctx: CanvasRenderingContext2D, map: MapData, style: BadgeStyle | undefined, image: HTMLImageElement | null, now: number): number {
  const b = style ?? DEFAULT_BADGE;
  if (map.level === undefined && !map.title) return 12;
  const num = numberText(map, b);
  ctx.save();
  ctx.shadowColor = 'transparent';
  let bottom = 70;

  switch (b.kind) {
    case 'disc': {
      // Vinyl record with a tone arm, the number on the label
      const cx = 52;
      const cy = 52;
      const r = 40;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = b.primary;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      for (let k = 14; k < r - 2; k += 4) {
        ctx.beginPath();
        ctx.arc(cx, cy, k, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Sheen that turns slowly
      const a = (now / 1500) % (Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 8, a, a + 0.6);
      ctx.stroke();
      ctx.fillStyle = b.secondary;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c9ced8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + r + 6, 10);
      ctx.lineTo(cx + r - 4, cy - 6);
      ctx.lineTo(cx + 16, cy + 10);
      ctx.stroke();
      bigNumber(ctx, num, cx, cy + 2, 44, b, r * 1.7, { italic: true, outline: b.secondary });
      titleBlock(ctx, map, b, cx + r + 18, cy, false);
      bottom = cy + r + 10;
      break;
    }
    case 'emblem': {
      // Faint emblem (snowflake) behind a large number, caption below
      const cx = 56;
      const cy = 48;
      ctx.strokeStyle = b.primary;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      snowflake(ctx, cx, cy, 40);
      ctx.globalAlpha = 1;
      const grad = ctx.createLinearGradient(0, cy - 30, 0, cy + 30);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, b.numberColor);
      ctx.save();
      ctx.shadowColor = b.secondary;
      ctx.shadowBlur = 6;
      bigNumber(ctx, num, cx, cy, 54, { ...b, numberColor: b.numberColor }, 90, { outline: b.secondary });
      ctx.restore();
      if (b.caption) {
        ctx.fillStyle = b.titleColor;
        ctx.font = `700 14px ${FONT_MAIN}`;
        ctx.textAlign = 'center';
        ctx.fillText(b.caption, cx, cy + 46);
      }
      titleBlock(ctx, map, { ...b, caption: undefined }, cx + 52, cy, true);
      bottom = cy + 60;
      break;
    }
    case 'plate': {
      // Gear with a tilted plate across it
      const cx = 52;
      const cy = 50;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = b.primary;
      gear(ctx, cx, cy, 40, 12);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = b.secondary;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
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
      bigNumber(ctx, num, 0, 1, 26, b, 58, { italic: true });
      ctx.restore();
      titleBlock(ctx, map, b, cx + 54, cy, true);
      bottom = cy + 50;
      break;
    }
    case 'slant': {
      // A diagonal band across the corner, the number standing on it
      const w = 250;
      ctx.fillStyle = b.secondary;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, 30);
      ctx.lineTo(0, 92);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
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
      bigNumber(ctx, num, 0, 0, 58, b, 130, { italic: true, align: 'left' });
      ctx.restore();
      if (b.showTitle) {
        ctx.save();
        ctx.translate(110, 76);
        ctx.rotate(-0.24);
        ctx.fillStyle = b.titleColor;
        ctx.font = `800 17px ${FONTS[b.font]}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(map.title ?? map.name, 0, 0, 140);
        ctx.restore();
      }
      bottom = 130;
      break;
    }
    case 'ring': {
      // A wood slice: growth rings and bark
      const cx = 52;
      const cy = 52;
      const r = 40;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = b.secondary;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = b.primary;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b.secondary;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.2;
      for (let k = 6; k < r - 6; k += 5) {
        ctx.beginPath();
        for (let s = 0; s <= 36; s++) {
          const a = (s / 36) * Math.PI * 2;
          const rr = k + Math.sin(a * 3 + k) * 1.2;
          ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      bigNumber(ctx, num, cx, cy + 2, 40, b, 64, { italic: true });
      titleBlock(ctx, map, b, cx + r + 14, cy, true);
      bottom = cy + r + 10;
      break;
    }
    case 'image': {
      const cx = 52;
      const cy = 52;
      if (image) ctx.drawImage(image, cx - 44, cy - 44, 88, 88);
      else {
        ctx.fillStyle = b.primary;
        ctx.beginPath();
        ctx.roundRect(cx - 40, cy - 40, 80, 80, 16);
        ctx.fill();
      }
      bigNumber(ctx, num, cx, cy, 44, b, 76, { outline: b.secondary });
      titleBlock(ctx, map, b, cx + 54, cy, true);
      bottom = cy + 50;
      break;
    }
    default: {
      // pill: a rounded plate, the number large and the title beside it
      const title = b.showTitle ? map.title ?? map.name : '';
      ctx.font = `900 40px ${FONTS[b.font]}`;
      const nw = num ? ctx.measureText(num).width : 0;
      ctx.font = `600 15px ${FONT_MAIN}`;
      const tw = title ? ctx.measureText(title).width : 0;
      const capW = b.caption ? ctx.measureText(b.caption).width : 0;
      const gap = num && (title || b.caption) ? 10 : 0;
      const w = 32 + nw + gap + Math.max(tw, capW);
      const h = num ? 52 : 32;
      ctx.save();
      ctx.fillStyle = b.primary;
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = 'rgba(58,96,150,0.2)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(12, 12, w, h, 14);
      ctx.fill();
      ctx.restore();
      const base = 12 + h / 2;
      if (num) bigNumber(ctx, num, 28, base + 2, 40, b, 120, { align: 'left' });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (b.caption) {
        ctx.fillStyle = b.titleColor;
        ctx.globalAlpha = 0.7;
        ctx.font = `600 11px ${FONT_MAIN}`;
        ctx.fillText(b.caption, 28 + nw + gap, base - 9);
        ctx.globalAlpha = 1;
      }
      if (title) {
        ctx.fillStyle = b.titleColor;
        ctx.font = `600 15px ${FONT_MAIN}`;
        ctx.fillText(title, 28 + nw + gap, base + (b.caption ? 7 : 2));
      }
      bottom = 12 + h;
    }
  }
  ctx.restore();
  return bottom + 8;
}
