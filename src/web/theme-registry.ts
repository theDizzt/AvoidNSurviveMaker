import { language, t as tr } from './i18n';
import { assignSlots, LEVELS_PER_THEME, localizeThemeInfo, MAX_PACK_LEVELS, validateThemeInfo, type ThemeEntry, type ThemeInfo } from './localized/theme-pack';
import type { MapData, Theme } from '../core/types';
import { validateMap } from './localized/validate';

/**
 * All playable themes: the official ones from the repo's themes/ folder (bundled at build time)
 * and one custom pack loaded from a zip (kept in this browser).
 *
 * Pack layout: themes/<folder>/{theme.json, cover.*, badge.*, levels/*.json}.
 * CHAPTER_FOLDERS selects campaign packs; custom-themes/ contains reusable custom presets.
 * Folders starting with "_" (the template) are skipped.
 */
export const OFFICIAL_SLOTS = 16;

const infoFiles = import.meta.glob<unknown>(['../../themes/*/theme.json', '../../custom-themes/*/theme.json'], { eager: true, import: 'default' });
const levelFiles = import.meta.glob<unknown>(['../../themes/*/levels/*.json', '../../custom-themes/*/levels/*.json'], { eager: true, import: 'default' });
const assetFiles = import.meta.glob<string>(['../../themes/*/**/*.{png,jpg,jpeg,webp,gif,svg,ttf,otf,woff,woff2,mp3,ogg,wav,m4a,aac,flac}', '../../custom-themes/*/**/*.{png,jpg,jpeg,webp,gif,svg,ttf,otf,woff,woff2,mp3,ogg,wav,m4a,aac,flac}'], { eager: true, query: '?url', import: 'default' });

const folderOf = (path: string) => path.split('/')[3] ?? '';

function loadBundled(): { folder: string; entry: ThemeEntry }[] {
  const out: { folder: string; entry: ThemeEntry }[] = [];
  for (const [path, raw] of Object.entries(infoFiles)) {
    const folder = folderOf(path);
    if (!folder || folder.startsWith('_')) continue;
    const official = path.startsWith('../../themes/');
    const prefix = path.slice(0, -'theme.json'.length);
    let info: ThemeInfo;
    try {
      info = validateThemeInfo(raw);
    } catch (err) {
      console.warn(`${path}: ${(err as Error).message}`);
      continue;
    }
    const levels: MapData[] = [];
    for (const lp of Object.keys(levelFiles).filter((p) => p.startsWith(`${prefix}levels/`)).sort().slice(0, official ? LEVELS_PER_THEME : MAX_PACK_LEVELS)) {
      try {
        levels.push(validateMap(levelFiles[lp]));
      } catch (err) {
        console.warn(`${lp}: ${(err as Error).message}`);
      }
    }
    const assets: Record<string, string> = {};
    for (const [p, url] of Object.entries(assetFiles)) if (p.startsWith(prefix)) assets[p.slice(prefix.length)] = url;
    const image = (name?: string) => (name ? assets[name] : undefined);
    // Official chapters place each level by its level number (gaps stay empty "Soon" slots)
    const slots = official ? assignSlots(levels) : undefined;
    out.push({ folder, entry: { info: localizeThemeInfo(info, language), source: info, levels, coverUrl: image(info.cover), badgeUrl: image(info.style.badge.image), assets, official, ...(slots ? { slots } : {}) } });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

const bundled = loadBundled();
/** Explicit chapter order keeps editor-only themes out of the campaign. */
const CHAPTER_FOLDERS = [
  'chapter-01-workshop', 'chapter-02-desert', 'chapter-03-wood', 'chapter-04-botany',
  'chapter-05-frost', 'chapter-06-factory', 'chapter-07-sky', 'chapter-08-magma',
  'chapter-09-optics', 'chapter-10-ocean', 'chapter-11-cavern', 'chapter-12-galaxy',
  'chapter-13-unknown', 'chapter-14-unknown', 'chapter-15-cyberfunk', 'chapter-16-unknown',
] as const;

export const OFFICIAL_THEMES: readonly ThemeEntry[] = CHAPTER_FOLDERS.map((folder) => {
  const source = bundled.find((t) => t.folder === folder && t.entry.official)?.entry;
  if (!source) throw new Error(`Missing chapter theme: ${folder}`);
  return source;
});

export const CUSTOM_THEME_PRESETS: readonly ThemeEntry[] = bundled
  .filter(({ entry }) => !entry.official)
  .map(({ entry }) => entry);

// ───────────────────────── Custom pack ─────────────────────────

const CUSTOM_KEY = 'avoid-n-survive:custom-theme';

/** A custom pack as stored: its files as data URLs */
export interface StoredTheme {
  info: ThemeInfo;
  levels: MapData[];
  /** Path in the pack (images, fonts) → data URL */
  images: Record<string, string>;
}

let custom: ThemeEntry | null = null;
let customStored: StoredTheme | null = null;

function entryFromStored(s: StoredTheme): ThemeEntry {
  return {
    info: localizeThemeInfo(s.info, language),
    source: s.info,
    levels: s.levels,
    coverUrl: s.info.cover ? s.images[s.info.cover] : undefined,
    badgeUrl: s.info.style.badge.image ? s.images[s.info.style.badge.image] : undefined,
    assets: s.images,
    official: false,
  };
}

(function restore() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as StoredTheme;
    const stored: StoredTheme = { info: validateThemeInfo(s.info), levels: (s.levels ?? []).map((m) => validateMap(m)), images: s.images ?? {} };
    customStored = stored;
    custom = entryFromStored(stored);
  } catch {
    /* nothing saved, or unreadable */
  }
})();

export function customTheme(): ThemeEntry | null {
  return custom;
}

export function customStoredTheme(): StoredTheme | null {
  return customStored;
}

/** Make a pack the custom theme. Returns false when it was too big to keep after a reload */
export function setCustomTheme(s: StoredTheme): boolean {
  customStored = s;
  custom = entryFromStored(s);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false; // too large for storage: works until the page is reloaded
  }
}

/** Official chapters that define maze colors, offered as map editor presets */
export function chapterMazePresets(): { id: string; name: string; theme: Theme }[] {
  return OFFICIAL_THEMES.flatMap((t, i) => (t.info.style.maze
    ? [{ id: `chapter:${t.info.id}`, name: tr('themeRegistry.chapterPreset', { n: String(i + 1).padStart(2, '0'), name: t.info.name }), theme: t.info.style.maze }]
    : []));
}

/**
 * Maze colors as saved in the theme files: every official chapter, then the custom theme presets
 * (custom-themes/), each read from its theme.json. Used by the Theme Editor.
 */
export function themeFileMazePresets(): { id: string; name: string; theme: Theme }[] {
  return [
    ...chapterMazePresets(),
    ...CUSTOM_THEME_PRESETS.flatMap((t) => (t.info.style.maze ? [{ id: `preset:${t.info.id}`, name: t.info.name, theme: t.info.style.maze }] : [])),
  ];
}

/** The official chapter whose maze colors exactly match `theme` (a map made with a chapter preset) */
export function chapterForTheme(theme: Theme | undefined): ThemeEntry | null {
  if (!theme) return null;
  const json = JSON.stringify(theme);
  return OFFICIAL_THEMES.find((x) => x.info.style.maze && JSON.stringify(x.info.style.maze) === json) ?? null;
}

/** Music URL of the chapter matching `theme`, if it has music */
export function chapterMusicFor(theme: Theme | undefined): string | null {
  const t = chapterForTheme(theme);
  return t?.info.music ? t.assets[t.info.music] ?? null : null;
}

/** Level badge (number + title) design for a map: its chapter's when it uses a chapter preset */
export function badgeFor(map: MapData): { style: ThemeEntry['info']['style']['badge']; imageUrl?: string } | null {
  const t = chapterForTheme(map.theme);
  return t ? { style: t.info.style.badge, imageUrl: t.badgeUrl } : null;
}

/** Title shown in the badge: the map's title, else its name without a "12. " prefix */
export function badgeTitle(map: MapData): string {
  return map.title ?? map.name.replace(/^\d+\.\s*/, '');
}

export function allThemes(): ThemeEntry[] {
  return custom ? [...OFFICIAL_THEMES, custom] : [...OFFICIAL_THEMES];
}

export function themeById(id: string): ThemeEntry | null {
  return allThemes().find((t) => t.info.id === id) ?? null;
}
