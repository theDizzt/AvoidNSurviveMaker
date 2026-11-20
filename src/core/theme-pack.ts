import { t as defaultTranslate, type Translator } from './i18n';
import { todayUtc } from './time';
import { createFontCatalogApi } from './font-catalog';
import { createScreenLayoutApi, type ThemeFont, type ThemeScreens } from './screen-layout';
import type { MapData, Theme } from './types';
import { readTextEffects, type TextEffects } from './text-effects';
import { createValidateApi } from './validate';

/** In-game level badge (top-left): the level number and title */
export type BadgeKind = 'pill' | 'disc' | 'emblem' | 'plate' | 'slant' | 'ring' | 'image';
/** A base font, or the id of a bundled library font (see font-catalog) */
export type BadgeFont = 'title' | 'main' | 'serif' | 'heavy' | 'timer' | (string & {});

/** Where one part of the badge sits, relative to the design's own spot (all optional) */
export interface BadgePart {
  /** Offset in map px */
  x?: number;
  y?: number;
  /** Size, × the design's (0.2–5) */
  scale?: number;
  /** Degrees, clockwise */
  rotate?: number;
  /** Not drawn */
  hidden?: boolean;
}

/** Badge parts: the graphic (which carries the number), the number inside it, the title block */
export type BadgePartId = 'graphic' | 'number' | 'title';
export type BadgeLayout = Partial<Record<BadgePartId, BadgePart>>;

/**
 * A badge part's animation: 'spin' turns it round and round, 'sway' rocks it, 'bob' moves it up and
 * down, 'pulse' grows and shrinks it, 'blink' fades it, 'color' fades its color to `color` and back;
 * 'wave' (number and title) bobs the letters one after another.
 */
export type BadgeAnimType = 'spin' | 'sway' | 'bob' | 'pulse' | 'blink' | 'color' | 'wave';
export interface BadgeAnim {
  type: BadgeAnimType;
  /** Cycles (spin: turns) per second; negative spins the other way */
  speed: number;
  /** Strength 0–1 */
  amount: number;
  /** Target color of 'color' */
  color?: string;
}
export const BADGE_ANIM_TYPES: readonly BadgeAnimType[] = ['spin', 'sway', 'bob', 'pulse', 'blink', 'color', 'wave'];

/** Lettering of the number or title; unset fields keep the design's own */
export interface BadgeTextFormat {
  /** Font weight 100–900 */
  weight?: number;
  italic?: boolean;
  /** Letter spacing in px */
  spacing?: number;
  transform?: 'upper' | 'lower';
}

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
  /** Effects on the level number (badge and level select) */
  numberFx?: TextEffects;
  /** Effects on the level title (badge and level select) */
  titleFx?: TextEffects;
  /** Zero-pad the number to this many digits (0 = none): 2 → "03" */
  pad: number;
  showTitle: boolean;
  /** Small text above the title, e.g. "Now Playing" */
  caption?: string;
  /** Picture drawn behind the number (file name in the pack); used by kind 'image' */
  image?: string;
  /** Free placement of the parts (moved, scaled, rotated) */
  layout?: BadgeLayout;
  numberFormat?: BadgeTextFormat;
  titleFormat?: BadgeTextFormat;
  /** Soft plate behind the title (each design has its own default) */
  titlePlate?: boolean;
  /** Animation of each part */
  anim?: Partial<Record<BadgePartId, BadgeAnim>>;
}

/**
 * A sub-theme: a named look inside a theme. Levels wear it when they pick it (`themeDesign`) or
 * when their number falls in its `levels` range. It may have its own maze colors, badge and music;
 * without its own maze it wears the parent theme's, and without its own badge or music it wears
 * the linked bundled theme's (`themeId`), else the parent theme's.
 */
export interface ThemeDesign {
  id: string;
  name: string;
  maze?: Theme;
  themeId?: string;
  /** Own level badge (none = the linked theme's, else the parent's) */
  badge?: BadgeStyle;
  /** Own music: a path in the pack (none = the linked theme's, else the parent's) */
  music?: string;
  /** Level numbers [first, last] that wear it unless they pick a design themselves */
  levels?: [number, number];
  /** Name in other languages: language id → name */
  i18n?: Record<string, string>;
}

/** `themeDesign` value that picks the parent theme's own look, whatever the ranges say */
export const DEFAULT_DESIGN = 'default';

export interface ThemeStyle {
  /** Maze colors: walls and paths (the map editor's Theme) — applied to levels without their own */
  maze?: Theme;
  /**
   * Additional named designs, selected by a level's themeDesign. `themeId` links a bundled theme
   * (official chapter or custom preset): levels using the design also wear its badge and music.
   */
  designs?: ThemeDesign[];
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

/**
 * The sub-theme a level wears: the one it picks (`themeDesign`), else the one whose level range
 * holds its number; none for the parent theme's own look.
 */
export function levelDesign(style: ThemeStyle, map: Pick<MapData, 'themeDesign' | 'level'>): ThemeDesign | undefined {
  if (map.themeDesign === DEFAULT_DESIGN) return undefined;
  const picked = map.themeDesign ? style.designs?.find((d) => d.id === map.themeDesign) : undefined;
  if (picked) return picked;
  const n = map.level;
  return n === undefined ? undefined : style.designs?.find((d) => d.levels && n >= d.levels[0] && n <= d.levels[1]);
}

/** Maze colors of a level: its sub-theme's, else its own (unless it picks the parent's look), else the theme's */
export function levelMaze(style: ThemeStyle, map: MapData): Theme | undefined {
  const design = levelDesign(style, map);
  if (design) return design.maze ?? style.maze;
  return map.themeDesign === DEFAULT_DESIGN ? style.maze : map.theme ?? style.maze;
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

/** Independent localized API; no process-wide locale or browser dependencies. */
export function createThemePackApi(t: Translator = defaultTranslate) {
  const { isLibraryFont } = createFontCatalogApi(t);
  const { readFonts, readScreens } = createScreenLayoutApi(t);
  const { validateMap } = createValidateApi(t);


  /**
   * Theme packs: a world of up to 21 levels with its own look. Official themes live in the repo's
   * `themes/` folder; custom ones are loaded from (and saved as) zip files with the same layout:
   *
   *   theme.json          ThemeInfo (this file's format)
   *   cover.png|svg|…     representative image (optional; named by `cover`)
   *   badge.png|…         custom level badge image (optional; named by `style.badge.image`)
   *   levels/01.json …    the levels, in file-name order (MapData, as exported by the map editor)
   */
  const THEME_FORMAT = 1;
  /** Official themes have exactly this many level slots; custom packs can hold any number */
  const LEVELS_PER_THEME = 21;
  /** Practical cap for custom packs */
  const MAX_PACK_LEVELS = 999;
  const STARS_PER_LEVEL = 3;
  /** Crystal stars (#59) that count per theme */
  const CRYSTALS_PER_THEME = 3;
  const STARS_PER_THEME = LEVELS_PER_THEME * STARS_PER_LEVEL;
  const MIN_DIFFICULTY = 1;
  const MAX_DIFFICULTY = 10;

  const DEFAULT_BADGE: Readonly<BadgeStyle> = {
    kind: 'pill',
    primary: '#ffffff',
    secondary: '#3a9ff0',
    numberColor: '#2b86e0',
    titleColor: '#243450',
    font: 'title',
    pad: 0,
    showTitle: true,
  };

  function blankThemeInfo(): ThemeInfo {
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

  const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
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
  function validateThemeInfo(input: unknown): ThemeInfo {
    if (typeof input !== 'object' || input === null) throw new Error(t('themePack.notTheme'));
    const o = input as Record<string, unknown>;
    if (o.format !== THEME_FORMAT) throw new Error(t('themePack.format', { format: String(o.format) }));
    const base = blankThemeInfo();
    const style = (typeof o.style === 'object' && o.style ? o.style : {}) as Record<string, unknown>;
    const badge = readBadge(style.badge);
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
    const music = musicPath(o.music);
    if (music) info.music = music;
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
    if (Array.isArray(style.designs)) {
      const ids = new Set<string>();
      info.style.designs = style.designs.map((raw: unknown) => {
        if (!raw || typeof raw !== 'object') throw new Error('Invalid theme design');
        const d = raw as Record<string, unknown>;
        const id = str(d.id, 61);
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(id) || id === DEFAULT_DESIGN || ids.has(id)) throw new Error('Invalid or duplicate theme design id');
        ids.add(id);
        const design: ThemeDesign = { id, name: str(d.name, 60) || id };
        if (typeof d.themeId === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(d.themeId)) design.themeId = d.themeId;
        if (d.maze !== undefined) design.maze = validateMap({ v: 2, width: 960, height: 540,
          start: { x: 0, y: 0, w: 10, h: 10 }, goal: { x: 20, y: 0, w: 10, h: 10 }, objects: [], theme: d.maze }).theme;
        if (d.badge && typeof d.badge === 'object') design.badge = readBadge(d.badge);
        const dm = musicPath(d.music);
        if (dm) design.music = dm;
        if (Array.isArray(d.levels) && d.levels.length === 2 && d.levels.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          const [a, b] = (d.levels as number[]).map((n) => Math.max(1, Math.min(9999, Math.round(n))));
          design.levels = [Math.min(a, b), Math.max(a, b)];
        }
        if (d.i18n && typeof d.i18n === 'object' && !Array.isArray(d.i18n)) {
          const names: Record<string, string> = {};
          for (const [lang, name] of Object.entries(d.i18n as Record<string, unknown>).slice(0, 20)) {
            if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) && str(name).trim()) names[lang] = str(name, 60);
          }
          if (Object.keys(names).length) design.i18n = names;
        }
        return design;
      });
    }
    return info;
  }

  const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);
  const fin = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);

  /** A level badge, read leniently (bad values fall back to the defaults) */
  function readBadge(v: unknown): BadgeStyle {
    const b = (typeof v === 'object' && v ? v : {}) as Record<string, unknown>;
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
    const numberFx = readTextEffects(b.numberFx);
    if (numberFx) badge.numberFx = numberFx;
    const titleFx = readTextEffects(b.titleFx);
    if (titleFx) badge.titleFx = titleFx;
    if (str(b.caption)) badge.caption = str(b.caption, 40);
    if (str(b.image)) badge.image = str(b.image, 120);
    const layout = readBadgeLayout(b.layout);
    if (layout) badge.layout = layout;
    const numberFormat = readBadgeTextFormat(b.numberFormat);
    if (numberFormat) badge.numberFormat = numberFormat;
    const titleFormat = readBadgeTextFormat(b.titleFormat);
    if (titleFormat) badge.titleFormat = titleFormat;
    if (typeof b.titlePlate === 'boolean') badge.titlePlate = b.titlePlate;
    const anim = readBadgeAnim(b.anim);
    if (anim) badge.anim = anim;
    return badge;
  }

  /** Part animations; unknown types are dropped, numbers clamped */
  function readBadgeAnim(v: unknown): BadgeStyle['anim'] {
    const o = obj(v);
    if (!o) return undefined;
    const out: NonNullable<BadgeStyle['anim']> = {};
    for (const id of ['graphic', 'number', 'title'] as const) {
      const a = obj(o[id]);
      if (!a || !BADGE_ANIM_TYPES.includes(a.type as BadgeAnimType)) continue;
      const type = a.type as BadgeAnimType;
      if (type === 'wave' && id === 'graphic') continue;
      const anim: BadgeAnim = { type, speed: fin(a.speed, -5, 5) ?? 0.5, amount: fin(a.amount, 0, 1) ?? 0.5 };
      if (typeof a.color === 'string' && HEX.test(a.color)) anim.color = a.color.toLowerCase();
      out[id] = anim;
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** A pack-relative audio path, or '' */
  function musicPath(v: unknown): string {
    const music = str(v, 200);
    return music && !music.startsWith('/') && !music.includes('\\') && !music.includes(':')
      && !music.split('/').includes('..') && /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(music) ? music : '';
  }

  /** Badge part placement; parts left at the design's spot are dropped */
  function readBadgeLayout(v: unknown): BadgeLayout | undefined {
    const o = obj(v);
    if (!o) return undefined;
    const out: BadgeLayout = {};
    for (const id of ['graphic', 'number', 'title'] as const) {
      const p = obj(o[id]);
      if (!p) continue;
      const part: BadgePart = {};
      const x = fin(p.x, -2000, 2000), y = fin(p.y, -2000, 2000), sc = fin(p.scale, 0.2, 5), r = fin(p.rotate, -360, 360);
      if (x) part.x = Math.round(x * 10) / 10;
      if (y) part.y = Math.round(y * 10) / 10;
      if (sc !== undefined && sc !== 1) part.scale = Math.round(sc * 1000) / 1000;
      if (r) part.rotate = Math.round(r * 10) / 10;
      if (p.hidden === true) part.hidden = true;
      if (Object.keys(part).length) out[id] = part;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function readBadgeTextFormat(v: unknown): BadgeTextFormat | undefined {
    const o = obj(v);
    if (!o) return undefined;
    const out: BadgeTextFormat = {};
    const w = fin(o.weight, 100, 900);
    if (w !== undefined) out.weight = Math.round(w / 100) * 100;
    if (typeof o.italic === 'boolean') out.italic = o.italic;
    const sp = fin(o.spacing, -10, 40);
    if (sp) out.spacing = Math.round(sp * 10) / 10;
    if (o.transform === 'upper' || o.transform === 'lower') out.transform = o.transform;
    return Object.keys(out).length ? out : undefined;
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
  function localizeThemeInfo(info: ThemeInfo, lang: string): ThemeInfo {
    const tx = info.i18n?.[lang];
    const designs = info.style.designs?.some((d) => d.i18n?.[lang])
      ? info.style.designs.map((d) => (d.i18n?.[lang] ? { ...d, name: d.i18n[lang] } : d))
      : info.style.designs;
    const style = designs !== info.style.designs ? { ...info.style, designs } : info.style;
    if (!tx) return style === info.style ? info : { ...info, style };
    return {
      ...info,
      name: tx.name ?? info.name,
      description: tx.description ?? info.description,
      ...(tx.credits ?? info.credits ? { credits: tx.credits ?? info.credits } : {}),
      style: tx.caption ? { ...style, badge: { ...style.badge, caption: tx.caption } } : style,
    };
  }

  /** Average difficulty of a theme's levels (levels without one count as 1.00); 1.00 when it has none */
  function averageDifficulty(levels: readonly MapData[]): number {
    if (!levels.length) return MIN_DIFFICULTY;
    return levels.reduce((s, m) => s + (m.difficulty ?? MIN_DIFFICULTY), 0) / levels.length;
  }

  /** Level slots of a theme: 21 for official themes (empty ones show as "Soon"), every level of a custom pack */
  function levelSlots(entry: ThemeEntry): number {
    return entry.official ? LEVELS_PER_THEME : Math.min(entry.levels.length, MAX_PACK_LEVELS);
  }

  /**
   * Crystal stars (#59) a theme can give: an official theme always counts 3 (its total is
   * 21 × 3 + 3 = 66, 1056 over the 16 official themes, even while some of its crystals aren't built
   * yet); a custom pack counts the levels that have one, up to 3.
   */
  function crystalSlots(entry: ThemeEntry): number {
    if (entry.official) return CRYSTALS_PER_THEME;
    let n = 0;
    for (let i = 0; i < levelSlots(entry); i++) if (levelAt(entry, i)?.objects.some((o) => o.role === 'crystal')) n++;
    return Math.min(CRYSTALS_PER_THEME, n);
  }

  /** Stars a theme can give: 3 per level plus its crystal stars */
  function maxStars(entry: ThemeEntry): number {
    return levelSlots(entry) * STARS_PER_LEVEL + crystalSlots(entry);
  }

  /**
   * Slot of each level of an official theme: its level number (1-based) when that slot is free,
   * otherwise the first free slot. Levels are taken in the given (file name) order.
   */
  function assignSlots(levels: readonly MapData[], total = LEVELS_PER_THEME): number[] {
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
  function levelAt(entry: ThemeEntry, index: number): MapData | undefined {
    if (!entry.slots) return entry.levels[index];
    const k = entry.slots.indexOf(index);
    return k >= 0 ? entry.levels[k] : undefined;
  }

  /** Slots that hold a level, in order */
  function filledSlots(entry: ThemeEntry): number[] {
    return entry.slots ? [...entry.slots].sort((a, b) => a - b) : entry.levels.map((_, i) => i);
  }

  /** A level ready to play: the theme's maze colors applied where the level has none */
  function themedLevel(entry: ThemeEntry, index: number): MapData | null {
    const m = levelAt(entry, index);
    if (!m || index >= levelSlots(entry)) return null;
    const out: MapData = { ...m, level: m.level ?? index + 1, title: m.title ?? m.name.replace(/^\d+\.\s*/, '') };
    out.theme = levelMaze(entry.info.style, out);
    return out;
  }
  return { THEME_FORMAT, LEVELS_PER_THEME, MAX_PACK_LEVELS, STARS_PER_LEVEL, CRYSTALS_PER_THEME, STARS_PER_THEME, MIN_DIFFICULTY, MAX_DIFFICULTY, DEFAULT_BADGE, blankThemeInfo, validateThemeInfo, localizeThemeInfo, averageDifficulty, levelSlots, crystalSlots, maxStars, assignSlots, levelAt, filledSlots, themedLevel };
}

export const { THEME_FORMAT, LEVELS_PER_THEME, MAX_PACK_LEVELS, STARS_PER_LEVEL, CRYSTALS_PER_THEME, STARS_PER_THEME, MIN_DIFFICULTY, MAX_DIFFICULTY, DEFAULT_BADGE, blankThemeInfo, validateThemeInfo, localizeThemeInfo, averageDifficulty, levelSlots, crystalSlots, maxStars, assignSlots, levelAt, filledSlots, themedLevel } = createThemePackApi();
