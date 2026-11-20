import { uniqueLevelIds } from '../core/record-identity';
import { DEFAULT_LANGUAGE, language, LANGUAGES, t as tr } from './i18n';
import { fontPicker } from './font-picker';
import { gameAudio } from './audio';
import { levelLabel } from './localized/level';
import { compileMap } from '../core/object';
import { levelMaze } from '../core/theme-pack';
import {
  averageDifficulty, blankThemeInfo, DEFAULT_BADGE, LEVELS_PER_THEME, localizeThemeInfo, MAX_PACK_LEVELS, validateThemeInfo,
  type BadgeFont, type BadgeKind, type BadgeStyle, type ThemeEntry, type ThemeInfo, type ThemeText,
} from './localized/theme-pack';
import type { MapData } from '../core/types';
import type { TextEffects } from '../core/text-effects';
import { createEmptyMap, validateMap, validatePack } from './localized/validate';
import { badgeImage, drawLevelBadge } from './badge';
import { beginFrame, drawMap, fitCanvas } from './render';
import { renderThemePanel } from './theme-panel';
import { ScreenDesigner, type ScreenKind } from './screen-designer';
import { ensureFonts } from './screen-render';
import { bundledThemeById, bundledThemeOptions, customStoredTheme, OFFICIAL_THEMES, CUSTOM_THEME_PRESETS, setCustomTheme, themeFileMazePresets, type StoredTheme } from './theme-registry';
import { download, fileToDataUrl, readThemeZip, urlToDataUrl, writeThemeZip } from './theme-zip';

/**
 * Theme editor (main menu): everything that makes a world look and feel its own — maze colors,
 * the in-game level badge, cover image and info — plus its list of levels. Saves as a theme pack
 * zip (the same layout as a folder in themes/), or becomes the custom pack on the world screen.
 */

const DRAFT_KEY = 'avoid-n-survive:theme-draft';

const BADGE_KINDS: [BadgeKind, string][] = [
  ['pill', tr('te.roundedPlate')], ['disc', tr('te.vinylRecord')], ['emblem', tr('te.snowflakeEmblem')], ['plate', tr('te.gearPlate')],
  ['slant', tr('te.slantedBand')], ['ring', tr('te.woodSlice')], ['image', tr('te.customImage')],
];
const BADGE_FONTS: [BadgeFont, string][] = [['title', tr('te.title')], ['main', tr('te.rounded')], ['serif', tr('te.serif')], ['heavy', tr('te.heavy')], ['timer', tr('te.digital')]];

/** A small sample maze for themes without levels yet */
function demoMap(): MapData {
  return {
    ...createEmptyMap(),
    // Drawn on a 960×540 map, whatever size new maps start at
    width: 960,
    height: 540,
    start: { x: 30, y: 240, w: 60, h: 60 },
    goal: { x: 870, y: 240, w: 60, h: 60 },
    objects: [
      { role: 'path', shape: { type: 'rect', x: 0, y: 200, w: 960, h: 140 } },
      { role: 'path', shape: { type: 'ellipse', cx: 480, cy: 270, rx: 150, ry: 150 } },
      { role: 'wall', shape: { type: 'rect', x: 330, y: 200, w: 24, h: 90 } },
      { role: 'wall', shape: { type: 'rect', x: 610, y: 250, w: 24, h: 90 } },
      { role: 'wall', shape: { type: 'rect', x: 470, y: 180, w: 20, h: 70 }, rotation: { pivot: { x: 480, y: 270 }, speed: 60, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 } },
    ],
    title: tr('te.sampleLevel'),
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
    back.title = tr('common.backEsc');
    back.setAttribute('aria-label', tr('common.back'));
    const label = el('span', 'dtile-in');
    label.append(el('strong', '', tr('common.back')));
    back.append(label);
    back.addEventListener('click', () => this.onBack());
    const titles = el('div', 'dhead-titles');
    titles.append(el('h2', 'dhead-title', tr('common.themeEditor')), el('p', 'dhead-sub', tr('te.mazeColorsLevelBadgeCover')));
    const actions = el('div', 'dhead-right te-actions');
    const btn = (text: string, fn: () => void, cls = '') => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    actions.append(
      btn(tr('te.importZip'), () => this.zipInput.click()),
      btn(tr('te.exportZip'), () => this.exportZip()),
      btn(tr('te.playAsCustomPack'), () => this.playCustom(), 'primary'),
    );
    head.append(back, titles, actions);

    const side = el('div', 'te-side');
    const tabs = el('div', 'te-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [k, label] of [['game', tr('te.inGame')], ['select', tr('te.levelSelect')]] as const) {
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
    levelHead.append(el('h3', '', tr('te.levels')));
    const levelBtns = el('div', 'actions');
    levelBtns.append(
      btn(tr('te.mapFiles'), () => this.mapInput.click()),
      btn(tr('te.mapEditorPack'), () => this.addFromEditorPack()),
      btn(tr('te.openMap'), () => this.addEditorMap()),
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
      alert(tr('te.pleaseUseFilesUnder6'));
      throw new Error('too large');
    }
    const clean = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    let name = `${folder}/${clean}`;
    for (let k = 2; this.draft.images[name]; k++) name = `${folder}/${k}-${clean}`;
    this.draft.images[name] = await fileToDataUrl(f);
    return name;
  }

  hide(): void {
    gameAudio.setMusic(null);
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
      this.status.textContent = tr('te.theDraftIsTooLarge');
    }
    this.renderTile();
  }

  private flash(text: string): void {
    this.status.textContent = text;
  }

  private async load(entry: ThemeEntry | StoredTheme): Promise<void> {
    gameAudio.setMusic(null);
    const images: Record<string, string> = {};
    if ('images' in entry) Object.assign(images, entry.images);
    else {
      // Preserve every bundled asset, including custom screen images and fonts, in the draft.
      for (const [name, url] of Object.entries(entry.assets)) {
        if (name && url) {
          try {
            images[name] = await urlToDataUrl(url);
          } catch {
            /* image missing */
          }
        }
      }
    }
    this.draft = { info: structuredClone(('source' in entry ? entry.source : undefined) ?? entry.info), levels: structuredClone(entry.levels), images };
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
      this.flash(tr('te.loaded', { name: this.draft.info.name, n: this.draft.levels.length }));
    } catch (err) {
      alert(tr('campaign.packLoadFailed', { message: (err as Error).message }));
    }
  }

  private exportZip(): void {
    download(writeThemeZip(this.draft), `${this.draft.info.id || 'theme'}.zip`);
    this.flash(tr('te.exported'));
  }

  private playCustom(): void {
    if (!this.draft.levels.length) return alert(tr('te.addAtLeastOneLevel'));
    if (!setCustomTheme(structuredClone(this.draft))) alert(tr('campaign.packTooLarge'));
    this.onPlayCustom();
  }

  private addLevels(maps: MapData[]): void {
    const room = MAX_PACK_LEVELS - this.draft.levels.length;
    if (room <= 0) return alert(tr('te.packFull', { max: MAX_PACK_LEVELS }));
    // A map's own theme pick (for playing it on its own) gives way to the pack's settings:
    // drop it, and the maze colors it copied, so the level follows the pack
    const added = maps.slice(0, room).map((map) => {
      if (!map.themeId) return map;
      const out = { ...map };
      const entry = bundledThemeById(map.themeId);
      const copied = entry && [entry.info.style.maze, ...(entry.info.style.designs ?? []).map((d) => d.maze)]
        .some((maze) => maze && JSON.stringify(maze) === JSON.stringify(map.theme));
      if (copied) delete out.theme;
      delete out.themeId;
      return out;
    });
    this.draft.levels.push(...uniqueLevelIds(added, this.draft.levels.flatMap((m) => (m.id ? [m.id] : []))));
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
      if (!levels.length) return alert(tr('te.theMapEditorSMap'));
      this.addLevels(levels);
    } catch (err) {
      alert(tr('te.readPackFailed', { message: (err as Error).message }));
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

  /** Text effect rows (outline, shadow, neon, gradient, 3D): a checkbox, a color and maybe a size each */
  private fxFields(current: TextEffects | undefined, apply: (fx: TextEffects | undefined) => void): HTMLElement[] {
    const fx: TextEffects = { ...current };
    type ColorKey = 'outline' | 'shadow' | 'glow' | 'gradient' | 'depthColor';
    type SizeKey = 'outlineWidth' | 'depth';
    const row = (label: string, key: ColorKey, def: string, size?: { key: SizeKey; def: number; min: number; max: number; step: number }) => {
      const on = el('input');
      on.type = 'checkbox';
      on.checked = key === 'depthColor' ? !!fx.depth : !!fx[key];
      const c = el('input');
      c.type = 'color';
      c.value = fx[key] ?? def;
      const n = size ? el('input') : null;
      if (n && size) {
        n.type = 'number';
        n.min = String(size.min);
        n.max = String(size.max);
        n.step = String(size.step);
        n.value = String(fx[size.key] ?? size.def);
      }
      const sync = () => {
        if (on.checked) {
          fx[key] = c.value.toLowerCase();
          if (n && size) {
            const v = Number(n.value);
            const clamped = Math.min(size.max, Math.max(size.min, Number.isFinite(v) ? v : size.def));
            fx[size.key] = size.key === 'depth' ? Math.round(clamped) : clamped;
          }
        } else {
          delete fx[key];
          if (size) delete fx[size.key];
        }
        c.disabled = !on.checked;
        if (n) n.disabled = !on.checked;
        apply(Object.keys(fx).length ? { ...fx } : undefined);
        this.save();
      };
      c.disabled = !on.checked;
      if (n) n.disabled = !on.checked;
      on.addEventListener('change', sync);
      c.addEventListener('input', () => on.checked && sync());
      n?.addEventListener('change', () => on.checked && sync());
      const wrap = el('div', 'te-fx-row');
      wrap.append(on, c, ...(n ? [n] : []));
      return this.field(label, wrap);
    };
    return [
      row(tr('common.outline'), 'outline', '#1a2233', { key: 'outlineWidth', def: 2, min: 0.5, max: 20, step: 0.5 }),
      row(tr('fx.shadow'), 'shadow', '#000000'),
      row(tr('fx.glow'), 'glow', '#3ae8ff'),
      row(tr('fx.gradient'), 'gradient', '#ff7a3a'),
      row(tr('fx.depth'), 'depthColor', '#1a2233', { key: 'depth', def: 4, min: 1, max: 30, step: 1 }),
    ];
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
    else thumb.textContent = tr('common.none');
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) return alert(tr('te.pleaseUseAnImageUnder'));
      const ext = f.name.split('.').pop()?.toLowerCase() || 'png';
      const name = `${fallbackName}.${ext}`;
      if (current && current !== name) delete this.draft.images[current];
      this.draft.images[name] = await fileToDataUrl(f);
      apply(name);
      this.save();
      this.renderForm();
    });
    const remove = el('button', 'danger', tr('te.remove'));
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

  private musicControl(): HTMLElement {
    const row = el('div', 'actions');
    const info = this.draft.info;
    row.append(el('span', 'muted', info.music ?? tr('te.noMusic')));
    const input = el('input');
    input.type = 'file';
    input.accept = '.mp3,.ogg,.wav,.m4a,.aac,.flac';
    input.setAttribute('aria-label', tr('te.themeBackgroundMusic'));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!/\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
        this.flash(tr('music.tooLarge'));
        input.value = '';
        return;
      }
      const draft = this.draft;
      input.disabled = true;
      try {
        const url = await fileToDataUrl(file);
        if (this.draft !== draft) return;
        const name = `audio/background.${file.name.split('.').pop()!.toLowerCase()}`;
        if (info.music) delete draft.images[info.music];
        draft.images[name] = url;
        info.music = name;
        gameAudio.setMusic(null);
        this.save();
        this.renderForm();
      } catch { this.flash(tr('te.musicReadFailed')); }
      finally { input.disabled = false; }
    });
    const preview = el('button', '', tr('te.previewMusic'));
    preview.type = 'button';
    preview.disabled = !info.music || !this.draft.images[info.music];
    preview.addEventListener('click', () => gameAudio.setMusic(info.music ? this.draft.images[info.music] ?? null : null));
    const stop = el('button', '', tr('te.stop'));
    stop.type = 'button';
    stop.addEventListener('click', () => gameAudio.setMusic(null));
    const remove = el('button', '', tr('te.removeMusic'));
    remove.type = 'button';
    remove.disabled = !info.music;
    remove.addEventListener('click', () => {
      gameAudio.setMusic(null);
      if (info.music) delete this.draft.images[info.music];
      delete info.music;
      this.save();
      this.renderForm();
    });
    row.append(input, preview, stop, remove);
    return row;
  }

  /**
   * One section per non-default language: the theme's name, description, credits and badge caption
   * in that language (theme.json "i18n"). Empty fields fall back to the default text above.
   */
  private translationSections(
    info: ThemeInfo,
    section: (title: string, ...children: HTMLElement[]) => HTMLElement,
    group: (...children: HTMLElement[]) => HTMLElement,
  ): HTMLElement[] {
    return LANGUAGES.filter((l) => l.id !== DEFAULT_LANGUAGE).map((l) => {
      const get = (k: keyof ThemeText) => info.i18n?.[l.id]?.[k] ?? '';
      const set = (k: keyof ThemeText, max: number) => (v: string) => {
        const text = { ...info.i18n?.[l.id] };
        if (v.trim()) text[k] = v.slice(0, max);
        else delete text[k];
        const all = { ...info.i18n };
        if (Object.keys(text).length) all[l.id] = text;
        else delete all[l.id];
        if (Object.keys(all).length) info.i18n = all;
        else delete info.i18n;
        this.renderTile();
      };
      return section(tr('te.translation', { language: l.label }),
        el('p', 'muted', tr('te.translationHint')),
        group(
          this.field(tr('te.name'), this.text(get('name'), set('name', 60), { max: 60 }), true),
          this.field(tr('te.description'), this.text(get('description'), set('description', 1000), { multiline: true }), true),
          this.field(tr('te.creditsShownWithCredits'), this.text(get('credits'), set('credits', 2000), { multiline: true }), true),
          this.field(tr('te.caption'), this.text(get('caption'), set('caption', 40), { max: 40 })),
        ));
    });
  }

  private renderForm(): void {
    const info = this.draft.info;
    const badge = info.style.badge;
    const b = (patch: Partial<BadgeStyle>) => Object.assign(badge, patch);

    // Start from an existing theme
    const source = el('select');
    source.append(new Option(tr('te.startFrom'), ''), new Option(tr('te.blankTheme'), 'blank'));
    const chapters = el('optgroup');
    chapters.label = tr('te.officialChapters');
    OFFICIAL_THEMES.forEach((t, i) => chapters.append(new Option(tr('te.chapterOption', { n: i + 1, name: t.info.name }), `o${i}`)));
    const unused = el('optgroup');
    unused.label = tr('te.customThemePresets');
    CUSTOM_THEME_PRESETS.forEach((t, i) => unused.append(new Option(t.info.name, `u${i}`)));
    source.append(chapters, unused);
    if (customStoredTheme()) source.append(new Option(tr('te.customPackOption', { name: customStoredTheme()!.info.name }), 'custom'));
    source.addEventListener('change', () => {
      const v = source.value;
      source.value = '';
      if (!v || !confirm(tr('te.replaceTheThemeBeingEdited'))) return;
      if (v === 'blank') void this.load({ info: blankThemeInfo(), levels: [], images: {} });
      else if (v === 'custom') void this.load(customStoredTheme()!);
      else if (v.startsWith('u')) void this.load(CUSTOM_THEME_PRESETS[Number(v.slice(1))]);
      else void this.load(OFFICIAL_THEMES[Number(v.slice(1))]);
    });

    const maze = el('div', 'te-maze');
    const renderMaze = () => renderThemePanel(maze, info.style.maze, (next) => {
      if (next) info.style.maze = next;
      else delete info.style.maze;
      this.save();
      renderMaze();
    }, themeFileMazePresets(), false);
    renderMaze();
    const designs = el('div', 'te-designs');
    const renderDesigns = () => {
      designs.replaceChildren();
      for (const design of info.style.designs ?? []) {
        const card = el('section');
        const name = this.text(design.name, value => {
          design.name = value.trim() || design.id;
          this.renderLevels();
        }, { max: 60 });
        const remove = el('button', '', tr('te.remove'));
        remove.type = 'button';
        remove.addEventListener('click', () => {
          if (!confirm(tr('te.removeDesignConfirm'))) return;
          info.style.designs = info.style.designs?.filter(d => d !== design);
          for (const map of this.draft.levels) if (map.themeDesign === design.id) {
            delete map.themeDesign;
            delete map.theme;
          }
          this.save();
          renderDesigns();
          this.renderLevels();
        });
        const panel = el('div', 'te-maze');
        const render = () => renderThemePanel(panel, design.maze, next => {
          if (next) design.maze = next;
          else delete design.maze;
          this.save();
          render();
        }, themeFileMazePresets(), false);
        render();
        // Link a bundled theme: levels using this design wear its badge and music too
        const linkOptions: [string, string][] = [['', tr('te.linkedThemeNone')],
          ...bundledThemeOptions().filter(o => o.id !== info.id).map(o => [o.id, o.name] as [string, string])];
        const link = this.select(design.themeId ?? '', linkOptions, value => {
          const entry = value ? bundledThemeById(value) : null;
          if (entry) {
            design.themeId = value;
            if (entry.info.style.maze) design.maze = structuredClone(entry.info.style.maze);
            // A design still under its default name takes the theme's name
            const n = /^design-(\d+)$/.exec(design.id)?.[1];
            if (design.name === design.id || (n && design.name === tr('te.designNumber', { n: Number(n) }))) design.name = entry.info.name;
          } else delete design.themeId;
          this.save();
          renderDesigns();
          this.renderLevels();
        });
        card.append(this.field(tr('te.designName'), name), this.field(tr('te.linkedTheme'), link), el('p', 'muted', tr('te.linkedThemeNote')), remove, panel);
        designs.append(card);
      }
      const add = el('button', '', tr('te.addDesign'));
      add.type = 'button';
      add.addEventListener('click', () => {
        const list = info.style.designs ??= [];
        let n = 1;
        while (list.some(d => d.id === `design-${n}`)) n++;
        list.push({ id: `design-${n}`, name: tr('te.designNumber', { n }),
          ...(info.style.maze ? { maze: structuredClone(info.style.maze) } : {}) });
        this.save();
        renderDesigns();
        this.renderLevels();
      });
      designs.append(add);
    };
    renderDesigns();

    const showTitle = el('input');
    showTitle.type = 'checkbox';
    showTitle.checked = badge.showTitle;
    showTitle.addEventListener('change', () => {
      badge.showTitle = showTitle.checked;
      this.save();
    });
    const toggle = el('label', 'toggle');
    toggle.append(showTitle, el('span', '', tr('te.showTheLevelTitle')));

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
      group(this.field(tr('te.load'), source, true)),
      section(tr('te.themeInfo'), group(
        this.field(tr('te.name'), this.text(info.name, (v) => (info.name = v.trim() || tr('themePack.untitled')), { max: 60 }), true),
        this.field(tr('te.idForSaves'), this.text(info.id, (v) => (info.id = v.replace(/[^a-zA-Z0-9_-]/g, '') || 'my-theme'), { max: 60 })),
        this.field(tr('common.releaseDate'), this.text(info.released, (v) => (info.released = v), { type: 'date' })),
        this.field(tr('te.description'), this.text(info.description, (v) => (info.description = v.slice(0, 1000)), { multiline: true }), true),
        this.field(tr('common.author'), this.text(info.author, (v) => (info.author = v.trim()), { max: 60 })),
        this.field(tr('te.authorLink'), this.text(info.authorUrl ?? '', (v) => {
          if (v.trim()) info.authorUrl = v.trim();
          else delete info.authorUrl;
        }, { type: 'url' })),
        this.field(tr('te.starsToUnlockOfficial'), this.text(String(info.unlockStars), (v) => (info.unlockStars = Math.max(0, Math.round(Number(v) || 0))), { type: 'number' })),
        this.field(tr('te.tileColors'), (() => {
          const row = el('div', 'color-row');
          row.append(this.color(info.colors[0], (v) => (info.colors[0] = v)), this.color(info.colors[1], (v) => (info.colors[1] = v)));
          return row;
        })()),
        this.field(tr('te.coverImageWorldTile'), this.image(info.cover, 'cover', (n) => {
          if (n) info.cover = n;
          else delete info.cover;
        }), true),
        this.field(tr('te.creditsShownWithCredits'), this.text(info.credits ?? '', (v) => {
          if (v.trim()) info.credits = v.slice(0, 2000);
          else delete info.credits;
        }, { multiline: true }), true),
      )),
      ...this.translationSections(info, section, group),
      section(tr('te.fonts'), this.fontsBox()),
      section(tr('te.backgroundMusic'), this.musicControl()),
      section(tr('te.mazeColors'), el('h4', '', tr('te.defaultDesign')), maze, designs),
      section(tr('te.levelBadge'), group(
        this.field(tr('te.design'), this.select(badge.kind, BADGE_KINDS, (v) => b({ kind: v }))),
        this.field(tr('te.numberFont'), fontPicker(this.select(badge.font, BADGE_FONTS, (v) => b({ font: v })), badge.font)),
        this.field(tr('te.titleFont'), fontPicker(this.select<BadgeFont | ''>(badge.titleFont ?? '', [['', tr('te.sameAsNumber')], ...BADGE_FONTS], (v) => {
          if (v) badge.titleFont = v;
          else delete badge.titleFont;
        }), badge.titleFont ?? '')),
        this.field(tr('te.numberDigits'), this.select(String(badge.pad) as '0' | '2' | '3', [['0', '7'], ['2', '07'], ['3', '007']], (v) => b({ pad: Number(v) }))),
        this.field(tr('te.caption'), this.text(badge.caption ?? '', (v) => {
          if (v.trim()) badge.caption = v.slice(0, 40);
          else delete badge.caption;
        }, { max: 40 })),
        this.field(tr('te.mainColor'), this.color(badge.primary, (v) => b({ primary: v }))),
        this.field(tr('te.secondColor'), this.color(badge.secondary, (v) => b({ secondary: v }))),
        this.field(tr('common.numberColor'), this.color(badge.numberColor, (v) => b({ numberColor: v }))),
        this.field(tr('te.titleColor'), this.color(badge.titleColor, (v) => b({ titleColor: v }))),
        el('p', 'field wide te-fx-head', tr('te.numberEffects')),
        ...this.fxFields(badge.numberFx, (fx) => {
          if (fx) badge.numberFx = fx;
          else delete badge.numberFx;
        }),
        el('p', 'field wide te-fx-head', tr('te.titleEffects')),
        ...this.fxFields(badge.titleFx, (fx) => {
          if (fx) badge.titleFx = fx;
          else delete badge.titleFx;
        }),
        toggle,
        this.field(tr('te.badgeImageCustomImageDesign'), this.image(badge.image, 'badge', (n) => {
          if (n) badge.image = n;
          else delete badge.image;
        }), true),
      ), (() => {
        const reset = el('button', 'subtle', tr('te.resetBadge'));
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
      name.title = tr('te.nameUsedInFontPickers');
      name.addEventListener('change', () => {
        f.family = name.value.replace(/[^\w -]/g, '').slice(0, 40) || f.family;
        this.save();
        this.renderForm();
      });
      const sample = el('span', 'te-font-sample', tr('te.aa01'));
      sample.style.fontFamily = `'th-draft-${f.family}'`;
      const remove = el('button', 'danger', '✕');
      remove.type = 'button';
      remove.title = tr('te.removeFont');
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
      const family = f.name.replace(/\.[^.]+$/, '').replace(/[^\w -]/g, '').slice(0, 40) || tr('common.font');
      (info.fonts ??= []).push({ family, file });
      this.save();
      this.renderForm();
    });
    const label = el('label', 'field wide');
    label.append(el('span', '', tr('te.addAFontFileTtf')), add);
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
      label.title = tr('te.previewThisLevel');
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
      diffInput.title = tr('te.difficulty1001000');
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
      const designOptions: [string, string][] = [['', tr('te.defaultDesign')],
        ...(m.theme ? [['@map', tr('te.levelOwnDesign')] as [string, string]] : []),
        ...(this.draft.info.style.designs ?? []).map(d => [d.id, d.name] as [string, string])];
      const designSelect = this.select(m.themeDesign ?? (m.theme ? '@map' : ''), designOptions, value => {
        if (value === '@map') delete m.themeDesign;
        else {
          if (value) m.themeDesign = value;
          else delete m.themeDesign;
          // An explicit pack selection replaces the level's embedded override.
          delete m.theme;
        }
        this.previewIndex = i;
        this.save();
        this.renderLevels();
      });
      designSelect.title = tr('te.design');
      li.append(label, designSelect, diffInput,
        tool('↑', tr('pack.moveUp'), move(-1), i === 0),
        tool('↓', tr('pack.moveDown'), move(1), i === levels.length - 1),
        tool('✕', tr('te.remove'), () => {
          levels.splice(i, 1);
          this.previewIndex = Math.min(this.previewIndex, Math.max(0, levels.length - 1));
          this.save();
          this.renderLevels();
          this.fit();
        }));
      return li;
    });
    if (!rows.length) rows.push(el('li', 'te-empty', tr('te.noLevelsYetAddMap')));
    this.levelList.replaceChildren(...rows);
    const head = this.levelList.previousElementSibling;
    if (head) {
      head.textContent = tr('te.levelsHead', { n: levels.length, avg: averageDifficulty(levels).toFixed(2) })
        + (levels.length > LEVELS_PER_THEME ? tr('te.levelsHeadOver', { max: LEVELS_PER_THEME }) : '');
    }
    this.renderTile();
  }

  /** The world tile as it will look on the world select screen */
  private renderTile(): void {
    // Shown as the game shows it: in the current language
    const info = localizeThemeInfo(this.draft.info, language);
    const cover = info.cover ? this.draft.images[info.cover] : undefined;
    const grad = `linear-gradient(135deg, ${info.colors[0]}, ${info.colors[1]})`;
    const tile = el('div', 'dtile dworld te-world');
    tile.style.background = cover ? `linear-gradient(180deg, rgba(20,24,40,0.05), rgba(20,24,40,0.55)), url("${cover}") center / cover, ${grad}` : grad;
    const inner = el('span', 'dtile-in');
    inner.append(el('span', 'dworld-no', tr('te.preview')), el('strong', 'dworld-name', info.name), el('span', 'dworld-diff', `◆ ${averageDifficulty(this.draft.levels).toFixed(2)}`));
    tile.append(inner);
    const meta = el('div', 'te-meta');
    meta.append(
      el('strong', '', info.name),
      el('span', '', info.description || tr('te.noDescription')),
      el('small', 'muted', [info.author && tr('campaign.by', { author: info.author }), info.released && tr('campaign.released', { date: info.released })].filter(Boolean).join(' · ')),
    );
    this.tilePreview.replaceChildren(tile, meta);
  }

  // ───────────────────────── Preview ─────────────────────────

  private previewMap(): MapData {
    const style = this.draft.info.style;
    const m = this.draft.levels[this.previewIndex] ?? demoMap();
    const out: MapData = { ...m, level: m.level ?? this.previewIndex + 1, title: m.title ?? m.name.replace(/^\d+\.\s*/, '') };
    out.theme = levelMaze(style, m);
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
