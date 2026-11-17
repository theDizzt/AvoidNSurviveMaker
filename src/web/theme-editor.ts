import { fontPicker } from './font-picker';
import { levelLabel } from '../core/level';
import { compileMap } from '../core/object';
import {
  averageDifficulty, blankThemeInfo, DEFAULT_BADGE, LEVELS_PER_THEME, MAX_PACK_LEVELS, validateThemeInfo,
  type BadgeFont, type BadgeKind, type BadgeStyle, type ThemeEntry,
} from '../core/theme-pack';
import type { MapData } from '../core/types';
import { createEmptyMap, validateMap, validatePack } from '../core/validate';
import { badgeImage, drawLevelBadge } from './badge';
import { beginFrame, COLORS, drawMap, fitCanvas } from './render';
import { renderThemePanel } from './theme-panel';
import { ScreenDesigner, type ScreenKind } from './screen-designer';
import { ensureFonts } from './screen-render';
import { customStoredTheme, OFFICIAL_THEMES, setCustomTheme, type StoredTheme } from './theme-registry';
import { download, fileToDataUrl, readThemeZip, urlToDataUrl, writeThemeZip } from './theme-zip';

/**
 * Theme editor (main menu): everything that makes a world look and feel its own — maze colors,
 * the in-game level badge, cover image and info — plus its list of levels. Saves as a theme pack
 * zip (the same layout as a folder in themes/), or becomes the custom pack on the world screen.
 */

const DRAFT_KEY = 'avoid-n-survive:theme-draft';

const BADGE_KINDS: [BadgeKind, string][] = [
  ['pill', 'Rounded plate'], ['disc', 'Vinyl record'], ['emblem', 'Snowflake emblem'], ['plate', 'Gear plate'],
  ['slant', 'Slanted band'], ['ring', 'Wood slice'], ['image', 'Custom image'],
];
const BADGE_FONTS: [BadgeFont, string][] = [['title', 'Title'], ['main', 'Rounded'], ['serif', 'Serif'], ['heavy', 'Heavy'], ['timer', 'Digital']];

/** A small sample maze for themes without levels yet */
function demoMap(): MapData {
  return {
    ...createEmptyMap(),
    objects: [
      { role: 'path', shape: { type: 'rect', x: 0, y: 200, w: 960, h: 140 } },
      { role: 'path', shape: { type: 'ellipse', cx: 480, cy: 270, rx: 150, ry: 150 } },
      { role: 'wall', shape: { type: 'rect', x: 330, y: 200, w: 24, h: 90 } },
      { role: 'wall', shape: { type: 'rect', x: 610, y: 250, w: 24, h: 90 } },
      { role: 'wall', shape: { type: 'rect', x: 470, y: 180, w: 20, h: 70 }, rotation: { pivot: { x: 480, y: 270 }, speed: 60, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 } },
    ],
    title: 'Sample Level',
    level: 1,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class ThemeEditor {
  onBack: () => void = () => {};
  /** Play the draft as the custom pack */
  onPlayCustom: () => void = () => {};
  /** The map open in the map editor (to add it as a level) */
  getEditorMap: () => MapData | null = () => null;

  private draft: StoredTheme = { info: blankThemeInfo(), levels: [], images: {} };
  private tab: 'game' | ScreenKind = 'game';
  private tabs!: HTMLElement;
  private stageHost!: HTMLElement;
  private screenPanel!: HTMLElement;
  private designer!: ScreenDesigner;
  /** Parts of the side column shown on the in-game tab */
  private gameParts: HTMLElement[] = [];
  private previewIndex = 0;
  private visible = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly form: HTMLElement;
  private readonly levelList: HTMLElement;
  private readonly tilePreview: HTMLElement;
  private readonly status: HTMLElement;
  private readonly zipInput: HTMLInputElement;
  private readonly mapInput: HTMLInputElement;
  private compiled: ReturnType<typeof compileMap> | null = null;
  /** JSON of the map `compiled` was built from (null = rebuild) */
  private compiledFor: string | null = null;

  constructor(root: HTMLElement) {
    this.restoreDraft();
    this.canvas = el('canvas', 'te-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.form = el('div', 'te-form panel');
    this.levelList = el('ol', 'te-levels');
    this.tilePreview = el('div', 'te-tile');
    this.status = el('p', 'te-status muted');
    this.zipInput = Object.assign(el('input'), { type: 'file', accept: '.zip,application/zip', hidden: true });
    this.zipInput.addEventListener('change', () => void this.importZip());
    this.mapInput = Object.assign(el('input'), { type: 'file', accept: '.json,application/json', multiple: true, hidden: true });
    this.mapInput.addEventListener('change', () => void this.addMapFiles());

    const head = el('header', 'dhead');
    const back = el('button', 'dback');
    back.type = 'button';
    back.title = 'Back (Esc)';
    back.setAttribute('aria-label', 'Back');
    back.append(Object.assign(el('span', 'dtile-in'), { textContent: '←' }));
    back.addEventListener('click', () => this.onBack());
    const titles = el('div', 'dhead-titles');
    titles.append(el('h2', 'dhead-title', 'Theme Editor'), el('p', 'dhead-sub', 'Maze colors, level badge, cover and levels of a world · saved as a theme pack (.zip)'));
    const actions = el('div', 'dhead-right te-actions');
    const btn = (text: string, fn: () => void, cls = '') => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    actions.append(
      btn('📂 Import .zip', () => this.zipInput.click()),
      btn('💾 Export .zip', () => this.exportZip()),
      btn('▶ Play as custom pack', () => this.playCustom(), 'primary'),
    );
    head.append(back, titles, actions);

    const side = el('div', 'te-side');
    const tabs = el('div', 'te-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [k, label] of [['game', 'In-game'], ['select', 'Level select']] as const) {
      const t = el('button', '', label);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.dataset.tab = k;
      t.addEventListener('click', () => this.setTab(k));
      tabs.append(t);
    }
    this.tabs = tabs;
    this.stageHost = el('div', 'te-stage');
    this.screenPanel = el('section', 'te-screen-panel panel');
    this.designer = new ScreenDesigner(this.stageHost, this.screenPanel, () => this.draft, () => this.save(), (f, folder) => this.storeFile(f, folder));
    const levelsBox = el('section', 'te-levels-box panel');
    const levelHead = el('div', 'te-levels-head');
    levelHead.append(el('h3', '', 'Levels'));
    const levelBtns = el('div', 'actions');
    levelBtns.append(
      btn('+ Map files', () => this.mapInput.click()),
      btn('+ Map editor pack', () => this.addFromEditorPack()),
      btn('+ Open map', () => this.addEditorMap()),
    );
    levelsBox.append(levelHead, this.levelList, levelBtns);
    const previewRow = el('div', 'te-preview-row');
    previewRow.append(this.tilePreview);
    const canvasBox = el('div', 'te-canvas-box');
    canvasBox.append(this.canvas);
    this.gameParts = [canvasBox, previewRow, levelsBox];
    side.append(tabs, canvasBox, this.stageHost, previewRow, levelsBox, this.screenPanel, this.status);

    const body = el('div', 'te-body');
    body.append(this.form, side);
    root.replaceChildren(head, body, this.zipInput, this.mapInput);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) this.onBack();
    });
    window.addEventListener('resize', () => this.visible && this.fit());
    const loop = () => {
      if (this.visible) this.drawPreview();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  show(): void {
    this.visible = true;
    this.renderForm();
    this.renderLevels();
    this.setTab(this.tab);
    requestAnimationFrame(() => this.fit());
  }

  private setTab(tab: 'game' | ScreenKind): void {
    this.tab = tab;
    for (const t of this.tabs.querySelectorAll<HTMLElement>('button')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    const game = tab === 'game';
    for (const p of this.gameParts) p.hidden = !game;
    this.stageHost.hidden = game;
    this.screenPanel.hidden = game;
    if (!game) this.designer.open(tab);
    else requestAnimationFrame(() => this.fit());
  }

  /** Put an uploaded file into the pack under folder/, returning its path */
  private async storeFile(f: File, folder: string): Promise<string> {
    if (f.size > 6 * 1024 * 1024) {
      alert('Please use files under 6 MB.');
      throw new Error('too large');
    }
    const clean = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    let name = `${folder}/${clean}`;
    for (let k = 2; this.draft.images[name]; k++) name = `${folder}/${k}-${clean}`;
    this.draft.images[name] = await fileToDataUrl(f);
    return name;
  }

  hide(): void {
    this.visible = false;
  }

  private fit(): void {
    fitCanvas(this.canvas, this.previewMap());
  }

  // ───────────────────────── State ─────────────────────────

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as StoredTheme;
      this.draft = { info: validateThemeInfo(d.info), levels: (d.levels ?? []).map((m) => validateMap(m)), images: d.images ?? {} };
    } catch {
      /* no draft */
    }
  }

  private save(): void {
    this.compiledFor = null;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(this.draft));
    } catch {
      this.status.textContent = 'The draft is too large to keep in this browser — export it as a .zip to keep it.';
    }
    this.renderTile();
  }

  private flash(text: string): void {
    this.status.textContent = text;
  }

  private async load(entry: ThemeEntry | StoredTheme): Promise<void> {
    const images: Record<string, string> = {};
    if ('images' in entry) Object.assign(images, entry.images);
    else {
      // Official theme: turn its image files into data so they go into an exported zip
      for (const [name, url] of [[entry.info.cover, entry.coverUrl], [entry.info.style.badge.image, entry.badgeUrl]]) {
        if (name && url) {
          try {
            images[name] = await urlToDataUrl(url);
          } catch {
            /* image missing */
          }
        }
      }
    }
    this.draft = { info: structuredClone(entry.info), levels: structuredClone(entry.levels), images };
    this.previewIndex = 0;
    this.save();
    this.renderForm();
    this.renderLevels();
    this.setTab(this.tab);
    this.fit();
  }

  private async importZip(): Promise<void> {
    const f = this.zipInput.files?.[0];
    this.zipInput.value = '';
    if (!f) return;
    try {
      await this.load(await readThemeZip(f));
      this.flash(`Loaded "${this.draft.info.name}" (${this.draft.levels.length} levels).`);
    } catch (err) {
      alert(`Couldn't load the pack: ${(err as Error).message}`);
    }
  }

  private exportZip(): void {
    download(writeThemeZip(this.draft), `${this.draft.info.id || 'theme'}.zip`);
    this.flash('Exported. Unzip it into a folder in themes/ (e.g. themes/07-my-theme/) to make it an official theme.');
  }

  private playCustom(): void {
    if (!this.draft.levels.length) return alert('Add at least one level first.');
    if (!setCustomTheme(structuredClone(this.draft))) alert('This pack is too large to keep after a reload, but you can play it now.');
    this.onPlayCustom();
  }

  private addLevels(maps: MapData[]): void {
    const room = MAX_PACK_LEVELS - this.draft.levels.length;
    if (room <= 0) return alert(`A pack holds at most ${MAX_PACK_LEVELS} levels.`);
    this.draft.levels.push(...maps.slice(0, room));
    this.save();
    this.renderLevels();
  }

  private async addMapFiles(): Promise<void> {
    const files = [...(this.mapInput.files ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    this.mapInput.value = '';
    const maps: MapData[] = [];
    for (const f of files) {
      try {
        const data = JSON.parse(await f.text()) as Record<string, unknown>;
        // A map pack (from the map editor) adds all of its levels
        if (data && data.pack !== undefined) maps.push(...validatePack(data).levels);
        else maps.push(validateMap(data));
      } catch (err) {
        alert(`${f.name}: ${(err as Error).message}`);
      }
    }
    if (maps.length) this.addLevels(maps);
  }

  private addFromEditorPack(): void {
    try {
      const raw = localStorage.getItem('avoid-n-survive:pack');
      const pack = raw ? (JSON.parse(raw) as { pack?: unknown }).pack : null;
      const levels = pack ? validatePack(pack).levels : [];
      if (!levels.length) return alert('The map editor\'s map pack is empty. Build one under "Map pack" in the editor.');
      this.addLevels(levels);
    } catch (err) {
      alert(`Couldn't read the map editor's pack: ${(err as Error).message}`);
    }
  }

  private addEditorMap(): void {
    const m = this.getEditorMap();
    if (m) this.addLevels([validateMap(m)]);
  }

  // ───────────────────────── Form ─────────────────────────

  private field(label: string, control: HTMLElement, wide = false): HTMLElement {
    const l = el('label', wide ? 'field wide' : 'field');
    l.append(el('span', '', label), control);
    return l;
  }

  private text(value: string, apply: (v: string) => void, opts: { max?: number; type?: string; multiline?: boolean } = {}): HTMLElement {
    const input = opts.multiline ? el('textarea') : el('input');
    if (input instanceof HTMLInputElement) input.type = opts.type ?? 'text';
    if (opts.max) input.maxLength = opts.max;
    input.value = value;
    input.addEventListener('change', () => {
      apply(input.value);
      this.save();
    });
    return input;
  }

  private color(value: string, apply: (v: string) => void): HTMLInputElement {
    const input = el('input');
    input.type = 'color';
    input.value = value;
    input.addEventListener('input', () => {
      apply(input.value.toLowerCase());
      this.save();
    });
    return input;
  }

  private select<T extends string>(value: T, options: [T, string][], apply: (v: T) => void): HTMLSelectElement {
    const s = el('select');
    s.append(...options.map(([v, t]) => new Option(t, v, false, v === value)));
    s.addEventListener('change', () => {
      apply(s.value as T);
      this.save();
    });
    return s;
  }

  /** Image picker: stores the file in the pack under `name` */
  private image(current: string | undefined, fallbackName: string, apply: (name: string | undefined) => void): HTMLElement {
    const wrap = el('div', 'te-image');
    const thumb = el('div', 'te-thumb');
    const url = current ? this.draft.images[current] : undefined;
    if (url) thumb.style.backgroundImage = `url("${url}")`;
    else thumb.textContent = 'None';
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) return alert('Please use an image under 4 MB.');
      const ext = f.name.split('.').pop()?.toLowerCase() || 'png';
      const name = `${fallbackName}.${ext}`;
      if (current && current !== name) delete this.draft.images[current];
      this.draft.images[name] = await fileToDataUrl(f);
      apply(name);
      this.save();
      this.renderForm();
    });
    const remove = el('button', 'danger', 'Remove');
    remove.type = 'button';
    remove.disabled = !current;
    remove.addEventListener('click', () => {
      if (current) delete this.draft.images[current];
      apply(undefined);
      this.save();
      this.renderForm();
    });
    wrap.append(thumb, input, remove);
    return wrap;
  }

  private renderForm(): void {
    const info = this.draft.info;
    const badge = info.style.badge;
    const b = (patch: Partial<BadgeStyle>) => Object.assign(badge, patch);

    // Start from an existing theme
    const source = el('select');
    source.append(new Option('Start from…', ''), new Option('Blank theme', 'blank'));
    OFFICIAL_THEMES.forEach((t, i) => source.append(new Option(`Official: ${t.info.name}`, `o${i}`)));
    if (customStoredTheme()) source.append(new Option(`Custom pack: ${customStoredTheme()!.info.name}`, 'custom'));
    source.addEventListener('change', () => {
      const v = source.value;
      source.value = '';
      if (!v || !confirm('Replace the theme being edited?')) return;
      if (v === 'blank') void this.load({ info: blankThemeInfo(), levels: [], images: {} });
      else if (v === 'custom') void this.load(customStoredTheme()!);
      else void this.load(OFFICIAL_THEMES[Number(v.slice(1))]);
    });

    const maze = el('div', 'te-maze');
    const renderMaze = () => renderThemePanel(maze, info.style.maze, (next) => {
      if (next) info.style.maze = next;
      else delete info.style.maze;
      this.save();
      renderMaze();
    });
    renderMaze();

    const showTitle = el('input');
    showTitle.type = 'checkbox';
    showTitle.checked = badge.showTitle;
    showTitle.addEventListener('change', () => {
      badge.showTitle = showTitle.checked;
      this.save();
    });
    const toggle = el('label', 'toggle');
    toggle.append(showTitle, el('span', '', 'Show the level title'));

    const cursor = this.color(info.style.cursorColor ?? COLORS.cursor, (v) => (info.style.cursorColor = v));
    const cursorReset = el('button', '', 'Default');
    cursorReset.type = 'button';
    cursorReset.addEventListener('click', () => {
      delete info.style.cursorColor;
      cursor.value = COLORS.cursor;
      this.save();
    });
    const cursorRow = el('div', 'color-row');
    cursorRow.append(cursor, cursorReset);

    const group = (...children: HTMLElement[]) => {
      const g = el('div', 'fields');
      g.append(...children);
      return g;
    };
    const section = (title: string, ...children: HTMLElement[]) => {
      const s = el('section');
      s.append(el('h3', '', title), ...children);
      return s;
    };

    this.form.replaceChildren(
      group(this.field('Load', source, true)),
      section('Theme info', group(
        this.field('Name', this.text(info.name, (v) => (info.name = v.trim() || 'Untitled theme'), { max: 60 }), true),
        this.field('ID (for saves)', this.text(info.id, (v) => (info.id = v.replace(/[^a-zA-Z0-9_-]/g, '') || 'my-theme'), { max: 60 })),
        this.field('Release date', this.text(info.released, (v) => (info.released = v), { type: 'date' })),
        this.field('Description', this.text(info.description, (v) => (info.description = v.slice(0, 1000)), { multiline: true }), true),
        this.field('Author', this.text(info.author, (v) => (info.author = v.trim()), { max: 60 })),
        this.field('Author link', this.text(info.authorUrl ?? '', (v) => {
          if (v.trim()) info.authorUrl = v.trim();
          else delete info.authorUrl;
        }, { type: 'url' })),
        this.field('Stars to unlock (official)', this.text(String(info.unlockStars), (v) => (info.unlockStars = Math.max(0, Math.round(Number(v) || 0))), { type: 'number' })),
        this.field('Tile colors', (() => {
          const row = el('div', 'color-row');
          row.append(this.color(info.colors[0], (v) => (info.colors[0] = v)), this.color(info.colors[1], (v) => (info.colors[1] = v)));
          return row;
        })()),
        this.field('Cover image (world tile)', this.image(info.cover, 'cover', (n) => {
          if (n) info.cover = n;
          else delete info.cover;
        }), true),
        this.field('Credits (shown with {credits})', this.text(info.credits ?? '', (v) => {
          if (v.trim()) info.credits = v.slice(0, 2000);
          else delete info.credits;
        }, { multiline: true }), true),
      )),
      section('Fonts', this.fontsBox()),
      section('Maze colors', maze, group(this.field('Cursor color', cursorRow, true))),
      section('Level badge', group(
        this.field('Design', this.select(badge.kind, BADGE_KINDS, (v) => b({ kind: v }))),
        this.field('Font', fontPicker(this.select(badge.font, BADGE_FONTS, (v) => b({ font: v })), badge.font)),
        this.field('Number digits', this.select(String(badge.pad) as '0' | '2' | '3', [['0', '7'], ['2', '07'], ['3', '007']], (v) => b({ pad: Number(v) }))),
        this.field('Caption', this.text(badge.caption ?? '', (v) => {
          if (v.trim()) badge.caption = v.slice(0, 40);
          else delete badge.caption;
        }, { max: 40 })),
        this.field('Main color', this.color(badge.primary, (v) => b({ primary: v }))),
        this.field('Second color', this.color(badge.secondary, (v) => b({ secondary: v }))),
        this.field('Number color', this.color(badge.numberColor, (v) => b({ numberColor: v }))),
        this.field('Title color', this.color(badge.titleColor, (v) => b({ titleColor: v }))),
        toggle,
        this.field('Badge image (Custom image design)', this.image(badge.image, 'badge', (n) => {
          if (n) badge.image = n;
          else delete badge.image;
        }), true),
      ), (() => {
        const reset = el('button', 'subtle', 'Reset badge');
        reset.type = 'button';
        reset.addEventListener('click', () => {
          info.style.badge = { ...DEFAULT_BADGE };
          this.save();
          this.renderForm();
        });
        return reset;
      })()),
    );
    this.renderTile();
  }

  /** Font files bundled in the pack, usable by name on the custom screens */
  private fontsBox(): HTMLElement {
    const info = this.draft.info;
    const box = el('div', 'te-fonts');
    for (const [i, f] of (info.fonts ?? []).entries()) {
      const row = el('div', 'te-font-row');
      const name = el('input');
      name.value = f.family;
      name.title = 'Name used in font pickers';
      name.addEventListener('change', () => {
        f.family = name.value.replace(/[^\w -]/g, '').slice(0, 40) || f.family;
        this.save();
        this.renderForm();
      });
      const sample = el('span', 'te-font-sample', 'Aa 01');
      sample.style.fontFamily = `'th-draft-${f.family}'`;
      const remove = el('button', 'danger', '✕');
      remove.type = 'button';
      remove.title = 'Remove font';
      remove.addEventListener('click', () => {
        delete this.draft.images[f.file];
        info.fonts!.splice(i, 1);
        if (!info.fonts!.length) delete info.fonts;
        this.save();
        this.renderForm();
      });
      row.append(name, sample, el('small', 'muted', f.file), remove);
      box.append(row);
    }
    const add = el('input');
    add.type = 'file';
    add.accept = '.ttf,.otf,.woff,.woff2';
    add.addEventListener('change', async () => {
      const f = add.files?.[0];
      if (!f) return;
      const file = await this.storeFile(f, 'fonts');
      const family = f.name.replace(/\.[^.]+$/, '').replace(/[^\w -]/g, '').slice(0, 40) || 'Font';
      (info.fonts ??= []).push({ family, file });
      this.save();
      this.renderForm();
    });
    const label = el('label', 'field wide');
    label.append(el('span', '', 'Add a font file (.ttf, .otf, .woff, .woff2) — then pick it for texts and level buttons'), add);
    box.append(label);
    ensureFonts(info, this.draft.images, 'th-draft');
    return box;
  }

  private renderLevels(): void {
    const levels = this.draft.levels;
    const rows = levels.map((m, i) => {
      const li = el('li', i === this.previewIndex ? 'on' : '');
      const label = el('button', 'te-level-name', `${i + 1}. ${levelLabel({ ...m, level: undefined })}`);
      label.type = 'button';
      label.title = 'Preview this level';
      label.addEventListener('click', () => {
        this.previewIndex = i;
        this.compiledFor = null;
        this.renderLevels();
      });
      const diffInput = el('input', 'te-diff');
      diffInput.type = 'number';
      diffInput.min = '1';
      diffInput.max = '10';
      diffInput.step = '0.25';
      diffInput.value = (m.difficulty ?? 1).toFixed(2);
      diffInput.title = 'Difficulty (1.00–10.00)';
      diffInput.addEventListener('change', () => {
        const v = Number(diffInput.value);
        m.difficulty = Math.round(Math.min(10, Math.max(1, Number.isFinite(v) ? v : 1)) * 100) / 100;
        this.save();
        this.renderLevels();
      });
      const tool = (t: string, title: string, fn: () => void, disabled = false) => {
        const b = el('button', '', t);
        b.type = 'button';
        b.title = title;
        b.disabled = disabled;
        b.addEventListener('click', fn);
        return b;
      };
      const move = (d: -1 | 1) => () => {
        [levels[i], levels[i + d]] = [levels[i + d], levels[i]];
        this.previewIndex = i + d;
        this.save();
        this.renderLevels();
      };
      li.append(label, diffInput,
        tool('↑', 'Move up', move(-1), i === 0),
        tool('↓', 'Move down', move(1), i === levels.length - 1),
        tool('✕', 'Remove', () => {
          levels.splice(i, 1);
          this.previewIndex = Math.min(this.previewIndex, Math.max(0, levels.length - 1));
          this.save();
          this.renderLevels();
          this.fit();
        }));
      return li;
    });
    if (!rows.length) rows.push(el('li', 'te-empty', 'No levels yet. Add map files, or the map pack you built in the Map Editor.'));
    this.levelList.replaceChildren(...rows);
    const head = this.levelList.previousElementSibling;
    if (head) {
      head.textContent = `Levels ${levels.length} · avg ◆ ${averageDifficulty(levels).toFixed(2)}${levels.length > LEVELS_PER_THEME ? ` · as an official theme only the first ${LEVELS_PER_THEME} are used` : ''}`;
    }
    this.renderTile();
  }

  /** The world tile as it will look on the world select screen */
  private renderTile(): void {
    const info = this.draft.info;
    const cover = info.cover ? this.draft.images[info.cover] : undefined;
    const grad = `linear-gradient(135deg, ${info.colors[0]}, ${info.colors[1]})`;
    const tile = el('div', 'dtile dworld te-world');
    tile.style.background = cover ? `linear-gradient(180deg, rgba(20,24,40,0.05), rgba(20,24,40,0.55)), url("${cover}") center / cover, ${grad}` : grad;
    const inner = el('span', 'dtile-in');
    inner.append(el('span', 'dworld-no', 'Preview'), el('strong', 'dworld-name', info.name), el('span', 'dworld-diff', `◆ ${averageDifficulty(this.draft.levels).toFixed(2)}`));
    tile.append(inner);
    const meta = el('div', 'te-meta');
    meta.append(
      el('strong', '', info.name),
      el('span', '', info.description || 'No description yet.'),
      el('small', 'muted', [info.author && `by ${info.author}`, info.released && `released ${info.released}`].filter(Boolean).join(' · ')),
    );
    this.tilePreview.replaceChildren(tile, meta);
  }

  // ───────────────────────── Preview ─────────────────────────

  private previewMap(): MapData {
    const style = this.draft.info.style;
    const m = this.draft.levels[this.previewIndex] ?? demoMap();
    const out: MapData = { ...m, level: m.level ?? this.previewIndex + 1, title: m.title ?? m.name.replace(/^\d+\.\s*/, '') };
    if (!out.theme && style.maze) out.theme = style.maze;
    if (!out.cursorColor && style.cursorColor) out.cursorColor = style.cursorColor;
    return out;
  }

  private drawPreview(): void {
    const map = this.previewMap();
    if (!this.compiled || this.compiledFor === null) {
      this.compiled = compileMap(map);
      this.compiledFor = JSON.stringify(map);
      fitCanvas(this.canvas, map);
    }
    const now = performance.now();
    beginFrame(this.ctx, map);
    drawMap(this.ctx, map, this.compiled, now % 600000, { now });
    const badge = this.draft.info.style.badge;
    const imgName = badge.image;
    drawLevelBadge(this.ctx, map, badge, badgeImage(imgName ? this.draft.images[imgName] : undefined), now);
  }
}
