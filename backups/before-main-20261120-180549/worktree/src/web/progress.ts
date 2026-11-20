import { gameplayKey, starsFor } from './localized/level';
import { recordTime } from '../core/time';
import { CRYSTALS_PER_THEME, filledSlots, levelAt, STARS_PER_LEVEL, type ThemeEntry } from './localized/theme-pack';
import { recordIdentity, SHARED_LEVEL_KEYS } from '../core/record-identity';
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

/** Loaded at the end of this module, once the level keys below can be computed */
let records: Record<string, LevelRecord> = {};

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
    moveSharedKeys(out, storageKey(user));
    // Chapter 1 reuses the old Pastel maps; carry existing records forward once.
    for (const [k, record] of Object.entries(out)) {
      if (k.startsWith('pastel/')) out[k.replace(/^pastel\//, 'workshop/')] ??= record;
    }
    return currentRecords(out);
  } catch {
    return {};
  }
}

/**
 * Once per save: records under keys several levels shared by mistake move to the level they
 * belong to (SHARED_LEVEL_KEYS), keeping the better of two. Written back right away, with a flag,
 * so a later record of the level that now owns the old key is never moved.
 */
function moveSharedKeys(out: Record<string, LevelRecord>, store: string): void {
  const flag = `${store}:shared-keys-moved`;
  try {
    if (localStorage.getItem(flag)) return;
    let moved = false;
    for (const [from, to] of SHARED_LEVEL_KEYS) {
      for (const k of Object.keys(out)) {
        if (k.split('@')[0] !== from) continue;
        const r = out[k];
        const prev = out[to];
        out[to] = prev ? {
          stars: Math.max(prev.stars, r.stars),
          best: Math.min(prev.best, r.best),
          ...(prev.crystal || r.crystal ? { crystal: true } : {}),
        } : r;
        delete out[k];
        moved = true;
      }
    }
    if (moved) localStorage.setItem(store, JSON.stringify(out));
    localStorage.setItem(flag, '1');
  } catch {
    /* storage unavailable: nothing saved to move */
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

const identityCache = new WeakMap<MapData, { signature: string; keys: Map<string, string> }>();
/** Cache hashing, but also detect maps edited in place by the theme editor. */
export function levelKey(theme: ThemeEntry, index: number): string {
  const map = levelAt(theme, index);
  if (!map) return `empty:${theme.info.id}/${index}`;
  const scope = `${theme.official}:${theme.info.id}`;
  const signature = `${map.id ?? ''}:${gameplayKey(map)}:${JSON.stringify(map.stars ?? null)}`;
  let cached = identityCache.get(map);
  if (!cached || cached.signature !== signature) identityCache.set(map, cached = { signature, keys: new Map() });
  let key = cached.keys.get(scope);
  if (!key) cached.keys.set(scope, key = recordIdentity(theme.info.id, map, theme.official));
  return key;
}
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
<<<<<<< HEAD
  // Send this run, not a best record potentially belonging to another local player.
  onRecord(k, { stars, best: time });
=======
  // Queue this run independently of any previously uploaded best.
  onRecord(k, { stars, best: time, ...(crystal ? { crystal: true } : {}) });
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
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
  incoming = currentRecords(incoming);
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

/**
 * Official level key → the key of that level now. Older saves keyed official levels by slot
 * ("workshop/0") or by an earlier revision of the map ("workshop/0@<old hash>"); their records
 * carry over to the current revision, so a map update never hides a player's progress.
 */
let currentKeys: Map<string, string> | null = null;
function currentKey(k: string): string {
  if (k.startsWith('custom:') || k.startsWith('empty:')) return k;
  if (!currentKeys) {
    const keys = new Map<string, string>();
    for (const theme of OFFICIAL_THEMES) {
      for (const i of filledSlots(theme)) keys.set(levelKey(theme, i).split('@')[0], levelKey(theme, i));
    }
    for (const theme of OFFICIAL_THEMES) {
      for (const i of filledSlots(theme)) if (!keys.has(`${theme.info.id}/${i}`)) keys.set(`${theme.info.id}/${i}`, levelKey(theme, i));
    }
    currentKeys = keys;
  }
  return currentKeys.get(k.split('@')[0]) ?? k;
}

/** Re-key records to the current levels, keeping the best of any that land on the same level */
function currentRecords(input: Record<string, LevelRecord>): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {};
  for (const [k, r] of Object.entries(input)) {
    const to = currentKey(k);
    const prev = out[to];
    out[to] = prev ? {
      stars: Math.max(prev.stars, r.stars),
      best: Math.min(prev.best, r.best),
      ...(prev.crystal || r.crystal ? { crystal: true } : {}),
    } : r;
  }
  return out;
}

records = load();
