import type { Account } from './account';
import { supabase } from './supabase';

/** Send once this much unreported time has piled up… */
const FLUSH_AT_MS = 15_000;
/** …or at least this often while there is anything pending */
const FLUSH_EVERY_MS = 30_000;
/** The server accepts at most 1 h per report */
const MAX_REPORT_MS = 3_600_000;
const STORAGE_PREFIX = 'avoid-n-survive:pending-play:';

/**
 * Adds up the length of every run and reports it to the database in batches
 * (`add_play_time` RPC). Only signed-in players are tracked. Unsent time is kept in
 * localStorage per account, so closing the tab mid-batch doesn't lose it; it's sent next visit.
 */
export class PlayTimeTracker {
  private pending = 0;
  private userId: string | null = null;
  private sending = false;
  private timer = 0;

  constructor(private readonly account: Account) {
    account.onChange(() => this.syncUser());
    this.syncUser();
    // Leaving or hiding the page is the last good moment to send
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.flush();
    });
    window.addEventListener('pagehide', () => void this.flush());
  }

  /** Record a finished run */
  add(ms: number): void {
    if (!this.userId || !(ms > 0)) return;
    this.pending += ms;
    this.persist();
    if (this.pending >= FLUSH_AT_MS) void this.flush();
    else this.schedule();
  }

  /** Send everything pending now (also called before signing out) */
  async flush(): Promise<void> {
    if (!supabase || !this.userId || this.sending || this.pending < 1) return;
    const userId = this.userId;
    const amount = Math.min(MAX_REPORT_MS, Math.round(this.pending));
    this.sending = true;
    try {
      const { data, error } = await supabase.rpc('add_play_time', { p_ms: amount });
      if (error || typeof data !== 'number') return; // keep it pending, retry later
      if (this.userId !== userId) return;
      this.pending = Math.max(0, this.pending - amount);
      this.persist();
      this.account.setPlayTotal(data);
    } finally {
      this.sending = false;
      if (this.pending >= 1) this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.flush();
    }, FLUSH_EVERY_MS);
  }

  /** Switch the pending bucket when a different player signs in or out */
  private syncUser(): void {
    const id = this.account.profile ? (this.account.user?.id ?? null) : null;
    if (id === this.userId) return;
    this.userId = id;
    this.pending = 0;
    if (!id) return;
    try {
      const saved = Number(localStorage.getItem(STORAGE_PREFIX + id));
      if (Number.isFinite(saved) && saved > 0) this.pending = saved;
    } catch {
      /* storage unavailable */
    }
    if (this.pending > 0) void this.flush();
  }

  private persist(): void {
    if (!this.userId) return;
    try {
      if (this.pending > 0) localStorage.setItem(STORAGE_PREFIX + this.userId, String(Math.round(this.pending)));
      else localStorage.removeItem(STORAGE_PREFIX + this.userId);
    } catch {
      /* storage unavailable */
    }
  }
}
