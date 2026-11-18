import { formatTime } from '../core/simulation';
import { averageDifficulty, LEVELS_PER_THEME, levelSlots, maxStars, STARS_PER_THEME, themedLevel, type ThemeEntry } from '../core/theme-pack';
import { formatTag } from '../core/account';
import { fetchLeaderboard, type LeaderboardRow } from './auth/leaderboard';
import { badgeFontCss } from './badge';
import { renderTag } from './player-tag';
import { levelKey, levelRecord, themeStars, themeUnlocked, totalStars } from './progress';
import { customTheme, OFFICIAL_SLOTS, OFFICIAL_THEMES, setCustomTheme } from './theme-registry';
import { readThemeZip } from './theme-zip';
import type { LayoutElement, LevelButtonStyle } from '../core/screen-layout';
import type { ScreenData } from './screen-render';

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

/**
 * Colors from a theme's designed level select screen (info.screens.select): its level grid buttons
 * and Back button. The layout itself is always the standard one; only these colors carry over.
 */
function selectDesign(t: ThemeEntry): { button?: LevelButtonStyle; back?: LayoutElement; text?: string; background?: string } {
  const select = t.info.screens?.select;
  const els = select?.elements ?? [];
  return {
    button: els.find((e) => e.kind === 'levelGrid')?.button,
    back: els.find((e) => e.kind === 'back'),
    // The design's text color: its first colored text (e.g. the title)
    text: els.find((e) => e.kind === 'text' && e.color)?.color,
    background: select?.background.color,
  };
}

/**
 * Colors for the whole level select (side panel, leaderboard, stars tile) from a theme's designed
 * level select; null for themes without one (they keep the default light look).
 */
function selectPalette(t: ThemeEntry): Record<string, string> | null {
  const d = selectDesign(t);
  if (!d.button && !d.text) return null;
  const text = d.text ?? d.button?.numberColor ?? '#ffffff';
  const surface = d.background ?? d.button?.fill ?? '#202020';
  const accent = d.button?.clearedFill ?? d.button?.fill2 ?? text;
  return {
    '--th-text': text,
    '--th-surface': surface,
    '--th-accent': accent,
    '--th-border': d.button?.border ?? text,
  };
}

/** Level select: space between the side panel and the lattice, and how far it may scale up */
const LEVELS_GAP = 28;
const LEVELS_MAX_SCALE = 2;
/** Wait this long on a hovered level before loading its leaderboard */
const BOARD_DELAY_MS = 120;

/** Lay out diamonds in zig-zag rows (null = an empty slot); returns the lattice size */
function placeLattice(tiles: (HTMLElement | null)[], size: number, perRow: number, gap = 6): { w: number; h: number } {
  const step = (size * Math.SQRT2) / 2 + gap;
  const rowGap = step * 2.2;
  tiles.forEach((t, i) => {
    if (!t) return;
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
    this.fitLevels();
    const root = this.themesRoot;
    const wrap = root.querySelector<HTMLElement>('.lattice-wrap');
    const lat = root.querySelector<HTMLElement>('.lattice');
    if (!wrap || !lat || root.hidden) return;
    const w = lat.offsetWidth;
    const h = lat.offsetHeight;
    const fit = Math.min(1.2, (window.innerWidth * 0.94) / w, (window.innerHeight - 250) / h);
    wrap.style.width = `${w * fit}px`;
    wrap.style.height = `${h * fit}px`;
    lat.style.transform = `scale(${fit})`;
  }

  /**
   * Level select: the side panel and the lattice are laid out at their natural size, then scaled as
   * one piece to fill the window — up or down. Side by side or stacked, whichever ends up larger
   * (stacked wins on tall, narrow windows).
   */
  private fitLevels(): void {
    const root = this.levelsRoot;
    const box = root.querySelector<HTMLElement>('.dlevels-fit');
    const body = root.querySelector<HTMLElement>('.dlevels-body');
    const side = root.querySelector<HTMLElement>('.dside');
    const wrap = root.querySelector<HTMLElement>('.lattice-wrap');
    const lat = root.querySelector<HTMLElement>('.lattice');
    if (!box || !body || !side || !wrap || !lat || root.hidden) return;
    const lw = lat.offsetWidth;
    const lh = lat.offsetHeight;
    wrap.style.width = `${lw}px`;
    wrap.style.height = `${lh}px`;
    lat.style.transform = '';
    const sw = side.offsetWidth;
    const sh = side.offsetHeight;
    const availW = Math.max(200, root.clientWidth - 32);
    const availH = Math.max(200, window.innerHeight - 36);
    const scaleFor = (w: number, h: number) => Math.min(LEVELS_MAX_SCALE, availW / w, availH / h);
    const row = { w: sw + LEVELS_GAP + lw, h: Math.max(sh, lh) };
    const col = { w: Math.max(sw, lw), h: sh + LEVELS_GAP + lh };
    const stacked = scaleFor(col.w, col.h) > scaleFor(row.w, row.h);
    const size = stacked ? col : row;
    const scale = scaleFor(size.w, size.h);
    body.classList.toggle('stacked', stacked);
    body.style.width = `${size.w}px`;
    body.style.height = `${size.h}px`;
    body.style.transform = `scale(${scale})`;
    box.style.width = `${size.w * scale}px`;
    box.style.height = `${size.h * scale}px`;
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
    titles.append(el('h2', 'dhead-title', title));
    if (sub) titles.append(el('p', 'dhead-sub', sub));
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
    const b = el('button', `dtile dworld${planned ? ' planned' : unlocked ? '' : ' locked'}${t.official ? '' : ' custom'}`);
    b.type = 'button';
    // Coming-soon chapters show a plain dark gray tile (style.css .dworld.planned), not their cover
    if (!planned) {
      const grad = `linear-gradient(135deg, ${t.info.colors[0]}, ${t.info.colors[1]})`;
      b.style.background = t.coverUrl ? `linear-gradient(180deg, rgba(20,24,40,0.05), rgba(20,24,40,0.55)), url("${t.coverUrl}") center / cover, ${grad}` : grad;
    }
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
    // Every theme uses this layout; a theme's own designed level select screen
    // (info.screens.select) isn't used here, only its background (backdrop.ts)
    const side = this.sidePanel(t);
    const lattice = el('div', 'lattice');
    lattice.style.setProperty('--c1', t.info.colors[0]);
    lattice.style.setProperty('--c2', t.info.colors[1]);
    const design = selectDesign(t);
    if (design.button) {
      const b = design.button;
      lattice.classList.add('lv-designed');
      lattice.style.setProperty('--lv-fill', b.fill);
      lattice.style.setProperty('--lv-fill2', b.fill2 ?? b.fill);
      lattice.style.setProperty('--lv-cleared', b.clearedFill ?? b.fill);
      lattice.style.setProperty('--lv-border', b.border);
      lattice.style.setProperty('--lv-border-w', `${b.borderWidth}px`);
      lattice.style.setProperty('--lv-number', b.numberColor);
      if (b.numberGlow) lattice.style.setProperty('--lv-glow', b.numberGlow);
    }
    if (design.back) {
      const k = design.back;
      lattice.classList.add('bk-designed');
      if (k.fill) lattice.style.setProperty('--bk-fill', k.fill);
      if (k.border) lattice.style.setProperty('--bk-border', k.border);
      lattice.style.setProperty('--bk-border-w', `${k.borderWidth ?? 0}px`);
      if (k.color) lattice.style.setProperty('--bk-color', k.color);
    }
    let first: HTMLButtonElement | null = null;
    const tiles: HTMLElement[] = [];
    const slots = levelSlots(t);
    for (let i = 0; i < slots; i++) {
      const map = themedLevel(t, i);
      const rec = levelRecord(t, i);
      // .alt: every other button (the design's second fill)
      const b = el('button', `dtile dlevel${map ? '' : ' soon'}${rec ? ' cleared' : ''}${i % 2 ? ' alt' : ''}`);
      b.type = 'button';
      const parts: (HTMLElement | string)[] = [el('strong', 'dlevel-no', String(i + 1))];
      if (map) {
        parts.push(starRow(rec?.stars ?? 0), el('small', 'dlevel-diff', diff(map.difficulty ?? 1)));
        if (rec) parts.push(el('small', 'dlevel-best', `${formatTime(rec.best)}s`));
        b.title = `Level ${i + 1} · ${map.title}\nDifficulty ${(map.difficulty ?? 1).toFixed(2)}`;
        b.addEventListener('click', () => this.onPlay(t, i));
        b.addEventListener('pointerenter', () => side.show(i));
        b.addEventListener('focus', () => side.show(i));
        first ??= b;
      } else {
        parts.push(el('small', 'dlevel-best', 'Soon'));
        b.disabled = true;
      }
      b.append(inner(...parts));
      tiles.push(b);
    }
    // Long custom packs: more zig-zag rows (the screen scrolls past what fits)
    const perRow = slots > 42 ? 9 : 7;
    // One more row under the levels: total stars below the 3rd column (level 17 of 21), Back below
    // the 5th (level 19). Both stay in the upper half of the zig-zag, so they interlock with the row above.
    const extra = Math.ceil(slots / perRow) * perRow;
    const layout: (HTMLElement | null)[] = Array.from({ length: extra + perRow }, (_, i) => tiles[i] ?? null);
    layout[extra + 2] = this.starsTile();
    layout[extra + 4] = this.backTile();
    lattice.append(...layout.filter((x): x is HTMLElement => !!x));
    const size = placeLattice(layout, 92, perRow);
    lattice.style.width = `${size.w}px`;
    lattice.style.height = `${size.h}px`;
    const wrap = el('div', 'lattice-wrap');
    wrap.append(lattice);
    const body = el('div', 'dlevels-body');
    body.append(side.panel, wrap);
    // The theme's level number font (its badge font) for the theme title and the level numbers
    body.style.setProperty('--level-font', badgeFontCss(t.info.style.badge.font));
    // The whole screen follows the theme's designed colors (style.css .th-designed)
    const palette = selectPalette(t);
    body.classList.toggle('th-designed', !!palette);
    for (const [k, v] of Object.entries(palette ?? {})) body.style.setProperty(k, v);
    const fitBox = el('div', 'dlevels-fit');
    fitBox.append(body);
    const firstPlayable = Array.from({ length: slots }, (_, i) => i).find((i) => themedLevel(t, i));
    if (firstPlayable !== undefined) side.show(firstPlayable);
    // No header: total stars and Back are diamonds in the lattice
    this.levelsRoot.replaceChildren(fitBox);
    requestAnimationFrame(() => {
      this.fit();
      first?.focus({ preventScroll: true });
    });
  }

  /** Level select: total stars collected in the official worlds, as a lattice diamond */
  private starsTile(): HTMLElement {
    const d = el('div', 'dtile dlevel dlevel-stars');
    d.title = 'Stars collected in the official worlds';
    d.append(inner(el('span', 'dtotal-star', '★'), el('strong', 'dlevel-total', String(totalStars()))));
    return d;
  }

  /** Level select: back to the chapter select, as a lattice diamond */
  private backTile(): HTMLElement {
    const b = el('button', 'dtile dlevel dlevel-back');
    b.type = 'button';
    b.title = 'Back (Esc)';
    b.append(inner(el('strong', '', 'Back')));
    b.addEventListener('click', () => this.onBack('levels'));
    return b;
  }

  /**
   * Level select side panel: the theme (chapter number, name, stars and difficulty, description) on
   * top, and below it the leaderboard of the hovered / focused level (verified records only, see
   * auth/leaderboard.ts).
   */
  private sidePanel(t: ThemeEntry): { panel: HTMLElement; show: (index: number) => void } {
    const panel = el('aside', 'dside');
    panel.setAttribute('aria-label', 'Chapter and leaderboard');

    const about = el('section', 'dside-card dside-theme');
    const chapter = OFFICIAL_THEMES.indexOf(t);
    about.append(el('span', 'dside-chapter', chapter >= 0 ? `Chapter ${String(chapter + 1).padStart(2, '0')}` : 'Custom pack'));
    about.append(el('h3', 'dside-name', t.info.name));
    const score = el('span', 'dside-score');
    score.append(el('span', 'dside-star', '★'), ` ${themeStars(t)} / ${maxStars(t)} · ${diff(averageDifficulty(t.levels))}`);
    about.append(score);
    if (t.info.description) about.append(el('p', 'dside-desc', t.info.description));
    const meta = [t.info.author ? `by ${t.info.author}` : '', t.info.released ? `released ${t.info.released}` : ''].filter(Boolean).join(' · ');
    if (meta) about.append(el('span', 'dside-meta', meta));

    const board = el('section', 'dside-card dside-board');
    board.setAttribute('aria-live', 'polite');
    const head = el('div', 'dside-board-head');
    const title = el('h4', 'dside-board-title', '');
    const sub = el('small', 'dside-board-sub', '');
    head.append(title, sub);
    const content = el('div', 'dside-board-body');
    board.append(head, content);
    panel.append(about, board);

    const note = (text: string) => content.replaceChildren(el('p', 'dside-note', text));
    let shown = -1;
    let timer: number | undefined;
    let token = 0;
    const show = (i: number) => {
      if (i === shown) return;
      shown = i;
      const map = themedLevel(t, i);
      // 'Level 1-01' (chapter-level); custom packs have no chapter number
      const no = String(i + 1).padStart(2, '0');
      title.textContent = chapter >= 0 ? `Level ${chapter + 1}-${no}` : `Level ${no}`;
      sub.textContent = map?.title ?? '';
      window.clearTimeout(timer);
      const run = ++token;
      if (!t.official) return note('Leaderboards are kept for the official chapters only.');
      note('Loading…');
      timer = window.setTimeout(() => {
        void fetchLeaderboard(levelKey(t, i)).then((r) => {
          if (run !== token) return; // another level was hovered meanwhile
          if (!r.ok) {
            return note(r.reason === 'unconfigured'
              ? 'Leaderboards need accounts, which are not set up on this server.'
              : r.reason === 'missing'
                ? 'Leaderboards are not set up on the server yet.'
                : "Couldn't load the leaderboard. Check your connection.");
          }
          if (!r.rows.length) return note('No records yet. Be the first to clear it!');
          content.replaceChildren(this.boardList(r.rows));
        });
      }, BOARD_DELAY_MS);
    };
    return { panel, show };
  }

  private boardList(rows: LeaderboardRow[]): HTMLElement {
    const list = el('ol', 'dboard');
    let last = 0;
    for (const r of rows) {
      // The player's own row below the top places: mark the gap
      if (last > 0 && r.place > last + 1) list.append(el('li', 'dboard-gap', '⋯'));
      last = r.place;
      const li = el('li', `dboard-row${r.is_me ? ' me' : ''}${r.place <= 3 ? ` top${r.place}` : ''}`);
      const name = el('span', 'dboard-name');
      renderTag(name, formatTag(r.nickname, r.discriminator));
      li.append(el('span', 'dboard-place', String(r.place)), name, el('span', 'dboard-time', `${formatTime(r.best_ms)}s`), starRow(r.stars));
      if (r.is_me) li.title = 'Your record';
      list.append(li);
    }
    return list;
  }
}
