<<<<<<< HEAD
import { ACHIEVEMENTS, achievementProgress, type AchievementDefinition } from '../core/achievements';
import { t, type MessageKey } from '../core/i18n';
import type { Achievements } from './achievements';
=======
import { ACHIEVEMENTS, achievementProgress, CHAPTER_IDS, levelLabel, TOTAL_STARS, type AchievementDefinition } from '../core/achievements';
import { t, type MessageKey } from './i18n';
import type { Achievements } from './achievements';
import { installDiamondProgress } from './diamond-dial';
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

<<<<<<< HEAD
export class AchievementsUI {
  private filter = 'all';
  private category = 'all';
  private summary = el('p', '', 'achievement-summary');
  private status = el('p', '', 'muted');
  private list = el('div', '', 'achievement-list');
  constructor(root: HTMLElement, private model: Achievements, private challenge: (def: AchievementDefinition) => (() => void) | null) {
    this.summary.setAttribute('aria-live', 'polite');
    const filters = el('div', '', 'achievement-filters');
    const makeSelect = (label: MessageKey, keys: string[], apply: (v: string) => void) => {
      const wrap = el('label', t(label));
      const select = el('select');
      for (const key of keys) select.add(new Option(t(`ach.${key}` as MessageKey), key));
      select.addEventListener('change', () => { apply(select.value); this.render(); });
      wrap.append(select);
      filters.append(wrap);
    };
    makeSelect('ach.filter', ['all', 'progress', 'complete'], v => this.filter = v);
    makeSelect('ach.category', ['all', 'clear', 'stars', 'chapter'], v => this.category = v);
    const seen = el('button', t('ach.markSeen'));
    seen.type = 'button';
    seen.addEventListener('click', () => model.markSeen());
    filters.append(seen);
    root.replaceChildren(this.summary, this.status, filters, this.list);
    model.subscribe(() => this.render());
    this.render();
  }
  open(): void { this.render(); void this.model.refresh(); }
  render(): void {
    const model = this.model;
    const count = ACHIEVEMENTS.filter(d => model.unlocks[d.id]).length;
    this.summary.textContent = t('ach.summary', { n: count, total: ACHIEVEMENTS.length });
    this.status.textContent = !model.storageAvailable ? t('ach.sessionOnly')
      : !model.signedIn ? t('ach.local') : t(model.syncStatus === 'synced' ? 'ach.synced' : 'ach.pending');
    const rows = ACHIEVEMENTS.map((def, order) => ({ def, order, unlock: model.unlocks[def.id], value: achievementProgress(def, model.records) }))
      .filter(r => (this.filter === 'all' || (this.filter === 'complete') === !!r.unlock) && (this.category === 'all' || r.def.category === this.category))
      .sort((a, b) => Number(!!a.unlock) - Number(!!b.unlock) || (a.unlock && b.unlock ? Date.parse(b.unlock.at) - Date.parse(a.unlock.at) : b.value / b.def.target - a.value / a.def.target) || a.order - b.order);
    this.list.replaceChildren();
    if (!rows.length) this.list.append(el('p', t('ach.empty')));
    for (const { def, unlock, value } of rows) {
      const card = el('article', '', `achievement-card${unlock ? ' is-unlocked' : ''}`);
      const badge = el('span', unlock ? '★' : '◇', 'achievement-badge');
      badge.setAttribute('aria-hidden', 'true');
      const body = el('div');
      body.append(el('h3', t(def.name)));
      const description = def.category === 'chapter' ? t('ach.chapterGoal', { n: def.target })
        : t(`ach.${def.kind}Goal` as MessageKey, { n: def.target });
      body.append(el('p', description));
      const progress = el('progress');
      progress.max = def.target;
      progress.value = unlock ? def.target : value;
      progress.setAttribute('aria-label', t(def.name));
      body.append(progress, el('span', `${progress.value} / ${def.target}`, 'achievement-count'));
      if (unlock) {
        body.append(el('p', `${!unlock.seen ? t('ach.new') + ' · ' : ''}${t('ach.complete')} · ${new Date(unlock.at).toLocaleDateString()}${!unlock.confirmed ? ' · ' + t('ach.waiting') : ''}`, 'achievement-date'));
      }
      const details = el('details');
      details.append(el('summary', t('ach.details')), el('p', t('ach.scope')));
      if (def.kind !== 'stars') {
        const missing = def.levels.filter(k => {
          const r = model.records[k];
          return !r || (def.kind === 'perfect' && r.stars < 3);
        }).map(k => {
          const [theme, index] = k.split('/');
          return `${theme === 'workshop' ? '1' : '2'}-${String(Number(index) + 1).padStart(2, '0')}`;
        });
        if (!unlock && missing.length) details.append(el('p', t('ach.remaining', { levels: missing.join(', ') })));
      }
      body.append(details);
      const action = !unlock && this.challenge(def);
      if (action) {
        const button = el('button', t('ach.challenge'));
        button.type = 'button';
        button.addEventListener('click', action);
        body.append(button);
      }
      card.append(badge, body);
      this.list.append(card);
    }
=======
/** Diamond tile at a grid cell; its content goes in the upright .dtile-in box */
function tile<K extends 'div' | 'button'>(tag: K, className: string, col: string, row: string): [HTMLElementTagNameMap[K], HTMLElement] {
  const node = el(tag, '', `dtile ${className}`);
  if (node instanceof HTMLButtonElement) node.type = 'button';
  node.style.gridColumn = col;
  node.style.gridRow = row;
  const inner = el('span', '', 'dtile-in');
  node.append(inner);
  return [node, inner];
}

/** What the player has to do, in words */
function goal(def: AchievementDefinition): string {
  if (def.kind === 'discord') return t('ach.discordGoal');
  if (def.kind === 'time') return t('ach.timeGoal', { level: levelLabel(def.levels[0]), ms: def.maxMs ?? 0 });
  if (def.category === 'chapter') {
    const chapter = CHAPTER_IDS.indexOf(def.levels[0].split('/')[0] as (typeof CHAPTER_IDS)[number]) + 1;
    return t('ach.chapterStarsGoal', { n: def.target, chapter });
  }
  return t(def.target === TOTAL_STARS ? 'ach.allStarsGoal' : 'ach.starsGoal', { n: def.target });
}

/** The best time on a time achievement's level, or the bare goal when not cleared yet */
function bestTime(def: AchievementDefinition, records: Readonly<Record<string, { best: number }>>): string {
  const best = records[def.levels[0]]?.best;
  return best ? t('ach.bestTime', { ms: Math.floor(best) }) : `0 / ${def.target}`;
}

const FILTERS = ['all', 'progress', 'complete'] as const;
const CATEGORIES = ['all', 'stars', 'chapter', 'special'] as const;
/**
 * A 4×4 grid turned 45°: the 2×2 summary tile in the middle and the achievements on the ring
 * around it. The layout is the same with rows and columns swapped, so it is mirror-symmetric on
 * screen. Ring cells in clockwise screen order from the top corner: right-down edge, bottom
 * corner, left-up edge.
 */
const SLOTS: readonly [number, number][] = [
  [1, 1], [2, 1], [3, 1], [4, 1],
  [4, 2], [4, 3], [4, 4],
  [3, 4], [2, 4], [1, 4],
  [1, 3], [1, 2],
];
export const ACHIEVEMENTS_PER_PAGE = SLOTS.length;

export interface AchievementsElements {
  grid: HTMLElement;
  status: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  page: HTMLElement;
  /** Status filter and category filter, either side of Back */
  filter: HTMLButtonElement;
  category: HTMLButtonElement;
}

/**
 * Achievements as a 45°-turned grid like the other menu screens: a 2×2 detail tile (the overview,
 * or the focused achievement), a fixed number of achievements per page with diamond page buttons
 * either side, and the filter / "mark seen" tiles and Back (static in index.html) on the last row.
 * Each achievement shows its progress like the loading screen: a diamond track filling clockwise.
 */
export class AchievementsUI {
  private filter = 0;
  private category = 0;
  private page = 0;
  /** Achievement shown in the detail tile; null = the overview */
  private focused: AchievementDefinition | null = null;
  /** Achievement picked by a click: a second click on it starts the challenge */
  private selected: AchievementDefinition | null = null;
  private readonly detail: HTMLElement;
  /** Achievement tiles of the current page (and the empty cells after them) */
  private pageNodes: HTMLElement[] = [];
  private readonly filterBtn: HTMLButtonElement;
  private readonly categoryBtn: HTMLButtonElement;

  constructor(
    private readonly els: AchievementsElements,
    private readonly model: Achievements,
    private readonly challenge: (def: AchievementDefinition) => (() => void) | null,
  ) {
    const { grid } = els;
    const [detailTile, detail] = tile('div', 'dtile-stars ach-detail', '2 / span 2', '2 / span 2');
    detail.setAttribute('aria-live', 'polite');
    this.detail = detail;
    grid.append(detailTile);

    this.filterBtn = els.filter;
    this.filterBtn.addEventListener('click', () => {
      this.filter = (this.filter + 1) % FILTERS.length;
      this.page = 0;
      this.render();
    });
    this.categoryBtn = els.category;
    this.categoryBtn.addEventListener('click', () => {
      this.category = (this.category + 1) % CATEGORIES.length;
      this.page = 0;
      this.render();
    });

    els.prev.addEventListener('click', () => this.turn(-1));
    els.next.addEventListener('click', () => this.turn(1));
    grid.addEventListener('mouseleave', () => this.focus(this.selected));
    grid.closest('.screen')?.addEventListener('keydown', (e) => {
      if (!(e instanceof KeyboardEvent) || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
      e.preventDefault();
      this.turn(e.key === 'PageUp' ? -1 : 1);
    });
    model.subscribe(() => this.render());
    this.render();
  }

  open(): void {
    this.focused = null;
    this.selected = null;
    this.page = 0;
    this.render();
    void this.model.refresh();
  }

  private matches(def: AchievementDefinition): boolean {
    const unlocked = !!this.model.unlocks[def.id];
    const f = FILTERS[this.filter];
    const c = CATEGORIES[this.category];
    return (f === 'all' || (f === 'complete') === unlocked) && (c === 'all' || def.category === c);
  }

  private get list(): AchievementDefinition[] {
    return ACHIEVEMENTS.filter((d) => this.matches(d));
  }

  private get pages(): number {
    return Math.max(1, Math.ceil(this.list.length / ACHIEVEMENTS_PER_PAGE));
  }

  private turn(dir: -1 | 1): void {
    const to = Math.max(0, Math.min(this.pages - 1, this.page + dir));
    if (to === this.page) return;
    this.page = to;
    this.render();
    this.pageNodes.find((n): n is HTMLButtonElement => n instanceof HTMLButtonElement)?.focus();
  }

  private focus(def: AchievementDefinition | null): void {
    if (this.focused === def) return;
    this.focused = def;
    this.renderDetail();
  }

  render(): void {
    const { model, els } = this;
    els.status.textContent = !model.storageAvailable ? t('ach.sessionOnly')
      : !model.signedIn ? t('ach.local') : t(model.syncStatus === 'synced' ? 'ach.synced' : 'ach.pending');

    const list = this.list;
    const pages = this.pages;
    this.page = Math.min(this.page, pages - 1);
    const shown = list.slice(this.page * ACHIEVEMENTS_PER_PAGE, (this.page + 1) * ACHIEVEMENTS_PER_PAGE);
    for (const n of this.pageNodes) n.remove();
    this.pageNodes = SLOTS.map(([col, row], i) => {
      const def = shown[i];
      if (!def) {
        // Empty cells keep the grid's shape on the last page
        const [deco] = tile('div', 'dtile-deco', String(col), String(row));
        deco.setAttribute('aria-hidden', 'true');
        return deco;
      }
      return this.achievementTile(def, col, row);
    });
    els.grid.prepend(...this.pageNodes);

    els.page.textContent = list.length ? `${this.page + 1} / ${pages}` : t('ach.pageEmpty');
    els.prev.disabled = this.page === 0;
    els.next.disabled = this.page >= pages - 1;
    const label = (text: string, value: string) => [el('small', text, 'dstat-label'), el('strong', value)];
    this.filterBtn.querySelector('.dtile-in')!.replaceChildren(...label(t('ach.filter'), t(`ach.${FILTERS[this.filter]}` as MessageKey)));
    this.categoryBtn.querySelector('.dtile-in')!.replaceChildren(...label(t('ach.category'), t(`ach.${CATEGORIES[this.category]}` as MessageKey)));
    this.renderDetail();
  }

  private achievementTile(def: AchievementDefinition, col: number, row: number): HTMLButtonElement {
    const { model } = this;
    const unlock = model.unlocks[def.id];
    const value = unlock ? def.target : achievementProgress(def, model.records);
    const [node, inner] = tile('button', 'ach-tile', String(col), String(row));
    node.classList.toggle('is-unlocked', !!unlock);
    node.classList.toggle('is-selected', this.selected === def);
    node.setAttribute('aria-label', `${t(def.name)} · ${value} / ${def.target}`);
    inner.append(el('span', `#${def.id}`, 'ach-badge'), el('strong', t(def.name)), el('small', `${value} / ${def.target}`, 'ach-amount'));
    if (unlock && !unlock.seen) inner.prepend(el('span', t('ach.new'), 'ach-new'));
    // Progress like the loading screen: the diamond track fills clockwise, the percentage sits in the gap
    const count = el('span', `${Math.floor((value / def.target) * 100)}%`, 'ach-count');
    count.setAttribute('aria-hidden', 'true');
    inner.append(count);
    installDiamondProgress(inner, () => {})(value / def.target);

    node.addEventListener('mouseenter', () => this.focus(def));
    node.addEventListener('focus', () => this.focus(def));
    node.addEventListener('click', () => {
      const run = this.selected === def && !model.unlocks[def.id] ? this.challenge(def) : null;
      if (run) return run();
      this.selected = def;
      this.focused = null;
      this.focus(def);
      for (const n of this.pageNodes) n.classList.toggle('is-selected', n === node);
    });
    return node;
  }

  private renderDetail(): void {
    const model = this.model;
    const def = this.focused;
    if (!def) {
      const count = ACHIEVEMENTS.filter((d) => model.unlocks[d.id]).length;
      this.detail.replaceChildren(
        el('strong', `${count} / ${ACHIEVEMENTS.length}`),
        el('small', t('menu.achievements')),
      );
      // "Mark new as seen" only while something is new
      if (ACHIEVEMENTS.some((d) => model.unlocks[d.id] && !model.unlocks[d.id].seen)) {
        const seen = el('button', `✓ ${t('ach.markSeen')}`, 'ach-seen');
        seen.type = 'button';
        seen.addEventListener('click', () => model.markSeen());
        this.detail.append(seen);
      }
      return;
    }
    const unlock = model.unlocks[def.id];
    const value = unlock ? def.target : achievementProgress(def, model.records);
    const description = goal(def);
    const reward = def.reward
      ? t('ach.reward', { reward: t(def.reward.kind === 'pointer' ? 'ach.rewardPointer' : 'ach.rewardTrail', { n: def.reward.skin }) })
      : t('ach.rewardTbd');
    const parts: HTMLElement[] = [
      el('span', `#${def.id}`, 'ach-badge'),
      el('strong', t(def.name), 'ach-detail-name'),
      el('p', description, 'ach-desc'),
      el('small', def.kind === 'time' ? bestTime(def, model.records) : `${value} / ${def.target}`),
      el('small', reward, 'ach-reward'),
    ];
    if (unlock) {
      parts.push(el('small', `${!unlock.seen ? t('ach.new') + ' · ' : ''}${t('ach.complete')} · ${new Date(unlock.at).toLocaleDateString()}${!unlock.confirmed ? ' · ' + t('ach.waiting') : ''}`));
    } else if (def.category === 'chapter' && def.kind === 'stars') {
      const missing = def.levels.filter((k) => (model.records[k]?.stars ?? 0) < 3).map(levelLabel);
      if (missing.length) parts.push(el('small', t('ach.remaining', { levels: missing.slice(0, 8).join(', ') + (missing.length > 8 ? '…' : '') }), 'ach-remaining'));
    }
    if (!unlock && this.challenge(def)) {
      parts.push(el('small', t(this.selected === def ? 'ach.clickToChallenge' : 'ach.clickToSelect'), 'ach-cta'));
    }
    this.detail.replaceChildren(...parts);
    this.detail.title = t('ach.scope');
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
  }
}
