import { isLibraryFont } from './font-catalog';
import { readFonts, readScreens, type ThemeFont, type ThemeScreens } from './screen-layout';
import type { MapData, Theme } from './types';
import { validateMap } from './validate';

/**
 * Theme packs: a world of up to 21 levels with its own look. Official themes live in the repo's
 * `themes/` folder; custom ones are loaded from (and saved as) zip files with the same layout:
 *
 *   theme.json          ThemeInfo (this file's format)
 *   cover.png|svg|…     representative image (optional; named by `cover`)
 *   badge.png|…         custom level badge image (optional; named by `style.badge.image`)
 *   levels/01.json …    the levels, in file-name order (MapData, as exported by the map editor)
 */
export const THEME_FORMAT = 1;
/** Official themes have exactly this many level slots; custom packs can hold any number */
export const LEVELS_PER_THEME = 21;
/** Practical cap for custom packs */
export const MAX_PACK_LEVELS = 999;
export const STARS_PER_LEVEL = 3;
export const STARS_PER_THEME = LEVELS_PER_THEME * STARS_PER_LEVEL;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

/** In-game level badge (top-left): the level number and title */
export type BadgeKind = 'pill' | 'disc' | 'emblem' | 'plate' | 'slant' | 'ring' | 'image';
/** A base font, or the id of a bundled library font (see font-catalog) */
export type BadgeFont = 'title' | 'main' | 'serif' | 'heavy' | 'timer' | (string & {});

export interface BadgeStyle {
  kind: BadgeKind;
  /** Main color of the badge shape */
  primary: string;
  /** Second color (rims, bands, grooves) */
  secondary: string;
  numberColor: string;
  titleColor: string;
  font: BadgeFont;
  /** Zero-pad the number to this many digits (0 = none): 2 → "03" */
  pad: number;
  showTitle: boolean;
  /** Small text above the title, e.g. "Now Playing" */
  caption?: string;
  /** Picture drawn behind the number (file name in the pack); used by kind 'image' */
  image?: string;
}

export interface ThemeStyle {
  /** Maze colors: walls and paths (the map editor's Theme) — applied to levels without their own */
  maze?: Theme;
  /** Default cursor color for its levels */
  cursorColor?: string;
  badge: BadgeStyle;
}

export interface ThemeInfo {
  format: typeof THEME_FORMAT;
  /** Unique id, used for saving progress (letters, digits, - and _) */
  id: string;
  name: string;
  description: string;
  author: string;
  /** Link to the author (optional) */
  authorUrl?: string;
  /** Release date, YYYY-MM-DD */
  released: string;
  /** Total stars needed to unlock it (custom packs are always open) */
  unlockStars: number;
  /** Tile gradient on the world select screen */
  colors: [string, string];
  /** Representative image file name in the pack */
  cover?: string;
  /** Credits shown on its screens via {credits}, e.g. designers and music */
  credits?: string;
  /** Font files bundled in the pack */
  fonts?: ThemeFont[];
  style: ThemeStyle;
  /** Custom level select / level intro screens */
  screens?: ThemeScreens;
}

export const DEFAULT_BADGE: Readonly<BadgeStyle> = {
  kind: 'pill',
  primary: '#ffffff',
  secondary: '#3a9ff0',
  numberColor: '#2b86e0',
  titleColor: '#243450',
  font: 'title',
  pad: 0,
  showTitle: true,
};

export function blankThemeInfo(): ThemeInfo {
  return {
    format: THEME_FORMAT,
    id: 'my-theme',
    name: 'My Theme',
    description: '',
    author: '',
    released: new Date().toISOString().slice(0, 10),
    unlockStars: 0,
    colors: ['#9fe2ff', '#c3b5ff'],
    style: { badge: { ...DEFAULT_BADGE } },
  };
}

/** A loaded theme: info, levels and its files as URLs */
export interface ThemeEntry {
  info: ThemeInfo;
  levels: MapData[];
  coverUrl?: string;
  badgeUrl?: string;
  /** Every file of the pack (images, fonts) by its path in the pack → URL */
  assets: Record<string, string>;
  official: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const KINDS: BadgeKind[] = ['pill', 'disc', 'emblem', 'plate', 'slant', 'ring', 'image'];
const FONTS: BadgeFont[] = ['title', 'main', 'serif', 'heavy', 'timer'];

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback;
}

/**
 * Read a theme.json leniently: unknown fields are dropped, bad values fall back to defaults,
 * so a hand-edited file still loads. Throws only when it isn't a theme at all.
 */
export function validateThemeInfo(input: unknown): ThemeInfo {
  if (typeof input !== 'object' || input === null) throw new Error('theme.json: not a theme');
  const o = input as Record<string, unknown>;
  if (o.format !== THEME_FORMAT) throw new Error(`theme.json: unsupported format (${String(o.format)})`);
  const base = blankThemeInfo();
  const style = (typeof o.style === 'object' && o.style ? o.style : {}) as Record<string, unknown>;
  const b = (typeof style.badge === 'object' && style.badge ? style.badge : {}) as Record<string, unknown>;
  const badge: BadgeStyle = {
    kind: KINDS.includes(b.kind as BadgeKind) ? (b.kind as BadgeKind) : DEFAULT_BADGE.kind,
    primary: hex(b.primary, DEFAULT_BADGE.primary),
    secondary: hex(b.secondary, DEFAULT_BADGE.secondary),
    numberColor: hex(b.numberColor, DEFAULT_BADGE.numberColor),
    titleColor: hex(b.titleColor, DEFAULT_BADGE.titleColor),
    font: FONTS.includes(b.font as BadgeFont) || isLibraryFont(b.font as string) ? (b.font as BadgeFont) : DEFAULT_BADGE.font,
    pad: typeof b.pad === 'number' ? Math.max(0, Math.min(4, Math.round(b.pad))) : 0,
    showTitle: b.showTitle !== false,
  };
  if (str(b.caption)) badge.caption = str(b.caption, 40);
  if (str(b.image)) badge.image = str(b.image, 120);
  const info: ThemeInfo = {
    format: THEME_FORMAT,
    id: str(o.id, 60).replace(/[^a-zA-Z0-9_-]/g, '') || base.id,
    name: str(o.name, 60) || 'Untitled theme',
    description: str(o.description, 1000),
    author: str(o.author, 60),
    released: /^\d{4}-\d{2}-\d{2}$/.test(str(o.released)) ? str(o.released) : base.released,
    unlockStars: typeof o.unlockStars === 'number' ? Math.max(0, Math.round(o.unlockStars)) : 0,
    colors: Array.isArray(o.colors) ? [hex(o.colors[0], base.colors[0]), hex(o.colors[1], base.colors[1])] : base.colors,
    style: { badge },
  };
  if (str(o.authorUrl)) info.authorUrl = str(o.authorUrl, 300);
  if (str(o.cover)) info.cover = str(o.cover, 120);
  if (str(o.credits)) info.credits = str(o.credits, 2000);
  const fonts = readFonts(o.fonts);
  if (fonts) info.fonts = fonts;
  const screens = readScreens(o.screens);
  if (screens) info.screens = screens;
  if (HEX.test(str(style.cursorColor))) info.style.cursorColor = str(style.cursorColor).toLowerCase();
  if (style.maze !== undefined) {
    // Reuse the map validator for the maze colors
    const probe = validateMap({ v: 2, width: 960, height: 540, start: { x: 0, y: 0, w: 10, h: 10 }, goal: { x: 20, y: 0, w: 10, h: 10 }, objects: [], theme: style.maze });
    if (probe.theme) info.style.maze = probe.theme;
  }
  return info;
}

/** Average difficulty of a theme's levels (levels without one count as 1.00); 1.00 when it has none */
export function averageDifficulty(levels: readonly MapData[]): number {
  if (!levels.length) return MIN_DIFFICULTY;
  return levels.reduce((s, m) => s + (m.difficulty ?? MIN_DIFFICULTY), 0) / levels.length;
}

/** Level slots of a theme: 21 for official themes (empty ones show as "Soon"), every level of a custom pack */
export function levelSlots(entry: ThemeEntry): number {
  return entry.official ? LEVELS_PER_THEME : Math.min(entry.levels.length, MAX_PACK_LEVELS);
}

/** Stars a theme can give */
export function maxStars(entry: ThemeEntry): number {
  return levelSlots(entry) * STARS_PER_LEVEL;
}

/** A level ready to play: the theme's maze colors and cursor color applied where the level has none */
export function themedLevel(entry: ThemeEntry, index: number): MapData | null {
  const m = entry.levels[index];
  if (!m || index >= levelSlots(entry)) return null;
  const out: MapData = { ...m, level: m.level ?? index + 1, title: m.title ?? m.name.replace(/^\d+\.\s*/, '') };
  if (!out.theme && entry.info.style.maze) out.theme = entry.info.style.maze;
  if (!out.cursorColor && entry.info.style.cursorColor) out.cursorColor = entry.info.style.cursorColor;
  return out;
}
