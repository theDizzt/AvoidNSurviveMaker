import { starsFor } from '../core/level';
import { STARS_PER_LEVEL, type ThemeEntry } from '../core/theme-pack';
import type { MapData } from '../core/types';
import { OFFICIAL_THEMES } from './theme-registry';

/**
 * Campaign progress (stars and best times per level), kept in this browser, keyed by theme id.
 * A level without star times earns all 3 stars when cleared.
 */
const STORAGE_KEY = 'avoid-n-survive:progress';

export interface LevelRecord {
  stars: number;
  /** Best clear time (ms) */
  best: number;
}

let records: Record<string, LevelRecord> = load();

function load(): Record<string, LevelRecord> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Partial<LevelRecord>>;
    const out: Record<string, LevelRecord> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v?.stars === 'number' && typeof v.best === 'number') {
        out[k] = { stars: Math.max(0, Math.min(STARS_PER_LEVEL, Math.round(v.stars))), best: v.best };
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

const key = (theme: ThemeEntry, index: number) => `${theme.official ? '' : 'custom:'}${theme.info.id}/${index}`;

export function levelRecord(theme: ThemeEntry, index: number): LevelRecord | null {
  return records[key(theme, index)] ?? null;
}

/** Record a clear; keeps the best stars and best time. Returns the stars this clear earned */
export function recordClear(theme: ThemeEntry, index: number, map: MapData, time: number): number {
  const stars = starsFor(map, time) ?? STARS_PER_LEVEL;
  const k = key(theme, index);
  const prev = records[k];
  const next = { stars: Math.max(prev?.stars ?? 0, stars), best: Math.min(prev?.best ?? Infinity, time) };
  records = { ...records, [k]: next };
  save();
  onRecord(k, next);
  return stars;
}

/** Called after every clear with the level's updated record (e.g. to upload it) */
let onRecord: (key: string, record: LevelRecord) => void = () => {};
export function setOnRecord(fn: (key: string, record: LevelRecord) => void): void {
  onRecord = fn;
}

/** Every record kept in this browser, by level key */
export function allRecords(): Readonly<Record<string, LevelRecord>> {
  return records;
}

/**
 * Merge records from elsewhere (the player's account): keeps the best time and most stars per level.
 * Returns how many levels changed here.
 */
export function mergeRecords(incoming: Record<string, LevelRecord>): number {
  let changed = 0;
  const next = { ...records };
  for (const [k, r] of Object.entries(incoming)) {
    if (!Number.isFinite(r.best) || r.best <= 0) continue;
    const stars = Math.max(0, Math.min(STARS_PER_LEVEL, Math.round(r.stars)));
    const prev = next[k];
    const merged = { stars: Math.max(prev?.stars ?? 0, stars), best: Math.min(prev?.best ?? Infinity, r.best) };
    if (!prev || merged.stars !== prev.stars || merged.best !== prev.best) {
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

export function themeStars(theme: ThemeEntry): number {
  return theme.levels.reduce((s, _, i) => s + (records[key(theme, i)]?.stars ?? 0), 0);
}

/** Stars over the official themes (what unlocks worlds) */
export function totalStars(): number {
  return OFFICIAL_THEMES.reduce((s, t) => s + themeStars(t), 0);
}

/** Custom packs are always open */
export function themeUnlocked(theme: ThemeEntry): boolean {
  return !theme.official || totalStars() >= theme.info.unlockStars;
}
