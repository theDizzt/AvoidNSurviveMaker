import { ACHIEVEMENTS, achievementProgress, type AchievementRecord } from '../core/achievements';
import type { Account } from './auth/account';
import { supabase } from './auth/supabase';
import { allRecords } from './progress';

interface Unlock { at: string; seen: boolean; confirmed: boolean }
<<<<<<< HEAD
interface Saved { records: Record<string, AchievementRecord>; unlocks: Record<string, Unlock> }
const PREFIX = 'avoid-n-survive:achievements:v1:';
=======
interface Saved { records: Record<string, AchievementRecord>; unlocks: Record<number, Unlock> }
const PREFIX = 'avoid-n-survive:achievements:v3:';
/** Saves of earlier achievement lists (v2 could hold unlocks converted from v1): only their records are reused */
const LEGACY_PREFIXES = ['avoid-n-survive:achievements:v2:', 'avoid-n-survive:achievements:v1:'];
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06

export class Achievements {
  private owner = 'guest';
  private epoch = 0;
  private request = 0;
  private state: Saved = { records: {}, unlocks: {} };
  private listeners = new Set<() => void>();
  storageAvailable = true;
  syncStatus: 'local' | 'pending' | 'synced' = 'local';
<<<<<<< HEAD
  onUnlock: (ids: string[]) => void = () => {};
=======
  onUnlock: (ids: number[]) => void = () => {};
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06

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
<<<<<<< HEAD
      for (const [id, unlock] of Object.entries(previous.unlocks)) {
=======
      for (const [key, unlock] of Object.entries(previous.unlocks)) {
        const id = Number(key);
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
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
<<<<<<< HEAD
  get unlocks(): Readonly<Record<string, Unlock>> { return this.state.unlocks; }
=======
  get unlocks(): Readonly<Record<number, Unlock>> { return this.state.unlocks; }
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
  subscribe(fn: () => void): void { this.listeners.add(fn); }
  private emit(): void { this.listeners.forEach(fn => fn()); }

  private merge(records: Readonly<Record<string, AchievementRecord>>): void {
<<<<<<< HEAD
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
=======
    for (const [versionedKey, r] of Object.entries(records)) {
      // Personal lifetime achievements count a stable level once, across content revisions.
      const key = versionedKey.split('@')[0];
      if (!r || !Number.isFinite(r.best) || r.best <= 0 || !Number.isFinite(r.stars)) continue;
      const prev = this.state.records[key];
      this.state.records[key] = {
        best: Math.min(prev?.best ?? Infinity, r.best),
        stars: Math.max(prev?.stars ?? 0, Math.min(3, Math.max(0, Math.floor(r.stars)))),
        ...(prev?.crystal || r.crystal === true ? { crystal: true } : {}),
      };
    }
  }

  record(key: string, time: number, stars: number, crystal = false): void {
    this.merge({ [key]: { best: time, stars, ...(crystal ? { crystal: true } : {}) } });
    this.evaluate(true);
  }

  /** The Discord invite was opened: unlock the Discord achievement (and tell the server) */
  claimDiscord(): void {
    const def = ACHIEVEMENTS.find(d => d.kind === 'discord');
    if (!def || this.state.unlocks[def.id]) return;
    this.state.unlocks[def.id] = { at: new Date().toISOString(), seen: false, confirmed: !this.signedIn };
    this.persist();
    this.emit();
    this.onUnlock([def.id]);
    void this.refresh();
  }

  private evaluate(notify: boolean): void {
    const added: number[] = [];
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
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
<<<<<<< HEAD
      const [records, unlocks] = await Promise.all([
        supabase.from('level_records').select('level_key,best_ms,stars').eq('user_id', owner),
=======
      // A Discord visit the server hasn't recorded yet
      const discord = ACHIEVEMENTS.find(d => d.kind === 'discord');
      if (discord && this.state.unlocks[discord.id] && !this.state.unlocks[discord.id].confirmed) {
        await supabase.rpc('claim_discord_achievement');
        if (epoch !== this.epoch || request !== this.request) return;
      }
      const [records, unlocks] = await Promise.all([
        supabase.from('level_records').select('level_key,best_ms,stars,crystal').eq('user_id', owner),
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
        supabase.rpc('refresh_achievements'),
      ]);
      if (epoch !== this.epoch || request !== this.request) return;
      if (!records.error) {
<<<<<<< HEAD
        this.merge(Object.fromEntries((records.data ?? []).map(r => [r.level_key, { best: r.best_ms, stars: r.stars }])));
      }
      if (!unlocks.error) {
=======
        this.merge(Object.fromEntries((records.data ?? []).map(r => [r.level_key, { best: r.best_ms, stars: r.stars, crystal: r.crystal === true }])));
      }
      if (!unlocks.error) {
        // The server's list is the truth: drop confirmed unlocks it no longer has (e.g. the table
        // was emptied). Unconfirmed ones are clears it hasn't seen yet and stay.
        const onServer = new Set(((unlocks.data ?? []) as { achievement_id: number }[]).map(row => row.achievement_id));
        for (const [id, u] of Object.entries(this.state.unlocks)) {
          if (u.confirmed && !onServer.has(Number(id))) delete this.state.unlocks[Number(id)];
        }
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
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
<<<<<<< HEAD
      const raw = JSON.parse(localStorage.getItem(PREFIX + this.owner) ?? '{}');
      if (raw?.records && typeof raw.records === 'object') this.merge(raw.records);
      for (const d of ACHIEVEMENTS) {
        const u = raw?.unlocks?.[d.id];
        if (u && typeof u.at === 'string' && Number.isFinite(Date.parse(u.at))) {
=======
      // Old saves had different achievements: keep their records, drop their unlocks
      for (const prefix of LEGACY_PREFIXES) {
        const old = JSON.parse(localStorage.getItem(prefix + this.owner) ?? '{}')?.records;
        if (old && typeof old === 'object') this.merge(old);
      }
      const raw = JSON.parse(localStorage.getItem(PREFIX + this.owner) ?? '{}');
      if (raw?.records && typeof raw.records === 'object') this.merge(raw.records);
      for (const d of ACHIEVEMENTS) {
        const u = raw?.unlocks?.[d.id] as Partial<Unlock> | undefined;
        // A saved unlock the records don't support is kept only if the server confirmed it
        // (the next refresh checks it again) or it can't be derived from records (Discord)
        const earned = d.kind === 'discord' || (this.signedIn && u?.confirmed === true)
          || achievementProgress(d, this.state.records) >= d.target;
        if (u && earned && typeof u.at === 'string' && Number.isFinite(Date.parse(u.at))) {
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
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
