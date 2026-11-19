import { ACHIEVEMENTS, achievementProgress, type AchievementDefinition } from '../core/achievements';
import { t, type MessageKey } from '../core/i18n';
import type { Achievements } from './achievements';
import { installDiamondProgress } from './diamond-dial';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

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

const FILTERS = ['all', 'progress', 'complete'] as const;
const CATEGORIES = ['all', 'clear', 'stars', 'chapter'] as const;
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
    inner.append(el('span', unlock ? '★' : '◇', 'ach-badge'), el('strong', t(def.name)));
    if (unlock && !unlock.seen) inner.prepend(el('span', t('ach.new'), 'ach-new'));
    // Progress like the loading screen: the diamond track fills clockwise, the count sits in the gap
    const count = el('span', `${value} / ${def.target}`, 'ach-count');
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
        el('span', '★', 'dtotal-star'),
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
    const description = def.category === 'chapter' ? t('ach.chapterGoal', { n: def.target })
      : t(`ach.${def.kind}Goal` as MessageKey, { n: def.target });
    const parts: HTMLElement[] = [
      el('span', unlock ? '★' : '◇', 'ach-badge'),
      el('strong', t(def.name), 'ach-detail-name'),
      el('p', description, 'ach-desc'),
      el('small', `${value} / ${def.target}`),
    ];
    if (unlock) {
      parts.push(el('small', `${!unlock.seen ? t('ach.new') + ' · ' : ''}${t('ach.complete')} · ${new Date(unlock.at).toLocaleDateString()}${!unlock.confirmed ? ' · ' + t('ach.waiting') : ''}`));
    } else if (def.kind !== 'stars') {
      const missing = def.levels.filter((k) => {
        const r = model.records[k];
        return !r || (def.kind === 'perfect' && r.stars < 3);
      }).map((k) => {
        const [theme, index] = k.split('/');
        return `${theme === 'workshop' ? '1' : '2'}-${String(Number(index) + 1).padStart(2, '0')}`;
      });
      if (missing.length) parts.push(el('small', t('ach.remaining', { levels: missing.slice(0, 8).join(', ') + (missing.length > 8 ? '…' : '') }), 'ach-remaining'));
    }
    if (!unlock && this.challenge(def)) {
      parts.push(el('small', t(this.selected === def ? 'ach.clickToChallenge' : 'ach.clickToSelect'), 'ach-cta'));
    }
    this.detail.replaceChildren(...parts);
    this.detail.title = t('ach.scope');
  }
}
