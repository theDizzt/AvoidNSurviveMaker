import { formatTime } from '../core/simulation';
import { averageDifficulty, LEVELS_PER_THEME, levelSlots, maxStars, STARS_PER_THEME, themedLevel, type ThemeEntry } from '../core/theme-pack';
import { levelRecord, themeStars, themeUnlocked, totalStars } from './progress';
import { customTheme, OFFICIAL_SLOTS, OFFICIAL_THEMES, setCustomTheme } from './theme-registry';
import { readThemeZip } from './theme-zip';
import { renderScreen, type ScreenData } from './screen-render';

/** Theme screen data, including progress and optional level details */
export function screenData(t: ThemeEntry, level?: number): ScreenData {
  const levels = Array.from({ length: levelSlots(t) }, (_, i) => {
    const map = themedLevel(t, i);
    const rec = levelRecord(t, i);
    return { available: !!map, stars: rec?.stars ?? 0, cleared: !!rec, difficulty: map?.difficulty ?? 1, title: map?.title ?? '' };
  });
  return {
    info: t.info,
    assets: t.assets,
    fontScope: t.official ? `th-${t.info.id}` : 'th-custom',
    levels,
    level,
    best: level !== undefined ? levelRecord(t, level)?.best ?? null : undefined,
  };
}

/**
 * Diamond-tile screens: world (theme) select and level select.
 *
 * - fitRotatedGrid: an ordinary CSS grid turned 45°, so its cells become interlocking diamonds
 *   (used by the main menu).
 * - lattice: diamonds in zig-zag rows (worlds: 16 official slots + 1 custom pack; levels: 21).
 */

/** Scale a 45°-turned grid to fit its wrapper (and size the wrapper to the turned grid) */
export function fitRotatedGrid(wrap: HTMLElement, grid: HTMLElement, maxW: number, maxH: number): void {
  const w = grid.offsetWidth;
  const h = grid.offsetHeight;
  if (!w || !h) return;
  const span = (w + h) / Math.SQRT2; // width and height of the turned grid
  const fit = Math.min(1.15, maxW / span, maxH / span);
  wrap.style.width = `${span * fit}px`;
  wrap.style.height = `${span * fit}px`;
  grid.style.transform = `translate(-50%, -50%) rotate(45deg) scale(${fit})`;
}

/** Key of a theme in level keys and progress: official themes by id, the custom pack as "~custom" */
export function themeKey(t: ThemeEntry): string {
  return t.official ? t.info.id : '~custom';
}

export function themeFromKey(key: string): ThemeEntry | null {
  if (key === '~custom') return customTheme();
  return OFFICIAL_THEMES.find((t) => t.info.id === key) ?? null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Content box of a diamond tile, turned back upright */
function inner(...children: (HTMLElement | string)[]): HTMLElement {
  const i = el('span', 'dtile-in');
  i.append(...children);
  return i;
}

function starRow(n: number): HTMLElement {
  const s = el('span', 'dstars');
  for (let k = 0; k < 3; k++) s.append(el('span', k < n ? 'on' : 'off', '★'));
  return s;
}

const diff = (v: number) => `◆ ${v.toFixed(2)}`;

/** Lay out diamonds in zig-zag rows; returns the lattice size */
function placeLattice(tiles: HTMLElement[], size: number, perRow: number, gap = 6): { w: number; h: number } {
  const step = (size * Math.SQRT2) / 2 + gap;
  const rowGap = step * 2.2;
  tiles.forEach((t, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    t.style.width = t.style.height = `${size}px`;
    t.style.left = `${step + col * step - size / 2}px`;
    t.style.top = `${step + row * rowGap + (col % 2) * step - size / 2}px`;
  });
  const rows = Math.ceil(tiles.length / perRow);
  return { w: step * (perRow + 1), h: step * 2 + (rows - 1) * rowGap + step };
}

export class CampaignUI {
  /** Play a level of a theme (level −1 = open its level select) */
  onPlay: (theme: ThemeEntry, level: number) => void = () => {};
  onBack: (from: 'themes' | 'levels') => void = () => {};

  private theme: ThemeEntry | null = null;
  private readonly file: HTMLInputElement;

  constructor(private readonly themesRoot: HTMLElement, private readonly levelsRoot: HTMLElement) {
    window.addEventListener('resize', () => this.fit());
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = '.zip,application/zip';
    this.file.hidden = true;
    this.file.addEventListener('change', () => void this.loadZip());
    document.body.append(this.file);
  }

  get currentTheme(): ThemeEntry | null {
    return this.theme;
  }

  /** Re-fit whichever screen is showing */
  fit(): void {
    for (const root of [this.themesRoot, this.levelsRoot]) {
      const wrap = root.querySelector<HTMLElement>('.lattice-wrap');
      const lat = root.querySelector<HTMLElement>('.lattice');
      if (!wrap || !lat || root.hidden) continue;
      const w = lat.offsetWidth;
      const h = lat.offsetHeight;
      const room = root === this.themesRoot ? 250 : 170;
      const fit = Math.min(1.2, (window.innerWidth * 0.94) / w, (window.innerHeight - room) / h);
      wrap.style.width = `${w * fit}px`;
      wrap.style.height = `${h * fit}px`;
      lat.style.transform = `scale(${fit})`;
    }
  }

  private async loadZip(): Promise<void> {
    const f = this.file.files?.[0];
    this.file.value = '';
    if (!f) return;
    try {
      const pack = await readThemeZip(f);
      if (!setCustomTheme(pack)) alert('This pack is too large to keep after a reload, but you can play it now.');
      this.renderThemes();
    } catch (err) {
      alert(`Couldn't load the pack: ${(err as Error).message}`);
    }
  }

  private header(title: string, sub: string, back: () => void, extra?: HTMLElement): HTMLElement {
    const head = el('header', 'dhead');
    const backBtn = el('button', 'dback');
    backBtn.type = 'button';
    backBtn.title = 'Back (Esc)';
    backBtn.setAttribute('aria-label', 'Back');
    backBtn.append(inner('←'));
    backBtn.addEventListener('click', back);
    const titles = el('div', 'dhead-titles');
    titles.append(el('h2', 'dhead-title', title), el('p', 'dhead-sub', sub));
    const right = el('div', 'dhead-right');
    if (extra) right.append(extra);
    const total = el('div', 'dtotal');
    total.append(el('span', 'dtotal-star', '★'), el('strong', '', String(totalStars())));
    total.title = 'Stars collected in the official worlds';
    right.append(total);
    head.append(backBtn, titles, right);
    return head;
  }

  /** The info strip under the header: description, author, release date of the hovered world */
  private infoFor(t: ThemeEntry | null, box: HTMLElement): void {
    if (!t) {
      box.replaceChildren(el('span', 'dinfo-muted', 'Load a custom theme pack (.zip) made with the Theme Editor.'));
      return;
    }
    const i = t.info;
    const meta = el('span', 'dinfo-meta');
    meta.textContent = [
      t.official ? `${t.levels.length} / ${LEVELS_PER_THEME} levels` : `${t.levels.length} level${t.levels.length === 1 ? '' : 's'}`,
      diff(averageDifficulty(t.levels)),
      i.author ? `by ${i.author}` : '',
      i.released ? `released ${i.released}` : '',
    ].filter(Boolean).join(' · ');
    box.replaceChildren(el('strong', '', i.name), el('span', '', i.description || ' '), meta);
  }

  renderThemes(): void {
    const tiles: HTMLElement[] = [];
    const info = el('div', 'dinfo');
    const hover = (t: ThemeEntry | null) => () => this.infoFor(t, info);
    for (let i = 0; i < OFFICIAL_SLOTS; i++) {
      const t = OFFICIAL_THEMES[i];
      if (!t) {
        const empty = el('span', 'dtile dworld dworld-empty');
        empty.setAttribute('aria-hidden', 'true');
        tiles.push(empty);
        continue;
      }
      tiles.push(this.worldTile(t, String(i + 1), hover(t)));
    }
    // Slot 17: the custom pack
    const c = customTheme();
    if (c) tiles.push(this.worldTile(c, 'Custom', hover(c)));
    else {
      const b = el('button', 'dtile dworld dworld-load');
      b.type = 'button';
      b.append(inner(el('span', 'dicon', '＋'), el('strong', 'dworld-name', 'Custom Pack'), el('small', 'dworld-tag', 'Load a .zip')));
      b.addEventListener('click', () => this.file.click());
      b.addEventListener('pointerenter', hover(null));
      b.addEventListener('focus', hover(null));
      tiles.push(b);
    }
    const lattice = el('div', 'lattice');
    lattice.append(...tiles);
    const size = placeLattice(tiles, 128, 9, 8);
    lattice.style.width = `${size.w}px`;
    lattice.style.height = `${size.h}px`;
    const wrap = el('div', 'lattice-wrap');
    wrap.append(lattice);

    const load = el('button', 'dload', 'Load pack (.zip)');
    load.type = 'button';
    load.title = 'Load a custom theme pack made with the Theme Editor';
    load.addEventListener('click', () => this.file.click());
    this.themesRoot.replaceChildren(
      this.header('Select a Chapter', `${OFFICIAL_THEMES.length} chapters · ${LEVELS_PER_THEME} levels and ${STARS_PER_THEME} stars each`, () => this.onBack('themes'), load),
      info,
      wrap,
    );
    this.infoFor(OFFICIAL_THEMES[0] ?? null, info);
    requestAnimationFrame(() => {
      this.fit();
      (lattice.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  private worldTile(t: ThemeEntry, label: string, onHover: () => void): HTMLElement {
    const unlocked = themeUnlocked(t);
    const planned = t.official && t.levels.length === 0;
    const b = el('button', `dtile dworld${unlocked ? '' : ' locked'}${t.official ? '' : ' custom'}`);
    b.type = 'button';
    const grad = `linear-gradient(135deg, ${t.info.colors[0]}, ${t.info.colors[1]})`;
    b.style.background = t.coverUrl ? `linear-gradient(180deg, rgba(20,24,40,0.05), rgba(20,24,40,0.55)), url("${t.coverUrl}") center / cover, ${grad}` : grad;
    const stars = themeStars(t);
    const parts: (HTMLElement | string)[] = [el('span', 'dworld-no', label), el('strong', 'dworld-name', t.info.name)];
    if (planned) {
      parts.push(el('small', 'dworld-tag', 'COMING SOON'));
    } else if (unlocked) {
      const p = el('span', 'dworld-stars');
      p.append(el('span', 'on', '★'), ` ${stars}/${maxStars(t)}`);
      parts.push(p, el('span', 'dworld-diff', diff(averageDifficulty(t.levels))));
    } else {
      parts.push(el('span', 'dlock', `Locked · ★ ${t.info.unlockStars}`));
    }
    b.append(inner(...parts));
    b.title = unlocked ? `${t.info.name} — ${t.levels.length} level${t.levels.length === 1 ? '' : 's'}` : `Collect ${t.info.unlockStars} stars to unlock (${t.info.unlockStars - totalStars()} more)`;
    if (planned) {
      b.title = `${t.info.name} — Coming soon. Preview the theme in Theme Editor.`;
      b.setAttribute('aria-disabled', 'true');
    }
    b.disabled = !unlocked && !planned;
    b.addEventListener('pointerenter', onHover);
    b.addEventListener('focus', onHover);
    b.addEventListener('click', () => {
      if (planned) return;
      this.theme = t;
      this.onPlay(t, -1);
    });
    return b;
  }

  renderLevels(t: ThemeEntry): void {
    this.theme = t;
    // A theme with its own level select screen
    const custom = t.info.screens?.select;
    this.levelsRoot.classList.toggle('custom-screen', !!custom);
    if (custom) {
      const host = el('div', 'se-full');
      this.levelsRoot.replaceChildren(host);
      renderScreen(host, custom, screenData(t), { onLevel: (i) => this.onPlay(t, i), onBack: () => this.onBack('levels') });
      requestAnimationFrame(() => host.querySelector<HTMLElement>('.se-level:not(:disabled)')?.focus({ preventScroll: true }));
      return;
    }
    const lattice = el('div', 'lattice');
    lattice.style.setProperty('--c1', t.info.colors[0]);
    lattice.style.setProperty('--c2', t.info.colors[1]);
    let first: HTMLButtonElement | null = null;
    const tiles: HTMLElement[] = [];
    const slots = levelSlots(t);
    for (let i = 0; i < slots; i++) {
      const map = themedLevel(t, i);
      const rec = levelRecord(t, i);
      const b = el('button', `dtile dlevel${map ? '' : ' soon'}${rec ? ' cleared' : ''}`);
      b.type = 'button';
      const parts: (HTMLElement | string)[] = [el('strong', 'dlevel-no', String(i + 1))];
      if (map) {
        parts.push(starRow(rec?.stars ?? 0), el('small', 'dlevel-diff', diff(map.difficulty ?? 1)));
        if (rec) parts.push(el('small', 'dlevel-best', `${formatTime(rec.best)}s`));
        b.title = `Level ${i + 1} · ${map.title}\nDifficulty ${(map.difficulty ?? 1).toFixed(2)}`;
        b.addEventListener('click', () => this.onPlay(t, i));
        first ??= b;
      } else {
        parts.push(el('small', 'dlevel-best', 'Soon'));
        b.disabled = true;
      }
      b.append(inner(...parts));
      tiles.push(b);
    }
    lattice.append(...tiles);
    // Long custom packs: more zig-zag rows (the screen scrolls past what fits)
    const size = placeLattice(tiles, 92, slots > 42 ? 9 : 7);
    lattice.style.width = `${size.w}px`;
    lattice.style.height = `${size.h}px`;
    const wrap = el('div', 'lattice-wrap');
    wrap.append(lattice);
    const ready = t.levels.length;
    this.levelsRoot.replaceChildren(
      this.header(t.info.name, `★ ${themeStars(t)} / ${maxStars(t)} · ${diff(averageDifficulty(t.levels))}${t.official && ready < LEVELS_PER_THEME ? ` · ${ready} of ${LEVELS_PER_THEME} levels available` : ` · ${ready} levels`}`, () => this.onBack('levels')),
      wrap,
    );
    requestAnimationFrame(() => {
      this.fit();
      first?.focus({ preventScroll: true });
    });
  }
}
