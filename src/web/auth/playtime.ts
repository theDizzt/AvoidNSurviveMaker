import type { Account } from './account';
import { supabase } from './supabase';

/** Count and report on this rhythm while the game is open */
const TICK_MS = 30_000;
/** The server accepts at most 1 h per report */
const MAX_REPORT_MS = 3_600_000;
const STORAGE_PREFIX = 'avoid-n-survive:pending-play:';

/**
 * Total time the game is open, per signed-in player.
 *
 * Time counts while the player is signed in and the game tab is visible (menus, editor and play
 * alike); it pauses while the tab is hidden or minimized, so a forgotten background tab doesn't
 * pile up days. Every 30 s, and whenever the tab is hidden or closed, the counted time is sent to
 * the database (`add_play_time` RPC). Unsent time is kept in localStorage per account and sent on
 * the next visit. The server never credits more than real elapsed time, so several open tabs
 * don't double count.
 */
export class PlayTimeTracker {
  private pending = 0;
  private userId: string | null = null;
  /** performance.now() when the current counting stretch started, null while paused */
  private since: number | null = null;
  private sending = false;

  constructor(private readonly account: Account) {
    account.onChange(() => this.syncUser());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.resume();
    });
    window.addEventListener('pagehide', () => this.pause());
    window.setInterval(() => {
      this.collect();
      void this.flush();
    }, TICK_MS);
    this.syncUser();
  }

  /** Send everything counted so far (also called right before signing out) */
  async flush(): Promise<void> {
    this.collect();
    if (!supabase || !this.userId || this.sending || this.pending < 1000) return;
    const userId = this.userId;
    const amount = Math.min(MAX_REPORT_MS, Math.round(this.pending));
    this.sending = true;
    try {
      const { data, error } = await supabase.rpc('add_play_time', { p_ms: amount });
      if (error || typeof data !== 'number' || this.userId !== userId) return; // keep it, retry next tick
      this.pending = Math.max(0, this.pending - amount);
      this.persist();
      this.account.setPlayTotal(data);
    } finally {
      this.sending = false;
    }
  }

  /** Move the time since the last collect into `pending` */
  private collect(): void {
    if (this.since === null) return;
    const now = performance.now();
    this.pending += now - this.since;
    this.since = now;
    this.persist();
  }

  private resume(): void {
    if (this.userId && this.since === null && !document.hidden) this.since = performance.now();
  }

  private pause(): void {
    this.collect();
    this.since = null;
    void this.flush();
  }

  /** Switch the counter when a different player signs in or out */
  private syncUser(): void {
    const id = this.account.profile ? (this.account.user?.id ?? null) : null;
    if (id === this.userId) return;
    this.collect(); // credit the previous player up to now
    this.since = null;
    this.userId = id;
    this.pending = 0;
    if (!id) return;
    try {
      const saved = Number(localStorage.getItem(STORAGE_PREFIX + id));
      if (Number.isFinite(saved) && saved > 0) this.pending = saved;
    } catch {
      /* storage unavailable */
    }
    this.resume();
    if (this.pending >= 1000) void this.flush();
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
