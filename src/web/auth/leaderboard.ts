import { supabase } from './supabase';

/** One row of a level's leaderboard (verified records only) */
export interface LeaderboardRow {
  place: number;
  nickname: string;
  discriminator: number;
  best_ms: number;
  stars: number;
  /** The signed-in player's own record */
  is_me: boolean;
}

export type LeaderboardResult =
  | { ok: true; rows: LeaderboardRow[] }
  | { ok: false; reason: 'unconfigured' | 'unavailable' };

/** Reuse a fetched board for this long, so hovering back and forth doesn't refetch */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; result: Promise<LeaderboardResult> }>();

/**
 * Top verified records of an official chapter level (`level_leaderboard` RPC,
 * supabase/migrations/20261118020000_leaderboard.sql), plus the player's own place.
 */
export function fetchLeaderboard(levelKey: string, limit = 10): Promise<LeaderboardResult> {
  if (!supabase) return Promise.resolve({ ok: false, reason: 'unconfigured' });
  const hit = cache.get(levelKey);
  if (hit && performance.now() - hit.at < CACHE_MS) return hit.result;
  const result = (async (): Promise<LeaderboardResult> => {
    try {
      const { data, error } = await supabase!.rpc('level_leaderboard', { p_key: levelKey, p_limit: limit });
      if (error) return { ok: false, reason: 'unavailable' };
      const rows = ((data as LeaderboardRow[] | null) ?? []).map((r) => ({
        ...r, place: Number(r.place), best_ms: Number(r.best_ms), stars: Number(r.stars), discriminator: Number(r.discriminator),
      }));
      return { ok: true, rows };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  })();
  cache.set(levelKey, { at: performance.now(), result });
  // Don't keep failures: the next hover tries again
  void result.then((r) => { if (!r.ok) cache.delete(levelKey); });
  return result;
}

/** Forget cached boards (e.g. after signing in, so "you" is marked) */
export function clearLeaderboardCache(): void {
  cache.clear();
}
