import { starsFor } from '../core/level';
import { recordTime } from '../core/time';
import { CRYSTALS_PER_THEME, filledSlots, STARS_PER_LEVEL, type ThemeEntry } from '../core/theme-pack';
import type { MapData } from '../core/types';
import { OFFICIAL_THEMES } from './theme-registry';

/**
 * Campaign progress (stars and best times per level), kept in this browser, keyed by theme id.
 * A level without star times earns all 3 stars when cleared.
 */
// Keep legacy browser-wide records as guest data; their original owner is unknown.
const STORAGE_KEY = 'avoid-n-survive:progress';
let activeUser: string | null = null;
const storageKey = (user: string | null) => user ? `${STORAGE_KEY}:account:${user}` : STORAGE_KEY;
const sessionRecords = new Map<string, Record<string, LevelRecord>>();

export interface LevelRecord {
  stars: number;
  /** Best clear time (ms) */
  best: number;
  /** Cleared while carrying the level's crystal star (#59) at least once */
  crystal?: boolean;
}

let records: Record<string, LevelRecord> = load();

function load(user: string | null = activeUser): Record<string, LevelRecord> {
  const cached = sessionRecords.get(storageKey(user));
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(user)) ?? '{}') as Record<string, Partial<LevelRecord>>;
    const out: Record<string, LevelRecord> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v?.stars === 'number' && typeof v.best === 'number' && Number.isFinite(v.best) && v.best > 0) {
        out[k] = { stars: Math.max(0, Math.min(STARS_PER_LEVEL, Math.round(v.stars))), best: recordTime(v.best), ...(v.crystal === true ? { crystal: true } : {}) };
      }
    }
    // Chapter 1 reuses the old Pastel maps; carry existing records forward once.
    for (const [k, record] of Object.entries(out)) {
      if (k.startsWith('pastel/')) out[k.replace(/^pastel\//, 'workshop/')] ??= record;
    }
    return out;
  } catch {
    return {};
  }
}

function save(): void {
  sessionRecords.set(storageKey(activeUser), records);
  try {
    localStorage.setItem(storageKey(activeUser), JSON.stringify(records));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

/** Switch the visible progress without copying records between players. */
export function setProgressUser(user: string | null): void {
  if (user === activeUser) return;
  sessionRecords.set(storageKey(activeUser), records);
  activeUser = user;
  records = load();
}

export function guestRecords(): Readonly<Record<string, LevelRecord>> {
  return activeUser === null ? records : load(null);
}

/** Progress key of a level: '<theme id>/<index>', or 'custom:<theme id>/<index>' for custom packs */
export const levelKey = (theme: ThemeEntry, index: number) => `${theme.official ? '' : 'custom:'}${theme.info.id}/${index}`;
const key = levelKey;

export function levelRecord(theme: ThemeEntry, index: number): LevelRecord | null {
  return records[key(theme, index)] ?? null;
}

/**
 * Record a clear; keeps the best stars and best time, and the crystal star once earned.
 * `crystal`: this clear carried the level's crystal star to GOAL. Returns the stars this clear earned
 */
export function recordClear(theme: ThemeEntry, index: number, map: MapData, time: number, crystal = false): number {
  time = recordTime(time);
  const stars = starsFor(map, time) ?? STARS_PER_LEVEL;
  const k = key(theme, index);
  const prev = records[k];
  const next: LevelRecord = { stars: Math.max(prev?.stars ?? 0, stars), best: Math.min(prev?.best ?? Infinity, time) };
  if (prev?.crystal || crystal) next.crystal = true;
  records = { ...records, [k]: next };
  save();
  // Queue this run independently of any previously uploaded best.
  onRecord(k, { stars, best: time, ...(crystal ? { crystal: true } : {}) });
  return stars;
}

/** Called after every clear with this run's record (e.g. to upload it) */
let onRecord: (key: string, record: LevelRecord) => void = () => {};
export function setOnRecord(fn: (key: string, record: LevelRecord) => void): void {
  onRecord = fn;
}

/** Records for the active account (or guest), by level key */
export function allRecords(): Readonly<Record<string, LevelRecord>> {
  return records;
}

/**
 * Merge records from elsewhere (the player's account): keeps the best time and most stars per level.
 * With authoritative=true, replace returned levels with the server's accepted values.
 * Returns how many levels changed here.
 */
export function mergeRecords(incoming: Record<string, LevelRecord>, authoritative = false): number {
  let changed = 0;
  const next = { ...records };
  for (const [k, r] of Object.entries(incoming)) {
    if (!Number.isFinite(r.best) || r.best <= 0) continue;
    const stars = Math.max(0, Math.min(STARS_PER_LEVEL, Math.round(r.stars)));
    const prev = next[k];
    const best = recordTime(r.best);
    const merged: LevelRecord = authoritative ? { stars, best }
      : { stars: Math.max(prev?.stars ?? 0, stars), best: Math.min(prev?.best ?? Infinity, best) };
    // A crystal star, once earned, is never taken back (a server without the column reports none)
    if (r.crystal === true || prev?.crystal) merged.crystal = true;
    if (!prev || merged.stars !== prev.stars || merged.best !== prev.best || !!merged.crystal !== !!prev.crystal) {
      next[k] = merged;
      changed++;
    }
  }
  if (changed) {
    records = next;
    save();
  }
  return changed;
}

/** Crystal stars (#59) earned in a theme, up to 3 */
export function themeCrystals(theme: ThemeEntry): number {
  const n = filledSlots(theme).reduce((s, i) => s + (records[key(theme, i)]?.crystal ? 1 : 0), 0);
  return Math.min(CRYSTALS_PER_THEME, n);
}

/** Stars earned in a theme: the level stars plus its crystal stars */
export function themeStars(theme: ThemeEntry): number {
  return filledSlots(theme).reduce((s, i) => s + (records[key(theme, i)]?.stars ?? 0), 0) + themeCrystals(theme);
}

/** Stars over the official themes (what unlocks worlds) */
export function totalStars(): number {
  return OFFICIAL_THEMES.reduce((s, t) => s + themeStars(t), 0);
}

/** Custom packs are always open */
export function themeUnlocked(theme: ThemeEntry): boolean {
  return !theme.official || totalStars() >= theme.info.unlockStars;
}
