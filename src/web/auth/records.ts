import { allRecords, mergeRecords, setOnRecord, type LevelRecord } from '../progress';
import type { Account } from './account';
import { supabase } from './supabase';

const PENDING_PREFIX = 'avoid-n-survive:pending-records:';
/** The server accepts at most this many records per call */
const BATCH = 2000;

interface ServerRecord {
  level_key: string;
  best_ms: number;
  stars: number;
}

/** A level record as stored in the database */
export interface AccountRecord {
  level_key: string;
  best_ms: number;
  stars: number;
  created_at: string;
  updated_at: string;
}

export type SyncResult = { ok: true; uploaded: number; downloaded: number } | { ok: false; message: string };

const toPayload = (records: Record<string, LevelRecord>) =>
  Object.entries(records)
    .filter(([, r]) => Number.isFinite(r.best) && r.best > 0)
    .map(([key, r]) => ({ key, best_ms: Math.max(1, Math.round(r.best)), stars: r.stars }));

/**
 * Best time (ms) and stars per level, saved to the signed-in player's account.
 *
 * Every clear is uploaded right away (kept in localStorage per account until the server accepts it).
 * "Sync records" in Options merges both ways: records kept in this browser go up, and the account's
 * records come down. Both sides keep the best time and the most stars.
 */
export class RecordSync {
  private userId: string | null = null;
  private pending: Record<string, LevelRecord> = {};
  private sending = false;

  constructor(private readonly account: Account) {
    setOnRecord((key, record) => {
      if (!this.userId) return;
      this.pending[key] = record;
      this.persist();
      void this.flush();
    });
    account.onChange(() => this.syncUser());
    this.syncUser();
  }

  get available(): boolean {
    return !!supabase && !!this.userId;
  }

  /** The signed-in player's records straight from the database (null when it can't be read) */
  async fetchAccountRecords(): Promise<AccountRecord[] | null> {
    if (!supabase || !this.userId) return null;
    const { data, error } = await supabase
      .from('level_records')
      .select('level_key, best_ms, stars, created_at, updated_at')
      .eq('user_id', this.userId)
      .order('level_key');
    return error ? null : ((data as AccountRecord[] | null) ?? []);
  }

  /** Upload every local record, then bring the account's records into this browser */
  async syncAll(): Promise<SyncResult> {
    if (!supabase || !this.userId) return { ok: false, message: 'Sign in to sync your records.' };
    const userId = this.userId;
    const payload = toPayload({ ...allRecords(), ...this.pending });
    let rows: ServerRecord[] = [];
    try {
      for (let i = 0; i === 0 || i < payload.length; i += BATCH) {
        const { data, error } = await supabase.rpc('submit_level_records', { p_records: payload.slice(i, i + BATCH) });
        if (error) return { ok: false, message: /failed to fetch|network/i.test(error.message) ? "Can't reach the server. Check your connection." : "Couldn't sync records. Please try again." };
        rows = (data as ServerRecord[] | null) ?? [];
      }
    } catch {
      return { ok: false, message: "Can't reach the server. Check your connection." };
    }
    if (this.userId !== userId) return { ok: false, message: 'The signed-in account changed. Please try again.' };
    this.pending = {};
    this.persist();
    const downloaded = mergeRecords(Object.fromEntries(rows.map((r) => [r.level_key, { best: r.best_ms, stars: r.stars }])));
    return { ok: true, uploaded: payload.length, downloaded };
  }

  /** Send records from clears that haven't reached the server yet */
  private async flush(): Promise<void> {
    const payload = toPayload(this.pending);
    if (!supabase || !this.userId || this.sending || payload.length === 0) return;
    const userId = this.userId;
    const batch = payload.slice(0, BATCH);
    const sent = Object.fromEntries(batch.map((r) => [r.key, this.pending[r.key]]));
    this.sending = true;
    try {
      const { error } = await supabase.rpc('submit_level_records', { p_records: batch });
      if (error || this.userId !== userId) return; // keep them, retry on the next clear or sign-in
      for (const [k, r] of Object.entries(sent)) if (this.pending[k] === r) delete this.pending[k];
      this.persist();
      // Clears that arrived while this request was out
      if (Object.keys(this.pending).length) queueMicrotask(() => void this.flush());
    } catch {
      /* offline: retried later */
    } finally {
      this.sending = false;
    }
  }

  private syncUser(): void {
    const id = this.account.profile ? (this.account.user?.id ?? null) : null;
    if (id === this.userId) return;
    this.userId = id;
    this.pending = {};
    if (!id) return;
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_PREFIX + id) ?? '{}') as Record<string, LevelRecord>;
      if (saved && typeof saved === 'object') this.pending = saved;
    } catch {
      /* storage unavailable or unreadable */
    }
    void this.flush();
  }

  private persist(): void {
    if (!this.userId) return;
    try {
      if (Object.keys(this.pending).length) localStorage.setItem(PENDING_PREFIX + this.userId, JSON.stringify(this.pending));
      else localStorage.removeItem(PENDING_PREFIX + this.userId);
    } catch {
      /* storage unavailable */
    }
  }
}
