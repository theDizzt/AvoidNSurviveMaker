import { ACHIEVEMENTS, achievementProgress, type AchievementRecord } from '../core/achievements';
import type { Account } from './auth/account';
import { supabase } from './auth/supabase';
import { allRecords } from './progress';

interface Unlock { at: string; seen: boolean; confirmed: boolean }
interface Saved { records: Record<string, AchievementRecord>; unlocks: Record<string, Unlock> }
const PREFIX = 'avoid-n-survive:achievements:v1:';

export class Achievements {
  private owner = 'guest';
  private epoch = 0;
  private request = 0;
  private state: Saved = { records: {}, unlocks: {} };
  private listeners = new Set<() => void>();
  storageAvailable = true;
  syncStatus: 'local' | 'pending' | 'synced' = 'local';
  onUnlock: (ids: string[]) => void = () => {};

  constructor(account: Account) {
    this.load();
    account.onChange(() => {
      const owner = account.user?.id ?? 'guest';
      if (owner === this.owner) return;
      this.owner = owner;
      this.epoch++;
      this.load();
      // Never seed a signed-in account from the shared campaign cache.
      if (owner !== 'guest') this.loadPending();
      this.evaluate(false);
      this.emit();
      void this.refresh();
    });
    window.addEventListener('online', () => void this.refresh());
    window.addEventListener('storage', event => {
      if (event.key !== PREFIX + this.owner || !event.newValue) return;
      const previous = this.state;
      this.load();
      this.merge(previous.records);
      for (const [id, unlock] of Object.entries(previous.unlocks)) {
        const incoming = this.state.unlocks[id];
        if (!incoming) this.state.unlocks[id] = unlock;
        else incoming.seen ||= unlock.seen;
      }
      this.emit();
    });
  }

  /** Migrate legacy browser progress only once, after the initial auth session is known. */
  initializeGuest(): void {
    if (this.signedIn) return;
    try {
      if (!localStorage.getItem(PREFIX + 'guest')) this.merge(allRecords());
    } catch { this.storageAvailable = false; }
    this.evaluate(false);
  }

  get signedIn(): boolean { return this.owner !== 'guest'; }
  get records(): Readonly<Record<string, AchievementRecord>> { return this.state.records; }
  get unlocks(): Readonly<Record<string, Unlock>> { return this.state.unlocks; }
  subscribe(fn: () => void): void { this.listeners.add(fn); }
  private emit(): void { this.listeners.forEach(fn => fn()); }

  private merge(records: Readonly<Record<string, AchievementRecord>>): void {
    for (const [key, r] of Object.entries(records)) {
      if (!r || !Number.isFinite(r.best) || r.best <= 0 || !Number.isFinite(r.stars)) continue;
      const prev = this.state.records[key];
      this.state.records[key] = { best: Math.min(prev?.best ?? Infinity, r.best), stars: Math.max(prev?.stars ?? 0, Math.min(3, Math.max(0, Math.floor(r.stars)))) };
    }
  }

  record(key: string, time: number, stars: number): void {
    this.merge({ [key]: { best: time, stars } });
    this.evaluate(true);
  }

  private evaluate(notify: boolean): void {
    const added: string[] = [];
    for (const def of ACHIEVEMENTS) {
      if (!this.state.unlocks[def.id] && achievementProgress(def, this.state.records) >= def.target) {
        this.state.unlocks[def.id] = { at: new Date().toISOString(), seen: false, confirmed: !this.signedIn };
        added.push(def.id);
      }
    }
    this.persist();
    this.emit();
    if (notify && added.length) this.onUnlock(added);
  }

  markSeen(): void {
    Object.values(this.state.unlocks).forEach(u => u.seen = true);
    this.persist();
    this.emit();
  }

  async refresh(): Promise<void> {
    if (!this.signedIn || !supabase) return;
    const owner = this.owner, epoch = this.epoch, request = ++this.request;
    this.syncStatus = 'pending';
    this.emit();
    try {
      const [records, unlocks] = await Promise.all([
        supabase.from('level_records').select('level_key,best_ms,stars').eq('user_id', owner),
        supabase.rpc('refresh_achievements'),
      ]);
      if (epoch !== this.epoch || request !== this.request) return;
      if (!records.error) {
        this.merge(Object.fromEntries((records.data ?? []).map(r => [r.level_key, { best: r.best_ms, stars: r.stars }])));
      }
      if (!unlocks.error) {
        for (const row of unlocks.data ?? []) {
          if (!ACHIEVEMENTS.some(d => d.id === row.achievement_id)) continue;
          this.state.unlocks[row.achievement_id] = { at: row.unlocked_at, seen: this.state.unlocks[row.achievement_id]?.seen ?? false, confirmed: true };
        }
      }
      this.syncStatus = records.error || unlocks.error ? 'pending' : 'synced';
      this.evaluate(false);
      if (Object.values(this.state.unlocks).some(u => !u.confirmed)) {
        this.syncStatus = 'pending';
        this.emit();
      }
    } catch {
      if (epoch === this.epoch && request === this.request) { this.syncStatus = 'pending'; this.emit(); }
    }
  }

  private loadPending(): void {
    try { this.merge(JSON.parse(localStorage.getItem('avoid-n-survive:pending-records:' + this.owner) ?? '{}')); } catch { /* keep cached progress */ }
  }
  private load(): void {
    this.state = { records: {}, unlocks: {} };
    this.storageAvailable = true;
    this.syncStatus = this.signedIn ? 'pending' : 'local';
    try {
      const raw = JSON.parse(localStorage.getItem(PREFIX + this.owner) ?? '{}');
      if (raw?.records && typeof raw.records === 'object') this.merge(raw.records);
      for (const d of ACHIEVEMENTS) {
        const u = raw?.unlocks?.[d.id];
        if (u && typeof u.at === 'string' && Number.isFinite(Date.parse(u.at))) {
          this.state.unlocks[d.id] = { at: u.at, seen: u.seen === true, confirmed: u.confirmed === true };
        }
      }
    } catch { /* damaged saves are rebuilt from records */ }
  }
  private persist(): void {
    try { localStorage.setItem(PREFIX + this.owner, JSON.stringify(this.state)); }
    catch { this.storageAvailable = false; }
  }
}
