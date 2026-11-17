import { formatPlayTime } from '../core/account';
import { formatTime } from '../core/simulation';
import { formatUtc } from '../core/time';
import { levelSlots, STARS_PER_LEVEL } from '../core/theme-pack';
import type { Account } from './auth/account';
import type { AccountDeaths, DeathTracker } from './auth/deaths';
import type { AccountRecord, RecordSync } from './auth/records';
import { levelKey } from './progress';
import { renderTag } from './player-tag';
import { customTheme, OFFICIAL_THEMES } from './theme-registry';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const date = formatUtc;
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, STARS_PER_LEVEL - n));

/** Short name of a level key: 'Ch.01-4' for chapters, 'Custom 4' for custom packs */
function levelName(key: string): string {
  const m = /^(custom:)?(.+)\/(\d+)$/.exec(key);
  if (!m) return key;
  const n = Number(m[3]) + 1;
  if (m[1]) return `Custom ${n}`;
  const ch = OFFICIAL_THEMES.findIndex((t) => t.info.id === m[2]);
  return ch >= 0 ? `Ch.${String(ch + 1).padStart(2, '0')}-${n}` : `${m[2]} ${n}`;
}

/** The per-level record tables are built but kept hidden for now; flip to show them again. */
const SHOW_LEVEL_RECORDS = false;

type StatField = 'stars' | 'stars-note' | 'player' | 'player-note' | 'time' | 'time-note' | 'cleared' | 'cleared-note' | 'last' | 'deaths' | 'deaths-note';

/**
 * Personal stats: everything the database holds for the signed-in player at a glance —
 * profile (tag, sign-up date, play time), death counts and level record totals, shown on the diamond tiles of
 * #stats-dia ([data-stat] slots). The per-level tables go to `list` (hidden, see SHOW_LEVEL_RECORDS).
 */
export class StatsUI {
  private loading = 0;

  constructor(
    private readonly grid: HTMLElement,
    private readonly status: HTMLElement,
    private readonly list: HTMLElement,
    private readonly account: Account,
    private readonly records: RecordSync,
    private readonly deaths: DeathTracker,
  ) {}

  private set(field: StatField, text: string): void {
    const slot = this.grid.querySelector<HTMLElement>(`[data-stat="${field}"]`);
    if (slot) slot.textContent = text;
  }

  private clear(): void {
    for (const slot of this.grid.querySelectorAll<HTMLElement>('[data-stat]')) slot.textContent = slot.dataset.stat!.endsWith('-note') ? '' : '—';
    this.set('stars-note', 'stars');
    this.list.replaceChildren();
    this.list.hidden = true;
  }

  async render(): Promise<void> {
    const run = ++this.loading;
    this.clear();
    if (!this.account.configured) return this.message('Accounts are not set up, so there is nothing stored in the database.');
    const profile = this.account.profile;
    if (!profile) return this.message('Sign in to see the stats saved to your account.');
    this.message('Loading records…');
    const [rows, serverDeaths] = await Promise.all([this.records.fetchAccountRecords(), this.deaths.fetchAccountDeaths()]);
    if (run !== this.loading) return; // a newer render started
    if (!rows) return this.message("Couldn't load records from the database. Check your connection and try again.");

    const byKey = new Map(rows.map((r) => [r.level_key, r]));
    const totalStars = rows.reduce((s, r) => s + r.stars, 0);
    const perfect = rows.filter((r) => r.stars >= STARS_PER_LEVEL).length;
    const lastUpdate = rows.reduce<string | undefined>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), undefined);
    const officialMax = OFFICIAL_THEMES.reduce((s, t) => s + levelSlots(t) * STARS_PER_LEVEL, 0);

    this.message('Everything saved to your account.');
    this.set('stars', String(totalStars));
    this.set('stars-note', `of ${officialMax} in chapters`);
    const player = this.grid.querySelector<HTMLElement>('[data-stat="player"]');
    if (player) renderTag(player, this.account.tag ?? '—');
    this.set('player-note', `Joined ${date(profile.created_at)}`);
    this.set('time', formatPlayTime(profile.total_play_seconds));
    this.set('time-note', `${profile.total_play_seconds.toLocaleString()} s`);
    this.set('cleared', String(rows.length));
    this.set('cleared-note', `${perfect} with all stars`);
    this.set('last', date(lastUpdate));
    const deaths = serverDeaths && this.withUnsent(serverDeaths);
    if (deaths) {
      this.set('deaths', deaths.total.toLocaleString());
      const worst = Object.entries(deaths.levels).sort((a, b) => b[1] - a[1])[0];
      this.set('deaths-note', worst ? `Most: ${levelName(worst[0])} (${worst[1].toLocaleString()})` : 'in runs');
    }
    if (!SHOW_LEVEL_RECORDS) return;
    const levelDeaths = deaths?.levels ?? {};

    const sections: HTMLElement[] = [];
    const themes = [...OFFICIAL_THEMES, ...(customTheme() ? [customTheme()!] : [])];
    for (const [ti, t] of themes.entries()) {
      const slots = levelSlots(t);
      const recs = Array.from({ length: slots }, (_, i) => byKey.get(levelKey(t, i)));
      if (!recs.some(Boolean) && slots === 0) continue;
      for (let i = 0; i < slots; i++) byKey.delete(levelKey(t, i));
      const cleared = recs.filter(Boolean) as AccountRecord[];
      const title = t.official ? `Chapter ${String(ti + 1).padStart(2, '0')} · ${t.info.name}` : `Custom · ${t.info.name}`;
      sections.push(this.section(title, `${cleared.length} / ${slots} cleared · ★ ${cleared.reduce((s, r) => s + r.stars, 0)} / ${slots * STARS_PER_LEVEL}`,
        recs.map((r, i) => [`${i + 1}. ${t.levels[i]?.title ?? t.levels[i]?.name.replace(/^\d+\.\s*/, '') ?? ''}`, r, levelDeaths[levelKey(t, i)] ?? 0])));
    }
    // Records for levels this build doesn't know (older or other custom packs)
    if (byKey.size) sections.push(this.section('Other levels', `${byKey.size} record${byKey.size === 1 ? '' : 's'}`, [...byKey].map(([k, r]) => [k, r, levelDeaths[k] ?? 0])));

    this.list.replaceChildren(...sections);
    this.list.hidden = false;
  }

  /** Server counts plus deaths this browser hasn't reported yet */
  private withUnsent(server: AccountDeaths): AccountDeaths {
    const unsent = this.deaths.unsent;
    const levels = { ...server.levels };
    for (const [k, n] of Object.entries(unsent.levels)) levels[k] = (levels[k] ?? 0) + n;
    return { total: server.total + unsent.total, levels };
  }

  private section(title: string, meta: string, rows: [string, AccountRecord | undefined, number][]): HTMLElement {
    const details = el('details', 'stats-group');
    details.open = rows.some(([, r]) => r);
    const head = el('summary', '');
    head.append(el('strong', '', title), el('small', 'muted', meta));
    const table = el('table', 'stats-table');
    const thead = table.createTHead().insertRow();
    for (const h of ['Level', 'Best', 'Best (ms)', 'Stars', 'Deaths', 'Updated']) thead.append(el('th', '', h));
    const body = table.createTBody();
    for (const [name, r, deaths] of rows) {
      const tr = body.insertRow();
      if (!r && !deaths) tr.className = 'stats-empty';
      tr.append(
        el('td', 'stats-name', name),
        el('td', 'num', r ? `${formatTime(r.best_ms)}s` : '—'),
        el('td', 'num', r ? r.best_ms.toLocaleString() : '—'),
        el('td', 'stats-stars', r ? stars(r.stars) : '—'),
        el('td', 'num', deaths ? deaths.toLocaleString() : '—'),
        el('td', 'muted', r ? date(r.updated_at) : ''),
      );
    }
    details.append(head, table);
    return details;
  }

  private message(text: string): void {
    this.status.textContent = text;
  }
}
