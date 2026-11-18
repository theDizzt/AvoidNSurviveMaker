import { t as tr } from '../core/i18n';
import {
  BUILTIN_FONTS, DEFAULT_BUTTON, difficultyLabel, STAGE_H, STAGE_W,
  type BuiltinFont, type LayoutElement, type LevelButtonStyle, type ScreenLayout, type Visibility,
} from '../core/screen-layout';
import { isLibraryFont } from '../core/font-catalog';
import { formatSeconds } from '../core/simulation';
import { ensureLibraryFont, libraryFontCss } from './library-fonts';
import { STARS_PER_LEVEL, type ThemeInfo } from '../core/theme-pack';
import { FONT_MAIN, FONT_TIMER, FONT_TITLE } from './render';

/**
 * Builds a theme's custom screen (level select) as DOM on a 1280×720 stage that
 * scales to its host. The same renderer powers the game and the theme editor (edit mode adds
 * selection, dragging and resizing).
 */

const BUILTIN: Record<BuiltinFont, string> = {
  title: FONT_TITLE,
  main: FONT_MAIN,
  serif: "Georgia, 'Times New Roman', serif",
  heavy: "'Arial Black', Impact, 'Segoe UI Black', sans-serif",
  condensed: "'Bahnschrift Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif",
  digital: FONT_TIMER,
  hand: "'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive",
  blackletter: "'anf-unifraktur-cook', 'Old English Text MT', 'UnifrakturMaguntia', serif",
  mono: "Consolas, 'Courier New', monospace",
};

/** What a screen shows: the theme, its files, its levels and optional level details */
export interface ScreenData {
  info: ThemeInfo;
  /** Pack path → URL (images, fonts) */
  assets: Record<string, string>;
  /** Unique per theme, so bundled fonts of different themes don't clash */
  fontScope: string;
  levels: { available: boolean; stars: number; cleared: boolean; difficulty: number; title: string }[];
  /** Optional level index for level-specific elements */
  level?: number;
  best?: number | null;
}

export interface ScreenHandlers {
  onLevel?: (i: number) => void;
  onBack?: () => void;
  onStart?: () => void;
}

/** Edit mode (theme editor) */
export interface EditHooks {
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** An element was moved or resized (x, y, w, h already updated) */
  onChange: (el: LayoutElement) => void;
}

const loadedFonts = new Set<string>();

/** Register the pack's font files as `<scope>-<family>` */
export function ensureFonts(info: ThemeInfo, assets: Record<string, string>, scope: string): void {
  for (const f of info.fonts ?? []) {
    const url = assets[f.file];
    const name = `${scope}-${f.family}`;
    if (!url || loadedFonts.has(`${name}|${url}`)) continue;
    loadedFonts.add(`${name}|${url}`);
    const face = new FontFace(name, `url("${url}")`);
    face.load().then((ff) => document.fonts.add(ff)).catch(() => loadedFonts.delete(`${name}|${url}`));
  }
}

export function fontCss(font: string | undefined, scope: string): string {
  if (!font) return BUILTIN.title;
  if (font === 'blackletter') void ensureLibraryFont('unifraktur-cook');
  if ((BUILTIN_FONTS as readonly string[]).includes(font)) return BUILTIN[font as BuiltinFont];
  if (isLibraryFont(font)) return libraryFontCss(font);
  return `'${scope}-${font}', ${FONT_MAIN}`;
}

/** Fill in {placeholders} */
export function fillText(text: string, d: ScreenData): string {
  const i = d.level ?? 0;
  const lv = d.levels[i];
  const cleared = d.levels.filter((l) => l.cleared).length;
  const stars = d.level !== undefined ? lv?.stars ?? 0 : d.levels.reduce((s, l) => s + l.stars, 0);
  const vars: Record<string, string> = {
    theme: d.info.name,
    description: d.info.description,
    author: d.info.author,
    credits: d.info.credits ?? '',
    released: d.info.released,
    cleared: String(cleared),
    total: String(Math.max(d.levels.filter((l) => l.available).length, 1)),
    stars: String(stars),
    maxStars: String(d.level !== undefined ? STARS_PER_LEVEL : d.levels.length * STARS_PER_LEVEL),
    n: String(i + 1),
    nn: String(i + 1).padStart(2, '0'),
    title: lv?.title ?? '',
    difficulty: (lv?.difficulty ?? 1).toFixed(2),
    difficultyLabel: difficultyLabel(lv?.difficulty ?? 1),
    best: d.best != null ? formatSeconds(d.best) : '--',
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function visible(when: Visibility | undefined, d: ScreenData): boolean {
  const available = d.levels.filter((l) => l.available);
  const all = available.length > 0 && available.every((l) => l.cleared);
  const lv = d.levels[d.level ?? 0];
  switch (when) {
    case 'allComplete': return all;
    case 'notComplete': return !all;
    case 'cleared': return !!lv?.cleared;
    case 'notCleared': return !lv?.cleared;
    default: return true;
  }
}

function textShadow(e: { glow?: string; shadow?: boolean }): string {
  const parts: string[] = [];
  if (e.glow) parts.push(`0 0 6px ${e.glow}`, `0 0 16px ${e.glow}`, `0 0 28px ${e.glow}`);
  if (e.shadow) parts.push('2px 3px 0 rgba(0,0,0,0.45)');
  return parts.join(', ');
}

function applyText(node: HTMLElement, e: LayoutElement, scope: string, defaults: { size: number; color: string }): void {
  node.style.fontFamily = fontCss(e.font, scope);
  node.style.fontSize = `${e.size ?? defaults.size}px`;
  node.style.color = e.color ?? defaults.color;
  node.style.fontWeight = e.bold ? '800' : '400';
  node.style.fontStyle = e.italic ? 'italic' : 'normal';
  node.style.textAlign = e.align ?? 'center';
  node.style.justifyContent = e.align === 'left' ? 'flex-start' : e.align === 'right' ? 'flex-end' : 'center';
  textEffects(node.querySelector<HTMLElement>('.se-label') ?? node, e, e.size ?? defaults.size, e.color ?? defaults.color);
}

/**
 * Outline, drop shadow, neon glow, gradient and 3D extrusion on the text span. A gradient fills
 * the letters through background-clip, which text-shadow would paint over, so with a gradient
 * the shadows become chained drop-shadow filters instead.
 */
function textEffects(span: HTMLElement, e: LayoutElement, size: number, color: string): void {
  if (e.stroke) span.style.webkitTextStroke = `${e.strokeWidth ?? Math.max(1, size / 18)}px ${e.stroke}`;
  const depth = Math.min(30, e.depth ?? 0);
  const side = e.depthColor ?? '#000000';
  const shadow = e.shadowColor ? `color-mix(in srgb, ${e.shadowColor} 50%, transparent)` : 'rgba(0,0,0,0.45)';
  const off = Math.max(2, size * 0.08) + depth * 0.8;
  if (e.gradient) {
    span.style.backgroundImage = `linear-gradient(${color}, ${e.gradient})`;
    span.style.backgroundClip = 'text';
    span.style.webkitBackgroundClip = 'text';
    span.style.color = 'transparent';
    // Chained filters: each drop-shadow also shadows the ones before it, so 1px steps build the 3D sides
    const f: string[] = [];
    for (let k = 0; k < depth; k++) f.push(`drop-shadow(0.6px 0.8px 0 ${side})`);
    if (e.shadow) f.push(`drop-shadow(${(off - depth * 0.8) * 0.75}px ${off - depth * 0.8}px 0 ${shadow})`);
    if (e.glow) f.push(`drop-shadow(0 0 4px ${e.glow})`, `drop-shadow(0 0 12px ${e.glow})`);
    if (f.length) span.style.filter = f.join(' ');
    return;
  }
  const parts: string[] = [];
  if (e.glow) parts.push(`0 0 6px ${e.glow}`, `0 0 16px ${e.glow}`, `0 0 28px ${e.glow}`);
  for (let k = 1; k <= depth; k++) parts.push(`${k * 0.6}px ${k * 0.8}px 0 ${side}`);
  if (e.shadow) parts.push(`${off * 0.75}px ${off}px 0 ${shadow}`);
  if (parts.length) span.style.textShadow = parts.join(', ');
}

/** Shapes of level buttons, in a 100×100 box */
const SHAPE_SVG: Record<Exclude<LevelButtonStyle['shape'], 'none'>, (sw: number) => string> = {
  rounded: (sw) => `<rect x="${sw / 2 + 1}" y="${sw / 2 + 1}" width="${98 - sw}" height="${98 - sw}" rx="18"/>`,
  square: (sw) => `<rect x="${sw / 2 + 1}" y="${sw / 2 + 1}" width="${98 - sw}" height="${98 - sw}" rx="2"/>`,
  circle: (sw) => `<circle cx="50" cy="50" r="${48 - sw / 2}"/>`,
  diamond: (sw) => `<polygon points="50,${2 + sw} ${98 - sw},50 50,${98 - sw} ${2 + sw},50"/>`,
  drop: (sw) => { const o = 2 + sw / 2; return `<path d="M50 ${o} H${100 - o} V50 A${50 - o} ${50 - o} 0 1 1 50 ${o} Z"/>`; },
  leaf: (sw) => { const o = 4 + sw / 2; return `<path d="M${o} ${100 - o} C${o} 40 40 ${o} ${100 - o} ${o} C${100 - o} 60 60 ${100 - o} ${o} ${100 - o} Z"/>`; },
};

function starRow(count: number, filled: number, on: string, off: string): HTMLElement {
  const row = document.createElement('span');
  row.className = 'se-stars';
  for (let k = 0; k < count; k++) {
    const s = document.createElement('span');
    s.textContent = '★';
    s.style.color = k < filled ? on : off;
    row.append(s);
  }
  return row;
}

/** Page shown by each level grid (kept while the screen is rebuilt), by element id */
const gridPages = new Map<string, number>();

function levelGrid(e: LayoutElement, d: ScreenData, h: ScreenHandlers, editing: boolean): HTMLElement {
  const b = e.button ?? DEFAULT_BUTTON;
  const cols = e.cols ?? 7;
  const rows = e.rows ?? 3;
  const gap = e.gap ?? 16;
  const perPage = cols * rows;
  // Custom packs can have more levels than the grid has cells: page through them
  const pages = Math.max(1, Math.ceil(d.levels.length / perPage));
  const wrap = document.createElement('div');
  wrap.className = 'se-grid-wrap';
  const grid = document.createElement('div');
  grid.className = 'se-grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.style.gap = `${gap}px`;
  const cellW = (e.w - gap * (cols - 1)) / cols;
  const cellH = (e.h - gap * (rows - 1)) / rows;
  const size = Math.min(cellW, cellH);
  wrap.append(grid);

  const fill = (page: number) => {
    gridPages.set(e.id, page);
    const buttons: HTMLElement[] = [];
    for (let i = page * perPage; i < Math.min((page + 1) * perPage, d.levels.length); i++) buttons.push(levelButton(i));
    grid.replaceChildren(...buttons);
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    counter.textContent = `${page + 1} / ${pages}`;
  };

  const levelButton = (i: number): HTMLElement => {
    const lv = d.levels[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'se-level';
    btn.style.width = btn.style.height = `${size}px`;
    if (!lv?.available) btn.classList.add('off');
    const color = lv?.cleared && b.clearedFill ? b.clearedFill : b.fill2 && i % 2 ? b.fill2 : b.fill;
    if (b.image && d.assets[b.image]) {
      const img = document.createElement('img');
      img.src = d.assets[b.image];
      img.alt = '';
      img.draggable = false;
      btn.append(img);
    } else if (b.shape !== 'none') {
      btn.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 100 100" aria-hidden="true" fill="${color}" stroke="${b.border}" stroke-width="${b.borderWidth}">${SHAPE_SVG[b.shape](b.borderWidth)}</svg>`);
    }
    const label = document.createElement('span');
    label.className = 'se-level-in';
    const num = document.createElement('span');
    num.className = 'se-level-no';
    num.textContent = b.pad ? String(i + 1).padStart(b.pad, '0') : String(i + 1);
    num.style.fontFamily = fontCss(b.font, d.fontScope);
    num.style.fontSize = `${b.numberSize}px`;
    num.style.color = b.numberColor;
    if (b.numberGlow) num.style.textShadow = textShadow({ glow: b.numberGlow });
    label.append(num);
    if (lv?.available && b.showStars) label.append(starRow(3, lv.stars, '#ffd23f', 'rgba(255,255,255,0.35)'));
    if (lv?.available && b.showDifficulty) {
      const dd = document.createElement('span');
      dd.className = 'se-level-diff';
      dd.textContent = `◆ ${lv.difficulty.toFixed(2)}`;
      dd.style.color = b.numberColor;
      label.append(dd);
    }
    btn.append(label);
    if (lv?.available) btn.title = tr('level.label', { n: i + 1, title: lv.title });
    btn.disabled = !lv?.available && !editing;
    if (!editing && lv?.available) btn.addEventListener('click', () => h.onLevel?.(i));
    return btn;
  };

  const arrow = (text: string, cls: string, d: number) => {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = `se-page ${cls}`;
    a.textContent = text;
    a.style.color = b.numberColor;
    a.title = tr(d < 0 ? 'screen.prevLevels' : 'screen.nextLevels');
    a.addEventListener('click', (ev) => {
      ev.stopPropagation();
      fill(Math.min(pages - 1, Math.max(0, (gridPages.get(e.id) ?? 0) + d)));
    });
    return a;
  };
  const prev = arrow('◀', 'se-prev', -1);
  const next = arrow('▶', 'se-next', 1);
  const counter = document.createElement('span');
  counter.className = 'se-page-count';
  counter.style.color = b.numberColor;
  if (pages > 1) wrap.append(prev, next, counter);
  fill(Math.min(gridPages.get(e.id) ?? 0, pages - 1));
  return wrap;
}

function buildElement(e: LayoutElement, d: ScreenData, h: ScreenHandlers, editing: boolean): HTMLElement {
  const isButton = e.kind === 'back' || e.kind === 'start';
  const node = document.createElement(isButton && !editing ? 'button' : 'div');
  node.className = `se se-${e.kind}`;
  if (node instanceof HTMLButtonElement) node.type = 'button';
  node.dataset.id = e.id;
  Object.assign(node.style, {
    left: `${e.x}px`,
    top: `${e.y}px`,
    width: `${e.w}px`,
    height: `${e.h}px`,
    transform: e.rotate ? `rotate(${e.rotate}deg)` : '',
    opacity: e.opacity !== undefined ? String(e.opacity) : '',
  });
  const boxLike = e.kind === 'box' || isButton;
  if (boxLike) {
    if (e.fill) node.style.background = e.fill;
    if (e.border && e.borderWidth) node.style.border = `${e.borderWidth}px solid ${e.border}`;
    if (e.radius) node.style.borderRadius = `${e.radius}px`;
  }
  switch (e.kind) {
    case 'text':
    case 'back':
    case 'start': {
      const fallback = e.kind === 'back' ? 'BACK' : e.kind === 'start' ? '√' : '';
      const label = document.createElement('span');
      label.className = 'se-label';
      label.textContent = fillText(e.text ?? fallback, d);
      node.append(label);
      applyText(node, e, d.fontScope, { size: e.kind === 'start' ? 40 : 28, color: '#ffffff' });
      if (!editing) {
        if (e.kind === 'back') node.addEventListener('click', () => h.onBack?.());
        if (e.kind === 'start') node.addEventListener('click', () => h.onStart?.());
      }
      if (e.kind === 'start') node.title = 'Start (Enter)';
      if (e.kind === 'back') node.title = 'Back (Esc)';
      break;
    }
    case 'image': {
      const url = e.src ? d.assets[e.src] : undefined;
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        node.append(img);
      } else if (editing) node.textContent = tr('common.image');
      break;
    }
    case 'stars': {
      const count = e.count ?? (e.source === 'difficulty' ? 5 : 3);
      const lv = d.levels[d.level ?? 0];
      const filled = e.source === 'difficulty' ? Math.round(((lv?.difficulty ?? 1) / 10) * count) : lv?.stars ?? 0;
      const row = starRow(count, filled, e.onColor ?? '#ff9a2e', e.offColor ?? '#b9bec7');
      row.style.fontSize = `${e.size ?? Math.min(e.h, e.w / count)}px`;
      node.append(row);
      break;
    }
    case 'progress': {
      const total = Math.max(1, d.levels.filter((l) => l.available).length || d.levels.length);
      const at = (d.level ?? 0) + 1;
      for (let k = 0; k < total; k++) {
        const seg = document.createElement('span');
        seg.style.background = k < at ? e.onColor ?? '#111111' : e.offColor ?? '#e5e5e5';
        node.append(seg);
      }
      break;
    }
    case 'levelGrid':
      node.append(levelGrid(e, d, h, editing));
      break;
    default:
      break;
  }
  return node;
}

/** Background, scaled stage and elements */
export function renderScreen(host: HTMLElement, layout: ScreenLayout, d: ScreenData, h: ScreenHandlers, edit?: EditHooks): void {
  ensureFonts(d.info, d.assets, d.fontScope);
  host.classList.add('se-host');
  const stage = document.createElement('div');
  stage.className = 'se-stage';
  stage.style.width = `${STAGE_W}px`;
  stage.style.height = `${STAGE_H}px`;
  const bg = layout.background;
  stage.style.background = bg.color2 ? `linear-gradient(180deg, ${bg.color}, ${bg.color2})` : bg.color;
  if (bg.image && d.assets[bg.image]) {
    const img = document.createElement('div');
    img.className = 'se-bg';
    img.style.backgroundImage = `url("${d.assets[bg.image]}")`;
    img.style.backgroundSize = bg.fit === 'tile' ? 'auto' : bg.fit ?? 'cover';
    img.style.backgroundRepeat = bg.fit === 'tile' ? 'repeat' : 'no-repeat';
    stage.append(img);
    if (bg.dim) {
      const dim = document.createElement('div');
      dim.className = 'se-bg';
      dim.style.background = `rgba(0,0,0,${bg.dim})`;
      stage.append(dim);
    }
  }
  for (const e of layout.elements) {
    const shown = visible(e.when, d);
    if (!shown && !edit) continue;
    const node = buildElement(e, d, h, !!edit);
    if (!shown) node.classList.add('se-conditional');
    if (edit) {
      if (edit.selected === e.id) node.classList.add('se-selected');
      attachEditing(node, e, stage, edit);
    }
    stage.append(node);
  }
  if (edit) {
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.target === stage || (ev.target as HTMLElement).classList.contains('se-bg')) edit.onSelect(null);
    });
  }
  host.replaceChildren(stage);
  const fit = () => {
    const r = host.getBoundingClientRect();
    const s = Math.min(r.width / STAGE_W, r.height / STAGE_H) || 1;
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    stage.dataset.scale = String(s);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(host);
  // Stop observing once this stage is replaced
  const mo = new MutationObserver(() => {
    if (!stage.isConnected) {
      ro.disconnect();
      mo.disconnect();
    }
  });
  mo.observe(host, { childList: true });
}

/** Drag to move, corner handle to resize (in stage units) */
function attachEditing(node: HTMLElement, e: LayoutElement, stage: HTMLElement, edit: EditHooks): void {
  node.classList.add('se-edit');
  const handle = document.createElement('span');
  handle.className = 'se-handle';
  node.append(handle);
  node.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (edit.selected !== e.id) edit.onSelect(e.id);
    const scale = Number(stage.dataset.scale) || 1;
    const resizing = ev.target === handle;
    const start = { x: ev.clientX, y: ev.clientY, ex: e.x, ey: e.y, ew: e.w, eh: e.h };
    const target = stage.querySelector<HTMLElement>(`[data-id="${CSS.escape(e.id)}"]`) ?? node;
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / scale;
      const dy = (m.clientY - start.y) / scale;
      const snap = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / 5) * 5);
      if (resizing) {
        e.w = Math.max(8, snap(start.ew + dx));
        e.h = Math.max(8, snap(start.eh + dy));
        target.style.width = `${e.w}px`;
        target.style.height = `${e.h}px`;
      } else {
        e.x = snap(start.ex + dx);
        e.y = snap(start.ey + dy);
        target.style.left = `${e.x}px`;
        target.style.top = `${e.y}px`;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (e.x !== start.ex || e.y !== start.ey || e.w !== start.ew || e.h !== start.eh) edit.onChange(e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
