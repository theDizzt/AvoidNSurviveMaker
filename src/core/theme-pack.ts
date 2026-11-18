import { t } from './i18n';
import { todayUtc } from './time';
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
  /** Font of the level title (the number's font when omitted) */
  titleFont?: BadgeFont;
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
  badge: BadgeStyle;
}

/**
 * Theme text in another language. The plain fields of theme.json are the default (English) text;
 * "i18n": { "ko": { "name": "…", "description": "…" } } replaces them while the game is in that
 * language. Missing fields keep the default text.
 */
export interface ThemeText {
  name?: string;
  description?: string;
  credits?: string;
  /** The level badge caption */
  caption?: string;
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
  /** Looping background music, as a file path inside the theme pack. */
  music?: string;
  /** Credits shown on its screens via {credits}, e.g. designers and music */
  credits?: string;
  /** Font files bundled in the pack */
  fonts?: ThemeFont[];
  style: ThemeStyle;
  /** Custom level select screen */
  screens?: ThemeScreens;
  /** Translations of the text above, by language id (see ThemeText) */
  i18n?: Record<string, ThemeText>;
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
    name: t('themePack.defaultName'),
    description: '',
    author: '',
    released: todayUtc(),
    unlockStars: 0,
    colors: ['#9fe2ff', '#c3b5ff'],
    style: { badge: { ...DEFAULT_BADGE } },
  };
}

/** A loaded theme: info, levels and its files as URLs */
export interface ThemeEntry {
  /** As shown: translated to the game's language (see localizeThemeInfo) */
  info: ThemeInfo;
  /** As in theme.json, with every language: what the Theme Editor loads and saves */
  source?: ThemeInfo;
  levels: MapData[];
  coverUrl?: string;
  badgeUrl?: string;
  /** Every file of the pack (images, fonts) by its path in the pack → URL */
  assets: Record<string, string>;
  official: boolean;
  /**
   * Official themes: the level slot (0-based) of each entry of `levels`, from its level number, so
   * "level 9" sits in slot 9 even while levels 4–8 don't exist yet. Unset = slots follow `levels`.
   */
  slots?: number[];
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
  if (typeof input !== 'object' || input === null) throw new Error(t('themePack.notTheme'));
  const o = input as Record<string, unknown>;
  if (o.format !== THEME_FORMAT) throw new Error(t('themePack.format', { format: String(o.format) }));
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
  if (FONTS.includes(b.titleFont as BadgeFont) || isLibraryFont(b.titleFont as string)) badge.titleFont = b.titleFont as BadgeFont;
  if (str(b.caption)) badge.caption = str(b.caption, 40);
  if (str(b.image)) badge.image = str(b.image, 120);
  const info: ThemeInfo = {
    format: THEME_FORMAT,
    id: str(o.id, 60).replace(/[^a-zA-Z0-9_-]/g, '') || base.id,
    name: str(o.name, 60) || t('themePack.untitled'),
    description: str(o.description, 1000),
    author: str(o.author, 60),
    released: /^\d{4}-\d{2}-\d{2}$/.test(str(o.released)) ? str(o.released) : base.released,
    unlockStars: typeof o.unlockStars === 'number' ? Math.max(0, Math.round(o.unlockStars)) : 0,
    colors: Array.isArray(o.colors) ? [hex(o.colors[0], base.colors[0]), hex(o.colors[1], base.colors[1])] : base.colors,
    style: { badge },
  };
  if (str(o.authorUrl)) info.authorUrl = str(o.authorUrl, 300);
  if (str(o.cover)) info.cover = str(o.cover, 120);
  const music = str(o.music, 200);
  if (music && !music.startsWith('/') && !music.includes('\\') && !music.includes(':')
    && !music.split('/').includes('..') && /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(music)) info.music = music;
  if (str(o.credits)) info.credits = str(o.credits, 2000);
  const fonts = readFonts(o.fonts);
  if (fonts) info.fonts = fonts;
  const screens = readScreens(o.screens);
  if (screens) info.screens = screens;
  const i18n = readThemeI18n(o.i18n);
  if (i18n) info.i18n = i18n;
  if (style.maze !== undefined) {
    // Reuse the map validator for the maze colors
    const probe = validateMap({ v: 2, width: 960, height: 540, start: { x: 0, y: 0, w: 10, h: 10 }, goal: { x: 20, y: 0, w: 10, h: 10 }, objects: [], theme: style.maze });
    if (probe.theme) info.style.maze = probe.theme;
  }
  return info;
}

/** The "i18n" block of theme.json: language id → translated text (same limits as the default text) */
function readThemeI18n(v: unknown): Record<string, ThemeText> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const out: Record<string, ThemeText> = {};
  for (const [lang, raw] of Object.entries(v).slice(0, 20)) {
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) || typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const text: ThemeText = {};
    if (str(r.name).trim()) text.name = str(r.name, 60);
    if (str(r.description).trim()) text.description = str(r.description, 1000);
    if (str(r.credits).trim()) text.credits = str(r.credits, 2000);
    if (str(r.caption).trim()) text.caption = str(r.caption, 40);
    if (Object.keys(text).length) out[lang] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The theme as shown in `lang`: its translated text where there is one, the default text elsewhere */
export function localizeThemeInfo(info: ThemeInfo, lang: string): ThemeInfo {
  const tx = info.i18n?.[lang];
  if (!tx) return info;
  return {
    ...info,
    name: tx.name ?? info.name,
    description: tx.description ?? info.description,
    ...(tx.credits ?? info.credits ? { credits: tx.credits ?? info.credits } : {}),
    style: tx.caption ? { ...info.style, badge: { ...info.style.badge, caption: tx.caption } } : info.style,
  };
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

/**
 * Slot of each level of an official theme: its level number (1-based) when that slot is free,
 * otherwise the first free slot. Levels are taken in the given (file name) order.
 */
export function assignSlots(levels: readonly MapData[], total = LEVELS_PER_THEME): number[] {
  const used = new Set<number>();
  const slots = levels.map((m) => {
    const want = m.level !== undefined ? m.level - 1 : -1;
    if (want >= 0 && want < total && !used.has(want)) {
      used.add(want);
      return want;
    }
    return -1;
  });
  return slots.map((s) => {
    if (s >= 0) return s;
    let free = 0;
    while (used.has(free)) free++;
    used.add(free);
    return free;
  });
}

/** The level in slot `index` (undefined for an empty slot) */
export function levelAt(entry: ThemeEntry, index: number): MapData | undefined {
  if (!entry.slots) return entry.levels[index];
  const k = entry.slots.indexOf(index);
  return k >= 0 ? entry.levels[k] : undefined;
}

/** Slots that hold a level, in order */
export function filledSlots(entry: ThemeEntry): number[] {
  return entry.slots ? [...entry.slots].sort((a, b) => a - b) : entry.levels.map((_, i) => i);
}

/** A level ready to play: the theme's maze colors applied where the level has none */
export function themedLevel(entry: ThemeEntry, index: number): MapData | null {
  const m = levelAt(entry, index);
  if (!m || index >= levelSlots(entry)) return null;
  const out: MapData = { ...m, level: m.level ?? index + 1, title: m.title ?? m.name.replace(/^\d+\.\s*/, '') };
  if (!out.theme && entry.info.style.maze) out.theme = entry.info.style.maze;
  return out;
}
