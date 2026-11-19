import { ACHIEVEMENTS, achievementProgress, type AchievementDefinition } from '../core/achievements';
import { t, type MessageKey } from '../core/i18n';
import type { Achievements } from './achievements';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

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
  }
}
