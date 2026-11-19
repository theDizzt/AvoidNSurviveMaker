import { ACHIEVEMENTS, achievementProgress, type AchievementDefinition } from '../core/achievements';
import { t, type MessageKey } from '../core/i18n';
import type { Achievements } from './achievements';

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
const COLS = 4;

/**
 * Achievements as a 45°-turned grid like the other menu screens: a 2×2 detail tile (the overview,
 * or the focused achievement), one diamond per achievement in a fixed order, then the filter and
 * "mark seen" tiles and Back (static in index.html). Filters dim the tiles that don't match.
 */
export class AchievementsUI {
  private filter = 0;
  private category = 0;
  /** Achievement shown in the detail tile; null = the overview */
  private focused: AchievementDefinition | null = null;
  /** Achievement picked by a click: a second click on it starts the challenge */
  private selected: AchievementDefinition | null = null;
  private readonly detail: HTMLElement;
  private readonly tiles: { def: AchievementDefinition; node: HTMLButtonElement; inner: HTMLElement }[] = [];
  private readonly filterBtn: HTMLButtonElement;
  private readonly categoryBtn: HTMLButtonElement;

  constructor(
    grid: HTMLElement,
    private readonly status: HTMLElement,
    private readonly model: Achievements,
    private readonly challenge: (def: AchievementDefinition) => (() => void) | null,
  ) {
    const back = grid.querySelector('#achievements-back');
    const [detailTile, detail] = tile('div', 'dtile-stars ach-detail', '1 / span 2', '1 / span 2');
    detail.setAttribute('aria-live', 'polite');
    this.detail = detail;
    const nodes: HTMLElement[] = [detailTile];

    // The detail tile takes the first two cells of rows 1–2; achievements fill the cells around it
    const cells: [number, number][] = [];
    for (let row = 1; cells.length < ACHIEVEMENTS.length; row++) {
      for (let col = 1; col <= COLS; col++) if (!(row <= 2 && col <= 2)) cells.push([col, row]);
    }
    ACHIEVEMENTS.forEach((def, i) => {
      const [col, row] = cells[i];
      const [node, inner] = tile('button', 'ach-tile', String(col), String(row));
      node.addEventListener('mouseenter', () => this.focus(def));
      node.addEventListener('focus', () => this.focus(def));
      node.addEventListener('click', () => {
        const run = this.selected === def && !model.unlocks[def.id] ? this.challenge(def) : null;
        if (run) return run();
        this.selected = def;
        this.focused = null;
        this.focus(def);
        for (const tl of this.tiles) tl.node.classList.toggle('is-selected', tl.def === def);
      });
      this.tiles.push({ def, node, inner });
      nodes.push(node);
    });

    const lastRow = cells[cells.length - 1][1] + 1;
    const pill = (col: number, onClick: () => void): HTMLButtonElement => {
      const [node] = tile('button', 'ach-control', String(col), String(lastRow));
      node.addEventListener('click', onClick);
      nodes.push(node);
      return node;
    };
    this.filterBtn = pill(1, () => {
      this.filter = (this.filter + 1) % FILTERS.length;
      this.render();
    });
    this.categoryBtn = pill(2, () => {
      this.category = (this.category + 1) % CATEGORIES.length;
      this.render();
    });
    const seen = pill(3, () => model.markSeen());
    seen.querySelector('.dtile-in')!.append(el('span', '✓', 'dicon'), el('strong', t('ach.markSeen')));
    if (back instanceof HTMLElement) back.style.gridRow = String(lastRow);

    grid.addEventListener('mouseleave', () => this.focus(this.selected));
    grid.prepend(...nodes);
    model.subscribe(() => this.render());
    this.render();
  }

  open(): void {
    this.focused = null;
    this.selected = null;
    for (const tl of this.tiles) tl.node.classList.remove('is-selected');
    this.render();
    void this.model.refresh();
  }

  private focus(def: AchievementDefinition | null): void {
    if (this.focused === def) return;
    this.focused = def;
    this.renderDetail();
  }

  private matches(def: AchievementDefinition): boolean {
    const unlocked = !!this.model.unlocks[def.id];
    const f = FILTERS[this.filter];
    const c = CATEGORIES[this.category];
    return (f === 'all' || (f === 'complete') === unlocked) && (c === 'all' || def.category === c);
  }

  render(): void {
    const model = this.model;
    this.status.textContent = !model.storageAvailable ? t('ach.sessionOnly')
      : !model.signedIn ? t('ach.local') : t(model.syncStatus === 'synced' ? 'ach.synced' : 'ach.pending');
    for (const { def, node, inner } of this.tiles) {
      const unlock = model.unlocks[def.id];
      const value = unlock ? def.target : achievementProgress(def, model.records);
      node.classList.toggle('is-unlocked', !!unlock);
      node.classList.toggle('is-dimmed', !this.matches(def));
      node.setAttribute('aria-label', `${t(def.name)} · ${value} / ${def.target}`);
      const bar = el('span', '', 'ach-bar');
      bar.style.setProperty('--p', String(value / def.target));
      inner.replaceChildren(
        el('span', unlock ? '★' : '◇', 'ach-badge'),
        el('strong', t(def.name)),
        bar,
        el('small', `${value} / ${def.target}`),
      );
      if (unlock && !unlock.seen) inner.prepend(el('span', t('ach.new'), 'ach-new'));
    }
    const label = (text: string, value: string) => [el('small', text, 'dstat-label'), el('strong', value)];
    this.filterBtn.querySelector('.dtile-in')!.replaceChildren(...label(t('ach.filter'), t(`ach.${FILTERS[this.filter]}` as MessageKey)));
    this.categoryBtn.querySelector('.dtile-in')!.replaceChildren(...label(t('ach.category'), t(`ach.${CATEGORIES[this.category]}` as MessageKey)));
    this.renderDetail();
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
