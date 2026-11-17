import { LEVELS_PER_THEME, validateThemeInfo, type ThemeEntry, type ThemeInfo } from '../core/theme-pack';
import type { MapData } from '../core/types';
import { validateMap } from '../core/validate';

/**
 * All playable themes: the official ones from the repo's themes/ folder (bundled at build time)
 * and one custom pack loaded from a zip (kept in this browser).
 *
 * Official folder layout: themes/NN-name/{theme.json, cover.*, badge.*, levels/*.json}.
 * Folders starting with "_" (the template) are skipped.
 */
export const OFFICIAL_SLOTS = 16;

const infoFiles = import.meta.glob<unknown>('../../themes/*/theme.json', { eager: true, import: 'default' });
const levelFiles = import.meta.glob<unknown>('../../themes/*/levels/*.json', { eager: true, import: 'default' });
const assetFiles = import.meta.glob<string>('../../themes/*/**/*.{png,jpg,jpeg,webp,gif,svg,ttf,otf,woff,woff2}', { eager: true, query: '?url', import: 'default' });

const folderOf = (path: string) => path.split('/themes/')[1]?.split('/')[0] ?? '';

function loadOfficial(): ThemeEntry[] {
  const out: { folder: string; entry: ThemeEntry }[] = [];
  for (const [path, raw] of Object.entries(infoFiles)) {
    const folder = folderOf(path);
    if (!folder || folder.startsWith('_')) continue;
    let info: ThemeInfo;
    try {
      info = validateThemeInfo(raw);
    } catch (err) {
      console.warn(`themes/${folder}: ${(err as Error).message}`);
      continue;
    }
    const levels: MapData[] = [];
    for (const lp of Object.keys(levelFiles).filter((p) => folderOf(p) === folder).sort().slice(0, LEVELS_PER_THEME)) {
      try {
        levels.push(validateMap(levelFiles[lp]));
      } catch (err) {
        console.warn(`${lp}: ${(err as Error).message}`);
      }
    }
    const prefix = `../../themes/${folder}/`;
    const assets: Record<string, string> = {};
    for (const [p, url] of Object.entries(assetFiles)) if (p.startsWith(prefix)) assets[p.slice(prefix.length)] = url;
    const image = (name?: string) => (name ? assets[name] : undefined);
    out.push({ folder, entry: { info, levels, coverUrl: image(info.cover), badgeUrl: image(info.style.badge.image), assets, official: true } });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder)).slice(0, OFFICIAL_SLOTS).map((o) => o.entry);
}

export const OFFICIAL_THEMES: readonly ThemeEntry[] = loadOfficial();

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
    info: s.info,
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

export function allThemes(): ThemeEntry[] {
  return custom ? [...OFFICIAL_THEMES, custom] : [...OFFICIAL_THEMES];
}

export function themeById(id: string): ThemeEntry | null {
  return allThemes().find((t) => t.info.id === id) ?? null;
}
