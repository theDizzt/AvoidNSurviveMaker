import type { Account } from './account';
import { supabase } from './supabase';

const STORAGE_PREFIX = 'avoid-n-survive:pending-deaths:';
/** Wait this long after a death before reporting, so a burst of quick retries is one request */
const REPORT_DELAY_MS = 3000;
/** The server accepts at most this much per report */
const MAX_TOTAL = 10000;
const MAX_LEVELS = 200;

/** Deaths not yet accepted by the server */
interface Pending {
  /** Deaths on any map */
  total: number;
  /** The part of `total` on chapter / custom pack levels, by level key */
  levels: Record<string, number>;
}

/** The signed-in player's death counts as stored in the database */
export interface AccountDeaths {
  total: number;
  levels: Record<string, number>;
}

const empty = (): Pending => ({ total: 0, levels: {} });

/**
 * Death counts per signed-in player: a running total and a count per level
 * (supabase/migrations/20261118010000_deaths.sql).
 *
 * Each death is added to a pending count kept in localStorage per account, then reported with the
 * `add_deaths` RPC a few seconds later (and when the tab is hidden or the player signs out). Only
 * what the server accepted is taken off the pending count, so deaths made offline are sent on the
 * next visit. Deaths while signed out aren't recorded.
 */
export class DeathTracker {
  private userId: string | null = null;
  private pending: Pending = empty();
  private sending = false;
  private timer: number | undefined;

  constructor(private readonly account: Account) {
    account.onChange(() => this.syncUser());
    document.addEventListener('visibilitychange', () => document.hidden && void this.flush());
    window.addEventListener('pagehide', () => void this.flush());
    this.syncUser();
  }

  /** Count one death; `levelKey` is the progress key of a chapter / custom pack level, or null */
  record(levelKey: string | null): void {
    if (!this.userId) return;
    this.pending.total++;
    if (levelKey) this.pending.levels[levelKey] = (this.pending.levels[levelKey] ?? 0) + 1;
    this.persist();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), REPORT_DELAY_MS);
  }

  /** Deaths counted here that the server hasn't accepted yet (added to what Stats shows) */
  get unsent(): Readonly<Pending> {
    return this.pending;
  }

  /** The signed-in player's counts straight from the database (null when they can't be read) */
  async fetchAccountDeaths(): Promise<AccountDeaths | null> {
    if (!supabase || !this.userId) return null;
    const [profile, rows] = await Promise.all([
      supabase.from('profiles').select('total_deaths').eq('id', this.userId).maybeSingle(),
      supabase.from('level_deaths').select('level_key, deaths').eq('user_id', this.userId),
    ]);
    if (profile.error || rows.error) return null;
    const data = (rows.data as { level_key: string; deaths: number }[] | null) ?? [];
    return {
      total: Number((profile.data as { total_deaths?: number } | null)?.total_deaths ?? 0),
      levels: Object.fromEntries(data.map((r) => [r.level_key, Number(r.deaths)])),
    };
  }

  /** Report pending deaths (also called right before signing out) */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (!supabase || !this.userId || this.sending || this.pending.total < 1) return;
    const userId = this.userId;
    // pending.total = (sum of level counts) + (deaths on maps without a level key). One report
    // carries up to MAX_LEVELS levels and MAX_TOTAL deaths; the rest goes in the next one.
    const allLevels = Object.values(this.pending.levels).reduce((s, n) => s + n, 0);
    const other = Math.max(0, this.pending.total - allLevels);
    const levels: { key: string; count: number }[] = [];
    let levelSum = 0;
    for (const [key, n] of Object.entries(this.pending.levels).slice(0, MAX_LEVELS)) {
      const count = Math.min(n, MAX_TOTAL - levelSum);
      if (count < 1) break;
      levels.push({ key, count });
      levelSum += count;
    }
    const total = levelSum + Math.min(other, MAX_TOTAL - levelSum);
    this.sending = true;
    try {
      const { error } = await supabase.rpc('add_deaths', { p_total: total, p_levels: levels });
      if (error || this.userId !== userId) return; // keep them, retry on the next death or visit
      this.pending.total = Math.max(0, this.pending.total - total);
      for (const { key, count } of levels) {
        const left = (this.pending.levels[key] ?? 0) - count;
        if (left > 0) this.pending.levels[key] = left;
        else delete this.pending.levels[key];
      }
      this.persist();
      if (this.pending.total > 0) queueMicrotask(() => void this.flush()); // more than one report's worth
    } catch {
      /* offline: retried later */
    } finally {
      this.sending = false;
    }
  }

  private syncUser(): void {
    const id = this.account.profile ? (this.account.user?.id ?? null) : null;
    if (id === this.userId) return;
    window.clearTimeout(this.timer);
    this.userId = id;
    this.pending = empty();
    if (!id) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + id) ?? 'null') as Partial<Pending> | null;
      if (saved && Number.isFinite(saved.total) && saved.total! > 0) {
        const levels: Record<string, number> = {};
        for (const [k, v] of Object.entries(saved.levels ?? {})) if (Number.isInteger(v) && v > 0) levels[k] = v;
        const levelSum = Object.values(levels).reduce((s, n) => s + n, 0);
        this.pending = { total: Math.max(Math.floor(saved.total!), levelSum), levels };
      }
    } catch {
      /* storage unavailable or unreadable */
    }
    void this.flush();
  }

  private persist(): void {
    if (!this.userId) return;
    try {
      if (this.pending.total > 0) localStorage.setItem(STORAGE_PREFIX + this.userId, JSON.stringify(this.pending));
      else localStorage.removeItem(STORAGE_PREFIX + this.userId);
    } catch {
      /* storage unavailable */
    }
  }
}
