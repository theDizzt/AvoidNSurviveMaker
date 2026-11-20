import { t as tr } from './i18n';
import { formatPlayTime } from './localized/account';
import { formatTime } from '../core/simulation';
import { formatUtc } from '../core/time';
import { CRYSTALS_PER_THEME, levelAt, levelSlots, maxStars, STARS_PER_LEVEL } from './localized/theme-pack';
import type { Account } from './auth/account';
import type { AccountDeaths, DeathTracker } from './auth/deaths';
import type { AccountRecord, RecordSync } from './auth/records';
import { levelKey } from './progress';
import { renderTag } from './player-tag';
import { customTheme, OFFICIAL_THEMES } from './theme-registry';
import { chapterLevelCode } from './localized/level';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const date = formatUtc;
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, STARS_PER_LEVEL - n));
const starTotal = (records: readonly AccountRecord[]) => records.reduce((sum, r) => sum + r.stars, 0)
  + Math.min(CRYSTALS_PER_THEME, records.filter(r => r.crystal).length);

/** Short name of a level key: '1-04' for chapters, 'Custom 4' for custom packs */
function levelName(key: string): string {
  // Older keys ended in "@<content hash>"; the level is the same
  key = key.split('@')[0];
  for (const [chapter, theme] of OFFICIAL_THEMES.entries()) {
    for (let i = 0; i < levelSlots(theme); i++) {
      if (levelKey(theme, i) === key) return chapterLevelCode(chapter + 1, i + 1);
    }
  }
  const m = /^(custom:)?(.+)\/(\d+)$/.exec(key);
  if (!m) return key;
  const n = Number(m[3]) + 1;
  if (m[1]) return tr('stats.customLevel', { n });
  const ch = OFFICIAL_THEMES.findIndex((t) => t.info.id === m[2]);
  return ch >= 0 ? chapterLevelCode(ch + 1, n) : `${m[2]} ${n}`;
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

  /** Refresh only the play-time field (the total grows every 30 s while the game is open) */
  updatePlayTime(): void {
    const profile = this.account.profile;
    if (!profile) return;
    this.set('time', formatPlayTime(profile.total_play_seconds));
    this.set('time-note', `${profile.total_play_seconds.toLocaleString()}s`);
  }

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
    if (!this.account.configured) return this.message(tr('stats.notConfigured'));
    const profile = this.account.profile;
    if (!profile) return this.message(tr('stats.signIn'));
    this.message(tr('stats.loading'));
    const [rows, serverDeaths] = await Promise.all([this.records.fetchAccountRecords(), this.deaths.fetchAccountDeaths()]);
    if (run !== this.loading) return; // a newer render started
    if (!rows) return this.message(tr('stats.loadFailed'));

    const byKey = new Map(rows.map((r) => [r.level_key, r]));
    const themes = [...OFFICIAL_THEMES, ...(customTheme() ? [customTheme()!] : [])];
    const activeKeys = new Set(themes
      .flatMap(theme => Array.from({ length: levelSlots(theme) }, (_, i) => levelKey(theme, i))));
    const currentRows = rows.filter(r => activeKeys.has(r.level_key));
    const totalStars = themes.reduce((sum, theme) => sum + starTotal(
      Array.from({ length: levelSlots(theme) }, (_, i) => byKey.get(levelKey(theme, i)))
        .filter((r): r is AccountRecord => !!r)), 0);
    const perfect = currentRows.filter((r) => r.stars >= STARS_PER_LEVEL).length;
    const lastUpdate = rows.reduce<string | undefined>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), undefined);
    const officialMax = OFFICIAL_THEMES.reduce((s, t) => s + maxStars(t), 0);

    this.message(tr('stats.saved'));
    this.set('stars', String(totalStars));
    this.set('stars-note', tr('stats.starsNote', { max: officialMax }));
    const player = this.grid.querySelector<HTMLElement>('[data-stat="player"]');
    if (player) renderTag(player, this.account.tag ?? '—');
    this.set('player-note', tr('stats.joined', { date: date(profile.created_at) }));
    this.set('time', formatPlayTime(profile.total_play_seconds));
    this.set('time-note', `${profile.total_play_seconds.toLocaleString()}s`);
    this.set('cleared', String(currentRows.length));
    this.set('cleared-note', tr('stats.perfect', { n: perfect }));
    this.set('last', date(lastUpdate));
    const deaths = serverDeaths && this.withUnsent(serverDeaths);
    if (deaths) {
      this.set('deaths', deaths.total.toLocaleString());
      const worst = Object.entries(deaths.levels).sort((a, b) => b[1] - a[1])[0];
      this.set('deaths-note', worst ? tr('stats.deathsMost', { level: levelName(worst[0]), n: worst[1].toLocaleString() }) : tr('stats.deathsNote'));
    }
    if (!SHOW_LEVEL_RECORDS) return;
    const levelDeaths = deaths?.levels ?? {};

    const sections: HTMLElement[] = [];
    for (const [ti, t] of themes.entries()) {
      const slots = levelSlots(t);
      const recs = Array.from({ length: slots }, (_, i) => byKey.get(levelKey(t, i)));
      if (!recs.some(Boolean) && slots === 0) continue;
      for (let i = 0; i < slots; i++) byKey.delete(levelKey(t, i));
      const cleared = recs.filter(Boolean) as AccountRecord[];
      const title = t.official ? tr('themeRegistry.chapterPreset', { n: String(ti + 1).padStart(2, '0'), name: t.info.name }) : tr('stats.customPack', { name: t.info.name });
      sections.push(this.section(title, tr('stats.sectionSummary', { cleared: cleared.length, slots, stars: starTotal(cleared), max: maxStars(t) }),
        recs.map((r, i) => [`${i + 1}. ${levelAt(t, i)?.title ?? levelAt(t, i)?.name.replace(/^\d+\.\s*/, '') ?? ''}`, r, levelDeaths[levelKey(t, i)] ?? 0])));
    }
    // Records for levels this build doesn't know (older or other custom packs)
    if (byKey.size) sections.push(this.section(tr('stats.otherLevels'), tr(byKey.size === 1 ? 'stats.recordOne' : 'stats.recordMany', { n: byKey.size }), [...byKey].map(([k, r]) => [k, r, levelDeaths[k] ?? 0])));

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
    for (const h of [tr('common.level'), tr('stats.colBest'), tr('stats.colBestMs'), tr('common.stars'), tr('stats.colDeaths'), tr('stats.colUpdated')]) thead.append(el('th', '', h));
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
