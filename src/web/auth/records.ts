import { t } from '../i18n';
import { allRecords, guestRecords, mergeRecords, setOnRecord, setProgressUser, type LevelRecord } from '../progress';
import type { Account } from './account';
import { supabase } from './supabase';
import { recordTime } from '../../core/time';
import { clearLeaderboardCache } from './leaderboard';

const PENDING_PREFIX = 'avoid-n-survive:pending-records:';
/** The server accepts at most this many records per call */
const BATCH = 2000;

interface ServerRecord {
  level_key: string;
  best_ms: number;
  stars: number;
  /** Only once the crystal-star migration (20261120000000) is applied */
  crystal?: boolean;
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
    .map(([key, r]) => ({ key, best_ms: recordTime(r.best), stars: r.stars, crystal: !!r.crystal }));

/**
 * Best time (ms) and stars per level, saved to the signed-in player's account.
 *
 * Every clear is uploaded right away (kept in localStorage per account until the server accepts it).
 * "Sync records" in Options merges both ways: this account's local records go up, and its server
 * records come down. Both sides keep the best time and the most stars.
 */
export class RecordSync {
  onSaved: () => void = () => {};
  private userId: string | null = null;
  private pending: Record<string, LevelRecord> = {};
  private sending = false;
  private generation = 0;

  constructor(private readonly account: Account) {
    setOnRecord((key, record) => {
      if (!this.userId) return;
      const previous = this.pending[key];
      this.pending[key] = {
        best: Math.min(previous?.best ?? Infinity, record.best),
        stars: Math.max(previous?.stars ?? 0, record.stars),
        ...(previous?.crystal || record.crystal ? { crystal: true } : {}),
      };
      this.persist();
      void this.flush();
    });
    account.onChange(() => this.syncUser());
    window.addEventListener('online', () => void this.flush());
    this.syncUser();
  }

  get available(): boolean {
    return !!supabase && !!this.userId;
  }

  get canImportGuest(): boolean {
    return this.available && Object.keys(guestRecords()).length > 0;
  }

  /** Explicitly copy guest/legacy records into this account, preserving both bests. */
  importGuest(): void {
    if (!this.available) return;
    mergeRecords(guestRecords());
    for (const key of Object.keys(guestRecords())) this.pending[key] = allRecords()[key];
    this.persist();
    this.onSaved();
    void this.flush();
  }

  /** Pin requests to the snapshot's session, even if auth changes before fetch starts. */
  private async token(userId: string, generation: number): Promise<string> {
    const session = (await supabase!.auth.getSession()).data.session;
    if (generation !== this.generation || session?.user.id !== userId) throw new Error('ACCOUNT_CHANGED');
    return session.access_token;
  }

  /** The signed-in player's records straight from the database (null when it can't be read) */
  async fetchAccountRecords(): Promise<AccountRecord[] | null> {
    if (!supabase || !this.userId) return null;
    const generation = this.generation;
    const { data, error } = await supabase
      .from('level_records')
      .select('level_key, best_ms, stars, created_at, updated_at')
      .eq('user_id', this.userId)
      .order('level_key');
    return error || generation !== this.generation ? null : ((data as AccountRecord[] | null) ?? []);
  }

  /** Sync only the active account's records; guest records require explicit import. */
  async syncAll(): Promise<SyncResult> {
    if (!supabase || !this.userId) return { ok: false, message: t('records.signIn') };
    const userId = this.userId;
    const generation = this.generation;
    const sent = { ...this.pending };
    const snapshot = { ...allRecords() };
    for (const [key, r] of Object.entries(sent)) {
      const prev = snapshot[key];
      snapshot[key] = {
        best: Math.min(prev?.best ?? Infinity, r.best),
        stars: Math.max(prev?.stars ?? 0, r.stars),
        ...(prev?.crystal || r.crystal ? { crystal: true } : {}),
      };
    }
    const payload = toPayload(snapshot);
    let rows: ServerRecord[] = [];
    try {
      for (let i = 0; i === 0 || i < payload.length; i += BATCH) {
        const token = await this.token(userId, generation);
        const { data, error } = await supabase.rpc('submit_level_records', { p_records: payload.slice(i, i + BATCH) })
          .setHeader('Authorization', `Bearer ${token}`);
        if (generation !== this.generation) return { ok: false, message: t('records.accountChanged') };
        if (error) return { ok: false, message: /failed to fetch|network/i.test(error.message) ? t('net.unreachable') : t('records.syncFailed') };
        rows = (data as ServerRecord[] | null) ?? [];
      }
    } catch (err) {
      if (generation !== this.generation || (err as Error).message === 'ACCOUNT_CHANGED') return { ok: false, message: t('records.accountChanged') };
      return { ok: false, message: t('net.unreachable') };
    }
    if (this.userId !== userId) return { ok: false, message: t('records.accountChanged') };
    for (const [k, r] of Object.entries(sent)) if (this.pending[k] === r) delete this.pending[k];
    this.persist();
    const downloaded = this.acceptServerRecords(rows);
    return { ok: true, uploaded: payload.length, downloaded };
  }

  /**
   * Send records from clears that haven't reached the server yet. `download`: also when there
   * is nothing to send, to bring the account's records into this browser (sign-in)
   */
  private async flush(download = false): Promise<void> {
    const payload = toPayload(this.pending);
    if (!supabase || !this.userId || this.sending || (payload.length === 0 && !download)) return;
    const userId = this.userId;
    const generation = this.generation;
    const batch = payload.slice(0, BATCH);
    const sent = Object.fromEntries(batch.map((r) => [r.key, this.pending[r.key]]));
    this.sending = true;
    try {
      const token = await this.token(userId, generation);
      const { data, error } = await supabase.rpc('submit_level_records', { p_records: batch })
        .setHeader('Authorization', `Bearer ${token}`);
      if (error || generation !== this.generation) return; // keep them, retry on the next clear or sign-in
      for (const [k, r] of Object.entries(sent)) if (this.pending[k] === r) delete this.pending[k];
      this.persist();
      this.acceptServerRecords((data as ServerRecord[] | null) ?? []);
      // Clears that arrived while this request was out
      if (Object.keys(this.pending).length) queueMicrotask(() => void this.flush());
    } catch {
      /* offline: retried later */
    } finally {
      this.sending = false;
      // A different account may have queued records while the previous request was in flight.
      if (generation !== this.generation && this.userId) void this.flush(true);
    }
  }

  private acceptServerRecords(rows: ServerRecord[]): number {
    clearLeaderboardCache();
    // Do not overwrite a newer clear that has not reached the server yet.
    const changed = mergeRecords(Object.fromEntries(rows
      .filter((r) => !this.pending[r.level_key])
      .map((r) => [r.level_key, { best: r.best_ms, stars: r.stars, ...(r.crystal ? { crystal: true } : {}) }])), true);
    this.onSaved();
    return changed;
  }

  private syncUser(): void {
    const id = this.account.user?.id ?? null;
    if (id === this.userId) return;
    this.userId = id;
    this.generation++;
    setProgressUser(id);
    this.pending = {};
    if (!id) {
      this.onSaved();
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_PREFIX + id) ?? '{}') as Record<string, LevelRecord>;
      if (saved && typeof saved === 'object') this.pending = saved;
    } catch {
      /* storage unavailable or unreadable */
    }
    mergeRecords(this.pending);
    this.onSaved();
    // Signing in on any browser brings the account's records down
    void this.flush(true);
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
