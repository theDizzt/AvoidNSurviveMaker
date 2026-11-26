import { uniqueLevelIds } from '../core/record-identity';
import { DEFAULT_LANGUAGE, language, LANGUAGES, t as tr } from './i18n';
import { fontPicker } from './font-picker';
import { gameAudio } from './audio';
import { levelLabel } from './localized/level';
import { compileMap } from '../core/object';
import { DEFAULT_DESIGN, levelDesign, levelMaze, type ThemeDesign } from '../core/theme-pack';
import { BASE_THEME } from './localized/theme';
import {
  averageDifficulty, blankThemeInfo, DEFAULT_BADGE, LEVELS_PER_THEME, localizeThemeInfo, MAX_PACK_LEVELS, validateThemeInfo,
  type BadgeAnim, type BadgeAnimType, type BadgeFont, type BadgeKind, type BadgePart, type BadgePartId, type BadgeStyle, type BadgeTextFormat, type ThemeEntry, type ThemeInfo, type ThemeText,
} from './localized/theme-pack';
import type { MapData } from '../core/types';
import type { TextEffects } from '../core/text-effects';
import { createEmptyMap, validateMap, validatePack } from './localized/validate';
import { badgeImage, drawLevelBadge, type BadgeHit } from './badge';
import { beginFrame, clientToMap, drawMap, fitCanvas, releaseRenderCaches, setCamera, unitsPerPx } from './render';
import { floatingPanel, type FloatingPanel } from './float-panel';
import { renderThemePanel } from './theme-panel';
import { CampaignUI } from './campaign-ui';
import { setIcon } from './icons';
import { colorPicker } from './color-picker';
import { DEFAULT_BUTTON, type LayoutElement, type LevelButtonStyle, type ScreenLayout } from './localized/screen-layout';
import { newElement } from './screen-templates';

/** The level select tab shows the game's own level select screen */
type ScreenKind = 'select';
import { ensureFonts } from './screen-render';
import {
  bundledThemeById, bundledThemeOptions, customStoredTheme, levelThemeIn, OFFICIAL_THEMES, CUSTOM_THEME_PRESETS, setCustomTheme,
  subThemeLabel, themeFileMazePresets, type StoredTheme,
} from './theme-registry';
import { download, fileToDataUrl, readThemeZip, urlToDataUrl, writeThemeZip } from './theme-zip';

/**
 * Theme editor (main menu): everything that makes a world look and feel its own — maze colors,
 * the in-game level badge, cover image and info — plus its list of levels. Saves as a theme pack
 * zip (the same layout as a folder in themes/), or becomes the custom pack on the world screen.
 */

const DRAFT_KEY = 'avoid-n-survive:theme-draft';
/** Which form sections are open (remembered per browser) */
const OPEN_KEY = 'avoid-n-survive:theme-editor-open';
/** Sections open the first time */
const OPEN_DEFAULT = ['info', 'sub', 'badge-design', 'badge-layout'];
const HISTORY_MAX = 100;

const PARTS: BadgePartId[] = ['graphic', 'number', 'title'];
const PART_NAMES: Record<BadgePartId, string> = { graphic: tr('te.partGraphic'), number: tr('te.partNumber'), title: tr('te.partTitle') };
const ZOOMS = [1, 1.5, 2, 3];

const BADGE_KINDS: [BadgeKind, string][] = [
  ['pill', tr('te.roundedPlate')], ['disc', tr('te.vinylRecord')], ['emblem', tr('te.snowflakeEmblem')], ['plate', tr('te.gearPlate')],
  ['slant', tr('te.slantedBand')], ['ring', tr('te.woodSlice')], ['image', tr('te.customImage')], ['lcd', tr('te.lcdScreen')],
];
const BADGE_FONTS: [BadgeFont, string][] = [['title', tr('te.title')], ['main', tr('te.rounded')], ['serif', tr('te.serif')], ['heavy', tr('te.heavy')], ['timer', tr('te.digital')]];

/** A small sample maze for themes without levels yet */
function demoMap(): MapData {
  return {
    ...createEmptyMap(),
    // Drawn on a 1920×1080 map, whatever size new maps start at
    width: 1920,
    height: 1080,
    start: { x: 60, y: 480, w: 120, h: 120 },
    goal: { x: 1740, y: 480, w: 120, h: 120 },
    objects: [
      { role: 'path', shape: { type: 'rect', x: 0, y: 400, w: 1920, h: 280 } },
      { role: 'path', shape: { type: 'ellipse', cx: 960, cy: 540, rx: 300, ry: 300 } },
      { role: 'wall', shape: { type: 'rect', x: 660, y: 400, w: 48, h: 180 } },
      { role: 'wall', shape: { type: 'rect', x: 1220, y: 500, w: 48, h: 180 } },
      { role: 'wall', shape: { type: 'rect', x: 940, y: 360, w: 40, h: 140 }, rotation: { pivot: { x: 960, y: 540 }, speed: 60, angle: 360, clockwise: true, repeat: 'loop', easing: 'none', delay: 0 } },
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
  /** The game's level select, drawn for the draft (level select tab) */
  private stageHost!: HTMLElement;
  private screenPanel!: HTMLElement;
  private campaign!: CampaignUI;
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

  // Badge placement on the preview (drag to move, handles to rotate / resize)
  /** Where each badge part was drawn last frame */
  private hits: BadgeHit[] = [];
  private part: BadgePartId | null = null;
  private hover: BadgePartId | 'rotate' | 'scale' | null = null;
  private drag: {
    id: BadgePartId; mode: 'move' | 'rotate' | 'scale'; hit: BadgeHit;
    from: { x: number; y: number }; start: BadgePart;
  } | null = null;
  /** Preview magnification around the top-left corner, where the badge is */
  private zoom = 1;
  private snap = true;
  /** Sample level number / title to try the badge with */
  private sample: { level?: number; title?: string } = {};
  private readonly placementBox: HTMLElement;
  private readonly partChips: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  /** Undo history: theme.json snapshots, `histIndex` the current one */
  private history: string[] = [];
  private histIndex = -1;
  private histAt = 0;
  private opened: Set<string>;
  /** The sub-theme being edited (its design id), null = the theme itself */
  private node: string | null = null;
  /** Theme panel tab: the theme's info, or the maze colors of the theme and its sub-themes */
  private formTab: 'info' | 'maze' = 'info';
  private readonly badgeBody: HTMLElement;
  private readonly badgeTitle: HTMLElement;
  private readonly center: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly head: HTMLElement;
  private readonly floats: { el: HTMLElement; panel: FloatingPanel }[] = [];
  private gameTools!: HTMLElement;
  /** Sample level number / title inputs (in the badge panel) */
  private sampleBox!: HTMLElement;
  private panelsBtn!: HTMLButtonElement;
  /** Snap toggle (both tabs) */
  private snapBox!: HTMLElement;
  private badgeFloat!: HTMLElement;
  private levelsFloat!: HTMLElement;
  private screenFloat!: HTMLElement;

  constructor(root: HTMLElement) {
    this.restoreDraft();
    this.resetHistory();
    this.opened = this.loadOpened();
    this.placementBox = el('div', 'te-placement');
    this.partChips = el('div', 'te-part-chips');
    this.undoBtn = setIcon(el('button'), 'undo', tr('common.undo'), 'Ctrl+Z');
    this.redoBtn = setIcon(el('button'), 'redo', tr('common.redo'), 'Ctrl+Y');
    this.canvas = el('canvas', 'te-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.form = el('div', 'te-form panel');
    this.badgeBody = el('div', 'te-form panel');
    this.badgeTitle = el('span', 'float-title', tr('te.levelBadge'));
    this.center = el('div', 'te-center');
    this.viewport = el('div', 'te-viewport');
    this.levelList = el('ol', 'te-levels');
    this.tilePreview = el('div', 'te-tile');
    this.status = el('p', 'te-status muted');
    this.zipInput = Object.assign(el('input'), { type: 'file', accept: '.zip,application/zip', hidden: true });
    this.zipInput.addEventListener('change', () => void this.importZip());
    this.mapInput = Object.assign(el('input'), { type: 'file', accept: '.json,application/json', multiple: true, hidden: true });
    this.mapInput.addEventListener('change', () => void this.addMapFiles());

    const btn = (text: string, fn: () => void, cls = '') => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    const sep = () => {
      const s = el('span', 'bar-sep');
      s.setAttribute('aria-hidden', 'true');
      return s;
    };
    // One compact bar at the top, like the map editor's; everything else lives in the panels
    const head = el('div', 'editor-bar te-bar');
    this.head = head;
    const back = btn(tr('common.back'), () => this.onBack());
    back.title = tr('common.backEsc');
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
    this.stageHost = el('div', 'te-select-preview');
    this.stageHost.dataset.fit = 'parent';
    this.screenPanel = el('div', 'te-screen-panel panel');
    this.campaign = new CampaignUI(el('div'), this.stageHost);
    // A level picked on the preview opens in the in-game tab
    this.campaign.onPlay = (_t, i) => {
      if (i < 0) return;
      this.previewIndex = Math.min(i, Math.max(0, this.draft.levels.length - 1));
      this.node = this.designOfLevel(this.previewIndex)?.id ?? null;
      this.compiledFor = null;
      this.renderForm();
      this.renderLevels();
      this.setTab('game');
    };
    this.canvas.dataset.fit = 'parent';
    this.viewport.append(this.canvas, this.stageHost);
    this.gameTools = this.previewToolbar();
    this.panelsBtn = setIcon(btn('', () => this.togglePanels()), 'panels', tr('editor.hidePanels'), 'H');
    // Wired up by main.ts with the other fullscreen buttons
    const full = setIcon(el('button', 'btn-fullscreen'), 'fullscreen', tr('common.fullscreen'), 'F');
    full.type = 'button';
    head.append(
      btn(tr('te.playAsCustomPack'), () => this.playCustom(), 'primary'), back, sep(),
      tabs, sep(),
      this.undoBtn, this.redoBtn, sep(), this.gameTools, this.snapBox, sep(), this.panelsBtn, full,
    );
    this.center.append(this.viewport, el('p', 'te-canvas-hint muted', tr('te.partHint')), this.status);
    this.bindCanvas();

    const levelHead = el('div', 'te-levels-head');
    levelHead.append(el('h3', '', tr('te.levels')));
    const levelBtns = el('div', 'actions');
    levelBtns.append(
      btn(tr('te.mapFiles'), () => this.mapInput.click()),
      btn(tr('te.mapEditorPack'), () => this.addFromEditorPack()),
      btn(tr('te.openMap'), () => this.addEditorMap()),
    );
    const levelsBody = el('div', 'panel te-levels-body');
    levelsBody.append(levelHead, this.levelList, levelBtns);

    const float = (id: string, cls: string, title: HTMLElement | string, body: HTMLElement) => {
      const a = el('aside', `editor-float te-float ${cls}`);
      const h = el('div', 'float-head');
      h.title = tr('panel.moveHint');
      const toggle = el('button', 'float-toggle', '−');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'true');
      h.append(typeof title === 'string' ? el('span', 'float-title', title) : title, toggle);
      body.classList.add('float-body');
      a.append(h, body);
      this.floats.push({ el: a, panel: floatingPanel(a, `te-${id}`, { resizable: true }) });
      return a;
    };
    const themeFloat = float('theme', 'te-float-theme', tr('te.panelTheme'), this.form);
    this.badgeFloat = float('badge', 'te-float-badge', this.badgeTitle, this.badgeBody);
    this.levelsFloat = float('levels', 'te-float-levels', tr('te.levels'), levelsBody);
    this.screenFloat = float('screen', 'te-float-screen', tr('te.levelSelect'), this.screenPanel);

    root.replaceChildren(head, this.center, themeFloat, this.badgeFloat, this.levelsFloat, this.screenFloat, this.zipInput, this.mapInput);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) this.onBack();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
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
    requestAnimationFrame(() => {
      for (const f of this.floats) f.panel.refresh();
      this.fit();
    });
  }

  private setTab(tab: 'game' | ScreenKind): void {
    this.tab = tab;
    for (const t of this.tabs.querySelectorAll<HTMLElement>('button')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    const game = tab === 'game';
    this.canvas.hidden = !game;
    this.gameTools.hidden = !game;
    const hint = this.center.querySelector<HTMLElement>('.te-canvas-hint');
    if (hint) hint.textContent = tr(game ? 'te.partHint' : 'te.selectHint');
    this.badgeFloat.hidden = !game;
    this.levelsFloat.hidden = !game;
    this.stageHost.hidden = game;
    this.screenFloat.hidden = game;
    if (!game) this.renderSelect();
    requestAnimationFrame(() => this.fit());
    this.syncHistoryButtons();
  }

  /** Show or hide the floating panels (H), to see the whole preview */
  private togglePanels(): void {
    const root = this.center.parentElement;
    if (!root) return;
    const hidden = root.classList.toggle('panels-hidden');
    setIcon(this.panelsBtn, hidden ? 'panelsHidden' : 'panels', tr(hidden ? 'editor.showPanels' : 'editor.hidePanels'), 'H');
    requestAnimationFrame(() => this.fit());
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
    releaseRenderCaches(this.ctx, this.compiled ?? undefined);
  }

  private fit(): void {
    // The work area starts below the header; panels default to the same top
    const top = Math.round(this.head.getBoundingClientRect().bottom + 8);
    this.center.parentElement?.style.setProperty('--te-top', `${top}px`);
    fitCanvas(this.canvas, this.previewMap());
    if (this.tab === 'select') this.campaign.fit();
  }

  // ───────────────────────── Level select ─────────────────────────

  /** The level select tab: the game's screen for the draft, and its settings */
  private renderSelect(): void {
    this.renderSelectPreview();
    this.renderSelectPanel();
  }

  private renderSelectPreview(): void {
    const info = this.draft.info;
    const entry: ThemeEntry = {
      info: localizeThemeInfo(info, language), source: info, levels: this.draft.levels, assets: this.draft.images, official: false,
      coverUrl: info.cover ? this.draft.images[info.cover] : undefined,
      badgeUrl: info.style.badge.image ? this.draft.images[info.style.badge.image] : undefined,
    };
    // The background, as the game draws it behind the level select (backdrop.ts)
    const bg = info.screens?.select?.background;
    const host = this.stageHost;
    host.classList.toggle('bg-designed', !!bg);
    const [a, b] = bg ? [bg.color, bg.color2 ?? bg.color] : info.colors;
    host.style.setProperty('--bg-a', a);
    host.style.setProperty('--bg-b', b);
    const img = bg?.image && this.draft.images[bg.image];
    if (img) host.style.setProperty('--bg-img', `url("${img}")`);
    else host.style.removeProperty('--bg-img');
    host.style.setProperty('--bg-size', bg?.fit === 'contain' ? 'contain' : bg?.fit === 'tile' ? 'auto' : 'cover');
    host.style.setProperty('--bg-repeat', bg?.fit === 'tile' ? 'repeat' : 'no-repeat');
    host.style.setProperty('--bg-dim', String(bg?.dim ?? 0));
    this.campaign.renderLevels(entry);
  }

  /** The draft's designed level select (created on first edit) */
  private selectLayout(create: true): ScreenLayout;
  private selectLayout(create?: false): ScreenLayout | undefined;
  private selectLayout(create = false): ScreenLayout | undefined {
    const info = this.draft.info;
    if (!info.screens?.select && create) info.screens = { ...info.screens, select: { background: { color: '#291b22' }, elements: [] } };
    return info.screens?.select;
  }

  /** The layout element the game reads a setting from, made when missing */
  private selectElement(kind: 'levelGrid' | 'back' | 'text'): LayoutElement {
    const layout = this.selectLayout(true);
    let e = layout.elements.find((x) => x.kind === kind && (kind !== 'text' || x.color));
    if (!e) {
      e = newElement(kind);
      if (kind === 'levelGrid') e.button = { ...DEFAULT_BUTTON };
      layout.elements.push(e);
    }
    return e;
  }

  /** Color with a "none" box (keeps a #rrggbbaa value's opacity) */
  private optColor(value: string | undefined, apply: (v: string | undefined) => void, allowNone = true): HTMLElement {
    return colorPicker(value, (v) => {
      if (!v && !allowNone) return;
      apply(v);
      this.save();
      this.renderSelect();
    }, { none: allowNone });
  }

  private selectNum(value: number, min: number, max: number, step: number, apply: (v: number) => void): HTMLInputElement {
    const i = el('input');
    i.type = 'number';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(value);
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (!Number.isFinite(v)) return;
      apply(Math.min(max, Math.max(min, v)));
      this.save();
      this.renderSelect();
    });
    return i;
  }

  /** What the game's level select takes from a theme: background, level buttons, Back, text color */
  private renderSelectPanel(): void {
    const layout = this.selectLayout();
    const use = el('label', 'toggle');
    const on = el('input');
    on.type = 'checkbox';
    on.checked = !!layout;
    on.addEventListener('change', () => {
      const info = this.draft.info;
      if (on.checked) {
        this.selectLayout(true);
        this.selectElement('levelGrid');
      } else if (info.screens) {
        delete info.screens.select;
        if (!Object.keys(info.screens).length) delete info.screens;
      }
      this.save();
      this.renderSelect();
    });
    use.append(on, el('span', '', tr('te.selectDesigned')));
    const intro = this.section('sel-screen', tr('sd.levelSelectScreen'), use, el('p', 'muted', tr(layout ? 'te.selectDesignedNote' : 'te.selectDefaultNote')));
    if (!layout) {
      this.screenPanel.replaceChildren(intro);
      return;
    }
    const bg = layout.background;
    const grid = this.selectElement('levelGrid');
    const b: LevelButtonStyle = (grid.button ??= { ...DEFAULT_BUTTON });
    const back = this.selectElement('back');
    const text = layout.elements.find((x) => x.kind === 'text' && x.color);
    const images = Object.keys(this.draft.images).filter((n) => /\.(png|jpe?g|webp|gif|svg)$/i.test(n)).sort();
    const bgImage = el('select');
    bgImage.append(new Option(tr('sd.none'), ''), ...images.map((f) => new Option(f, f, false, f === bg.image)));
    bgImage.addEventListener('change', () => {
      if (bgImage.value) bg.image = bgImage.value;
      else delete bg.image;
      this.save();
      this.renderSelect();
    });
    const upload = el('input');
    upload.type = 'file';
    upload.accept = 'image/*';
    upload.addEventListener('change', async () => {
      const f = upload.files?.[0];
      if (!f) return;
      bg.image = await this.storeFile(f, 'images');
      this.save();
      this.renderSelect();
    });
    const imageRow = el('div', 'sd-asset');
    imageRow.append(bgImage, upload);
    const fit = this.select(bg.fit ?? 'cover', [['cover', tr('common.fill')], ['contain', tr('sd.fit')], ['tile', tr('sd.tile')]], (v) => {
      bg.fit = v;
      this.renderSelect();
    });

    this.screenPanel.replaceChildren(
      this.foldButtons(this.screenPanel),
      intro,
      this.section('sel-bg', tr('common.background'), this.group(
        this.field(tr('common.color'), this.optColor(bg.color, (v) => (bg.color = v ?? '#000000'), false)),
        this.field(tr('sd.gradientTo'), this.optColor(bg.color2, (v) => {
          if (v) bg.color2 = v;
          else delete bg.color2;
        })),
        this.field(tr('common.image'), imageRow, true),
        this.field(tr('sd.imageFit'), fit),
        this.field(tr('sd.darkenImage'), this.selectNum(bg.dim ?? 0, 0, 0.9, 0.05, (v) => (bg.dim = v))),
      )),
      this.section('sel-buttons', tr('te.selectButtons'), this.group(
        this.field(tr('common.fill'), this.optColor(b.fill, (v) => (b.fill = v ?? '#00000000'))),
        this.field(tr('sd.everyOtherFill'), this.optColor(b.fill2, (v) => (b.fill2 = v))),
        this.field(tr('sd.clearedFill'), this.optColor(b.clearedFill, (v) => (b.clearedFill = v))),
        this.field(tr('sd.border'), this.optColor(b.border, (v) => (b.border = v ?? '#00000000'))),
        this.field(tr('sd.borderWidth'), this.selectNum(b.borderWidth, 0, 20, 1, (v) => (b.borderWidth = v))),
        this.field(tr('common.numberColor'), this.optColor(b.numberColor, (v) => (b.numberColor = v ?? '#000000'), false)),
        this.field(tr('sd.numberGlow'), this.optColor(b.numberGlow, (v) => (b.numberGlow = v))),
      )),
      this.section('sel-back', tr('sd.backButton'), this.group(
        this.field(tr('common.fill'), this.optColor(back.fill, (v) => (back.fill = v))),
        this.field(tr('sd.border'), this.optColor(back.border, (v) => (back.border = v))),
        this.field(tr('sd.borderWidth'), this.selectNum(back.borderWidth ?? 0, 0, 20, 1, (v) => (back.borderWidth = v))),
        this.field(tr('common.color'), this.optColor(back.color, (v) => (back.color = v))),
      )),
      this.section('sel-text', tr('te.selectText'), this.group(
        this.field(tr('common.color'), this.optColor(text?.color, (v) => {
          if (v) this.selectElement('text').color = v;
          else if (text) delete text.color;
        })),
      ), el('p', 'muted', tr('te.selectTextNote'))),
    );
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
    this.record();
    this.store();
  }

  /** Write the draft to browser storage */
  private store(): void {
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
    this.part = null;
    this.node = null;
    this.resetHistory();
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

  /**
   * Text effect rows (outline, shadow, neon, gradient, 3D): a checkbox, a color and its numbers.
   * Optional numbers left empty use the automatic value.
   */
  private fxFields(current: TextEffects | undefined, apply: (fx: TextEffects | undefined) => void): HTMLElement[] {
    const fx: TextEffects = { ...current };
    type ColorKey = 'outline' | 'shadow' | 'glow' | 'gradient' | 'depthColor' | 'vine' | 'tube';
    type NumKey = 'outlineWidth' | 'depth' | 'shadowX' | 'shadowY' | 'shadowBlur' | 'glowSize';
    interface Extra { key: NumKey; def: number; min: number; max: number; step: number; title: string; optional?: boolean }
    const row = (label: string, key: ColorKey, def: string, extras: Extra[] = []) => {
      const on = el('input');
      on.type = 'checkbox';
      on.checked = key === 'depthColor' ? !!fx.depth : !!fx[key];
      let picked = fx[key] ?? def;
      const c = colorPicker(picked, (v) => {
        if (!v) return;
        picked = v;
        on.checked = true;
        sync();
      });
      const nums = extras.map((x) => {
        const n = el('input');
        n.type = 'number';
        n.min = String(x.min);
        n.max = String(x.max);
        n.step = String(x.step);
        n.title = x.title;
        n.placeholder = x.optional ? tr('te.auto') : '';
        const v = fx[x.key];
        n.value = v !== undefined ? String(v) : x.optional ? '' : String(x.def);
        return n;
      });
      const sync = () => {
        if (on.checked) {
          fx[key] = picked;
          extras.forEach((x, i) => {
            const raw = nums[i].value.trim();
            if (x.optional && raw === '') {
              delete fx[x.key];
              return;
            }
            const v = Number(raw);
            const clamped = Math.min(x.max, Math.max(x.min, Number.isFinite(v) ? v : x.def));
            fx[x.key] = x.key === 'depth' ? Math.round(clamped) : clamped;
          });
        } else {
          delete fx[key];
          for (const x of extras) delete fx[x.key];
        }
        c.classList.toggle('cp-off', !on.checked);
        for (const n of nums) n.disabled = !on.checked;
        apply(Object.keys(fx).length ? { ...fx } : undefined);
        this.save();
      };
      c.classList.toggle('cp-off', !on.checked);
      for (const n of nums) n.disabled = !on.checked;
      on.addEventListener('change', sync);
      for (const n of nums) n.addEventListener('change', () => on.checked && sync());
      const wrap = el('div', 'te-fx-row');
      wrap.append(on, c, ...nums.flatMap((n, i) => {
        const l = el('label', 'te-fx-num');
        l.append(el('small', '', extras[i].title), n);
        return [l];
      }));
      return this.field(label, wrap, extras.length > 1);
    };
    return [
      row(tr('common.outline'), 'outline', '#1a2233', [{ key: 'outlineWidth', def: 2, min: 0.5, max: 20, step: 0.5, title: tr('ed.outlineWidth') }]),
      row(tr('fx.shadow'), 'shadow', '#000000', [
        { key: 'shadowX', def: 2, min: -40, max: 40, step: 0.5, title: 'X', optional: true },
        { key: 'shadowY', def: 2, min: -40, max: 40, step: 0.5, title: 'Y', optional: true },
        { key: 'shadowBlur', def: 0, min: 0, max: 40, step: 0.5, title: tr('fx.shadowBlur'), optional: true },
      ]),
      row(tr('fx.glow'), 'glow', '#3ae8ff', [{ key: 'glowSize', def: 1, min: 0.2, max: 4, step: 0.1, title: tr('fx.glowSize'), optional: true }]),
      row(tr('fx.gradient'), 'gradient', '#ff7a3a'),
      row(tr('fx.depth'), 'depthColor', '#1a2233', [{ key: 'depth', def: 4, min: 1, max: 30, step: 1, title: tr('fx.depthSize') }]),
      row(tr('fx.vine'), 'vine', '#3f8f2f'),
      row(tr('fx.tube'), 'tube', '#ff855c'),
    ];
  }

  /** Lettering of the number or title: weight, italic, letter spacing, case */
  private formatFields(current: BadgeTextFormat | undefined, apply: (f: BadgeTextFormat | undefined) => void): HTMLElement[] {
    const f: BadgeTextFormat = { ...current };
    const done = () => apply(Object.keys(f).length ? { ...f } : undefined);
    const weights: [string, string][] = [['', tr('te.designDefault')],
      ...[300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), tr(`te.weight${w}` as 'te.weight400')] as [string, string])];
    const tri: [string, string][] = [['', tr('te.designDefault')], ['on', tr('te.on')], ['off', tr('te.off')]];
    const spacing = el('input');
    spacing.type = 'number';
    spacing.min = '-10';
    spacing.max = '40';
    spacing.step = '0.5';
    spacing.value = String(f.spacing ?? 0);
    spacing.addEventListener('change', () => {
      const v = Math.min(40, Math.max(-10, Number(spacing.value) || 0));
      if (v) f.spacing = v;
      else delete f.spacing;
      done();
      this.save();
    });
    return [
      this.field(tr('te.weight'), this.select(f.weight ? String(f.weight) : '', weights, (v) => {
        if (v) f.weight = Number(v);
        else delete f.weight;
        done();
      })),
      this.field(tr('sd.italic'), this.select(f.italic === undefined ? '' : f.italic ? 'on' : 'off', tri, (v) => {
        if (v) f.italic = v === 'on';
        else delete f.italic;
        done();
      })),
      this.field(tr('te.letterSpacing'), spacing),
      this.field(tr('te.textCase'), this.select(f.transform ?? '', [['', tr('te.designDefault')], ['upper', tr('te.caseUpper')], ['lower', tr('te.caseLower')]], (v) => {
        if (v) f.transform = v;
        else delete f.transform;
        done();
      })),
    ];
  }

  private color(value: string, apply: (v: string) => void): HTMLElement {
    return colorPicker(value, (v) => {
      if (!v) return;
      apply(v);
      this.save();
    });
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
      if (current && current !== name && !this.fileInUse(current)) delete this.draft.images[current];
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

  /**
   * Background music: the theme's, or a sub-theme's own (`inherit` names what plays without one).
   * Files go to audio/<base>.<ext>.
   */
  private musicControl(get: () => string | undefined, set: (path: string | undefined) => void, base: string, inherit?: string): HTMLElement {
    const row = el('div', 'actions');
    const current = get();
    row.append(el('span', 'muted', current ?? inherit ?? tr('te.noMusic')));
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
        const name = `audio/${base}.${file.name.split('.').pop()!.toLowerCase()}`;
        const old = get();
        if (old) delete draft.images[old];
        draft.images[name] = url;
        set(name);
        gameAudio.setMusic(null);
        this.save();
        this.renderForm();
      } catch { this.flash(tr('te.musicReadFailed')); }
      finally { input.disabled = false; }
    });
    const preview = el('button', '', tr('te.previewMusic'));
    preview.type = 'button';
    preview.disabled = !current || !this.draft.images[current];
    preview.addEventListener('click', () => {
      const path = get();
      gameAudio.setMusic(path ? this.draft.images[path] ?? null : null);
    });
    const stop = el('button', '', tr('te.stop'));
    stop.type = 'button';
    stop.addEventListener('click', () => gameAudio.setMusic(null));
    const remove = el('button', '', tr('te.removeMusic'));
    remove.type = 'button';
    remove.disabled = !current;
    remove.addEventListener('click', () => {
      gameAudio.setMusic(null);
      const old = get();
      if (old) delete this.draft.images[old];
      set(undefined);
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
    section: (id: string, title: string, ...children: HTMLElement[]) => HTMLElement,
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
      return section(`i18n-${l.id}`, tr('te.translation', { language: l.label }),
        el('p', 'muted', tr('te.translationHint')),
        group(
          this.field(tr('te.name'), this.text(get('name'), set('name', 60), { max: 60 }), true),
          this.field(tr('te.description'), this.text(get('description'), set('description', 1000), { multiline: true }), true),
          this.field(tr('te.creditsShownWithCredits'), this.text(get('credits'), set('credits', 2000), { multiline: true }), true),
          this.field(tr('te.caption'), this.text(get('caption'), set('caption', 40), { max: 40 })),
        ));
    });
  }

  /** The sub-theme being edited, if any */
  private nodeDesign(): ThemeDesign | undefined {
    return this.node ? this.draft.info.style.designs?.find((d) => d.id === this.node) : undefined;
  }

  /** The badge the badge panel and the preview handles edit: the sub-theme's own, else the theme's */
  private editBadge(): BadgeStyle {
    return this.nodeDesign()?.badge ?? this.draft.info.style.badge;
  }

  /** Whether the badge on the preview is the one being edited (a sub-theme may wear another's) */
  private badgeEditable(): boolean {
    const d = this.nodeDesign();
    return !d || !!d.badge;
  }

  /** Level number a level shows (its own, else its place in the list) */
  private levelNo(i: number): number {
    return this.draft.levels[i]?.level ?? i + 1;
  }

  /** The sub-theme level `i` wears (undefined = the theme itself) */
  private designOfLevel(i: number): ThemeDesign | undefined {
    const m = this.draft.levels[i];
    return m ? levelDesign(this.draft.info.style, { themeDesign: m.themeDesign, level: this.levelNo(i) }) : undefined;
  }

  private selectNode(id: string | null): void {
    if (this.node === id) return;
    this.node = id;
    this.part = null;
    // Show a level that wears it, when there is one
    const k = this.draft.levels.findIndex((_, i) => (this.designOfLevel(i)?.id ?? null) === id);
    if (k >= 0) this.previewIndex = k;
    this.compiledFor = null;
    this.renderForm();
    this.renderLevels();
  }

  private group(...children: HTMLElement[]): HTMLElement {
    const g = el('div', 'fields');
    g.append(...children);
    return g;
  }

  /** A collapsible section; which ones are open is remembered */
  private section(id: string, title: string, ...children: HTMLElement[]): HTMLElement {
    const d = el('details', 'theme-section te-section');
    d.open = this.opened.has(id);
    const sum = el('summary');
    sum.append(el('h3', '', title));
    const s = el('section');
    s.append(...children);
    d.append(sum, s);
    d.addEventListener('toggle', () => {
      if (d.open) this.opened.add(id);
      else this.opened.delete(id);
      this.saveOpened();
    });
    return d;
  }

  private foldButtons(box: HTMLElement): HTMLElement {
    const fold = el('div', 'actions te-fold');
    for (const [label, open] of [[tr('te.expandAll'), true], [tr('te.collapseAll'), false]] as const) {
      const b = el('button', 'subtle', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        for (const d of box.querySelectorAll<HTMLDetailsElement>('details.te-section')) d.open = open;
      });
      fold.append(b);
    }
    return fold;
  }

  /** Bundled themes for a picker, each with its sub-themes under it */
  private themeOptions(select: HTMLSelectElement, value: string, skip?: string, withSubs = false): void {
    for (const { id, name, entry } of bundledThemeOptions()) {
      if (id === skip) continue;
      const designs = withSubs ? entry.info.style.designs ?? [] : [];
      if (designs.length) {
        const g = el('optgroup');
        g.label = name;
        g.append(new Option(name, id, false, value === id), ...designs.map((d) => new Option(subThemeLabel(d.name), `${id}#${d.id}`, false, value === `${id}#${d.id}`)));
        select.append(g);
      } else select.append(new Option(name, id, false, value === id));
    }
  }

  private renderForm(): void {
    if (this.node && !this.nodeDesign()) this.node = null;
    const info = this.draft.info;

    // Start from an existing theme (sub-themes come along)
    const source = el('select');
    source.append(new Option(tr('te.startFrom'), ''), new Option(tr('te.blankTheme'), 'blank'));
    const chapters = el('optgroup');
    chapters.label = tr('te.officialChapters');
    OFFICIAL_THEMES.forEach((t, i) => {
      chapters.append(new Option(tr('te.chapterOption', { n: i + 1, name: t.info.name }), `o${i}`));
      for (const d of t.info.style.designs ?? []) {
        const range = d.levels ? ` (${d.levels[0]}–${d.levels[1]})` : '';
        const o = new Option(subThemeLabel(d.name) + range, `o${i}#${d.id}`);
        chapters.append(o);
      }
    });
    const unused = el('optgroup');
    unused.label = tr('te.customThemePresets');
    CUSTOM_THEME_PRESETS.forEach((t, i) => unused.append(new Option(t.info.name, `u${i}`)));
    source.append(chapters, unused);
    if (customStoredTheme()) source.append(new Option(tr('te.customPackOption', { name: customStoredTheme()!.info.name }), 'custom'));
    source.addEventListener('change', async () => {
      const v = source.value;
      source.value = '';
      if (!v || !confirm(tr('te.replaceTheThemeBeingEdited'))) return;
      if (v === 'blank') void this.load({ info: blankThemeInfo(), levels: [], images: {} });
      else if (v === 'custom') void this.load(customStoredTheme()!);
      else if (v.startsWith('u')) void this.load(CUSTOM_THEME_PRESETS[Number(v.slice(1))]);
      else {
        const [chapter, designId] = v.slice(1).split('#');
        await this.load(OFFICIAL_THEMES[Number(chapter)]);
        if (designId) {
          this.formTab = 'maze';
          this.selectNode(designId);
        }
      }
    });

    const design = this.nodeDesign();
    const files = el('div', 'actions te-files');
    for (const [label, fn] of [[tr('te.importZip'), () => this.zipInput.click()], [tr('te.exportZip'), () => this.exportZip()]] as const) {
      const b = el('button', '', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      files.append(b);
    }
    const tabs = el('div', 'te-panel-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [k, label] of [['info', tr('te.panelTheme')], ['maze', tr('te.mazeTab')]] as const) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.formTab === k));
      b.addEventListener('click', () => {
        this.formTab = k;
        this.renderForm();
      });
      tabs.append(b);
    }
    this.form.replaceChildren(
      tabs,
      this.group(this.field(tr('te.load'), source, true)),
      ...(this.formTab === 'info' ? [files] : []),
      this.themeTree(),
      ...(this.formTab === 'maze'
        ? this.mazeSections(design)
        : [this.foldButtons(this.form), ...(design ? this.subThemeSections(design) : this.mainSections(info))]),
    );
    this.renderBadgePanel();
    this.renderTile();
  }

  /** The theme and its sub-themes, as a tree to pick what to edit */
  private themeTree(): HTMLElement {
    const info = this.draft.info;
    const designs = info.style.designs ?? [];
    const counts = new Map<string | null, number>();
    this.draft.levels.forEach((_, i) => {
      const id = this.designOfLevel(i)?.id ?? null;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    const tree = el('div', 'te-tree');
    tree.setAttribute('role', 'tree');
    const node = (id: string | null, name: string, meta: string, child: boolean) => {
      const b = el('button', `te-tree-node${child ? ' child' : ''}${this.node === id ? ' on' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'treeitem');
      b.setAttribute('aria-selected', String(this.node === id));
      b.append(el('span', 'te-tree-name', child ? `└ ${name}` : name), el('small', 'te-tree-meta', meta));
      b.addEventListener('click', () => this.selectNode(id));
      return b;
    };
    tree.append(node(null, info.name, tr('te.treeLevels', { n: counts.get(null) ?? 0 }), false));
    for (const d of designs) {
      const range = d.levels ? tr('te.treeRange', { from: d.levels[0], to: d.levels[1] }) + ' · ' : '';
      tree.append(node(d.id, d.name, range + tr('te.treeLevels', { n: counts.get(d.id) ?? 0 }), true));
    }
    const add = el('button', 'subtle te-tree-add', tr('te.addSubTheme'));
    add.type = 'button';
    add.addEventListener('click', () => {
      const list = info.style.designs ??= [];
      let n = 1;
      while (list.some((d) => d.id === `design-${n}`)) n++;
      const id = `design-${n}`;
      list.push({ id, name: tr('te.designNumber', { n }) });
      this.save();
      this.node = null;
      this.selectNode(id);
    });
    tree.append(add);
    return tree;
  }

  /** Sections of the theme itself */
  private mainSections(info: ThemeInfo): HTMLElement[] {
    const section = (id: string, title: string, ...children: HTMLElement[]) => this.section(id, title, ...children);
    const group = (...children: HTMLElement[]) => this.group(...children);
    return [
      section('info', tr('te.themeInfo'), this.tilePreview, group(
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
      section('fonts', tr('te.fonts'), this.fontsBox()),
      section('music', tr('te.backgroundMusic'), this.musicControl(() => info.music, (v) => {
        if (v) info.music = v;
        else delete info.music;
      }, 'background')),
    ];
  }

  /** Sections of a sub-theme: name, levels, linked theme, music, maze colors */
  private subThemeSections(design: ThemeDesign): HTMLElement[] {
    const info = this.draft.info;
    const name = this.text(design.name, (v) => (design.name = v.trim() || design.id), { max: 60 });
    const names = LANGUAGES.filter((l) => l.id !== DEFAULT_LANGUAGE).map((l) => this.field(tr('te.nameIn', { language: l.label }), this.text(design.i18n?.[l.id] ?? '', (v) => {
      const all = { ...design.i18n };
      if (v.trim()) all[l.id] = v.trim().slice(0, 60);
      else delete all[l.id];
      if (Object.keys(all).length) design.i18n = all;
      else delete design.i18n;
    }, { max: 60 })));

    // Level range: levels with these numbers wear it unless they pick another
    const num = (value: number | undefined, apply: (v: number | undefined) => void) => {
      const i = el('input');
      i.type = 'number';
      i.min = '1';
      i.max = '9999';
      i.placeholder = '—';
      i.value = value === undefined ? '' : String(value);
      i.addEventListener('change', () => {
        const v = Math.round(Number(i.value));
        apply(i.value.trim() && Number.isFinite(v) ? Math.max(1, Math.min(9999, v)) : undefined);
        this.save();
        this.renderForm();
        this.renderLevels();
      });
      return i;
    };
    const setRange = (from: number | undefined, to: number | undefined) => {
      if (from === undefined && to === undefined) delete design.levels;
      else {
        const a = from ?? to!, b = to ?? from!;
        design.levels = [Math.min(a, b), Math.max(a, b)];
      }
    };

    const link = el('select');
    link.append(new Option(tr('te.linkedThemeNone'), ''));
    this.themeOptions(link, design.themeId ?? '', info.id);
    link.addEventListener('change', () => {
      const value = link.value;
      const entry = value ? bundledThemeById(value) : null;
      if (entry) {
        design.themeId = value;
        if (entry.info.style.maze) design.maze = structuredClone(entry.info.style.maze);
        const n = /^design-(\d+)$/.exec(design.id)?.[1];
        if (design.name === design.id || (n && design.name === tr('te.designNumber', { n: Number(n) }))) design.name = entry.info.name;
      } else delete design.themeId;
      this.save();
      this.renderForm();
      this.renderLevels();
    });

    const linked = design.themeId ? bundledThemeById(design.themeId) : null;
    const inherited = linked?.info.music ?? info.music;
    const remove = el('button', 'danger', tr('te.removeSubTheme'));
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (!confirm(tr('te.removeDesignConfirm'))) return;
      info.style.designs = info.style.designs?.filter((d) => d !== design);
      if (!info.style.designs?.length) delete info.style.designs;
      for (const map of this.draft.levels) if (map.themeDesign === design.id) delete map.themeDesign;
      for (const f of [design.music, design.badge?.image]) if (f && !this.fileInUse(f, design)) delete this.draft.images[f];
      this.node = null;
      this.save();
      this.renderForm();
      this.renderLevels();
    });
    const toMain = el('button', 'subtle', tr('te.backToMainTheme'));
    toMain.type = 'button';
    toMain.addEventListener('click', () => this.selectNode(null));

    return [
      this.section('sub', tr('te.subTheme'), this.group(
        this.field(tr('te.designName'), name, true),
        ...names,
        this.field(tr('te.levelsFrom'), num(design.levels?.[0], (v) => setRange(v, design.levels?.[1]))),
        this.field(tr('te.levelsTo'), num(design.levels?.[1], (v) => setRange(design.levels?.[0], v))),
        el('p', 'field wide muted', tr('te.levelsRangeNote')),
        this.field(tr('te.linkedTheme'), link, true),
        el('p', 'field wide muted', tr('te.linkedThemeNote')),
      ), (() => {
        const row = el('div', 'actions');
        row.append(toMain, remove);
        return row;
      })()),
      this.section('sub-music', tr('te.backgroundMusic'), this.musicControl(() => design.music, (v) => {
        if (v) design.music = v;
        else delete design.music;
      }, `background-${design.id}`, inherited ? tr('te.inheritedMusic', { file: inherited }) : undefined)),
    ];
  }

  /**
   * The maze tab: the maze colors of the theme, or of the selected sub-theme — which wears the
   * theme's own until it gets colors of its own, so a shared look is set once.
   */
  private mazeSections(design: ThemeDesign | undefined): HTMLElement[] {
    const info = this.draft.info;
    const box = el('div', 'te-maze');
    const render = () => {
      if (design && !design.maze) {
        box.replaceChildren(el('p', 'muted', tr('te.mazeInherited', { name: info.name })));
        return;
      }
      renderThemePanel(box, design ? design.maze : info.style.maze, (next) => {
        // A sub-theme's "default look" stays its own (no maze would mean the theme's)
        if (design) design.maze = next ?? structuredClone(BASE_THEME);
        else if (next) info.style.maze = next;
        else delete info.style.maze;
        this.save();
        this.compiledFor = null;
        render();
      }, themeFileMazePresets(), false);
    };
    render();
    const out: HTMLElement[] = [];
    if (design) {
      const own = el('label', 'toggle');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!design.maze;
      cb.addEventListener('change', () => {
        if (cb.checked) design.maze = structuredClone(info.style.maze ?? BASE_THEME);
        else delete design.maze;
        this.save();
        this.compiledFor = null;
        render();
      });
      own.append(cb, el('span', '', tr('te.mazeOwn')));
      out.push(own);
    }
    out.push(el('h4', 'te-maze-head', design ? design.name : tr('te.mazeMain', { name: info.name })), box);
    return out;
  }

  /** Animation of each badge part: kind, speed, strength and (color fade) target color */
  private animFields(badge: BadgeStyle): HTMLElement {
    const box = el('div', 'te-anim');
    for (const id of PARTS) {
      const a = badge.anim?.[id];
      const set = (next: BadgeAnim | undefined) => {
        const all = { ...badge.anim };
        if (next) all[id] = next;
        else delete all[id];
        if (Object.keys(all).length) badge.anim = all;
        else delete badge.anim;
        this.save();
        this.renderBadgePanel();
      };
      const kinds: BadgeAnimType[] = ['spin', 'sway', 'bob', 'pulse', 'blink', 'color', ...(id === 'graphic' ? [] : ['wave' as const])];
      const type = el('select');
      type.append(new Option(tr('te.animNone'), ''), ...kinds.map((k) => new Option(tr(`te.anim.${k}` as 'te.anim.spin'), k, false, a?.type === k)));
      type.addEventListener('change', () => {
        const k = type.value as BadgeAnimType | '';
        set(k ? { type: k, speed: a?.speed ?? (k === 'spin' ? 0.25 : 0.6), amount: a?.amount ?? (k === 'color' ? 1 : 0.5), ...(k === 'color' ? { color: a?.color ?? '#ffd23f' } : {}) } : undefined);
      });
      const row = el('div', 'te-anim-row');
      row.append(this.field(PART_NAMES[id], type));
      if (a) {
        const num = (label: string, value: number, min: number, max: number, step: number, apply: (v: number) => void) => {
          const i = el('input');
          i.type = 'number';
          i.min = String(min);
          i.max = String(max);
          i.step = String(step);
          i.value = String(value);
          i.addEventListener('change', () => {
            const v = Number(i.value);
            if (!Number.isFinite(v)) return;
            apply(Math.min(max, Math.max(min, v)));
            this.save();
          });
          return this.field(label, i);
        };
        row.append(
          num(a.type === 'spin' ? tr('te.animTurns') : tr('te.animSpeed'), a.speed, -5, 5, 0.05, (v) => (a.speed = v)),
          ...(a.type === 'spin' ? [] : [num(tr('te.animAmount'), Math.round(a.amount * 100), 0, 100, 5, (v) => (a.amount = v / 100))]),
          ...(a.type === 'color' ? [this.field(tr('common.color'), colorPicker(a.color ?? '#ffd23f', (v) => {
            if (!v) return;
            a.color = v;
            this.save();
          }))] : []),
        );
      }
      box.append(row);
    }
    return box;
  }

  /** Whether a pack file is still used by the theme or a sub-theme other than `except` */
  private fileInUse(file: string, except?: ThemeDesign): boolean {
    const info = this.draft.info;
    return info.music === file || info.style.badge.image === file || info.cover === file
      || (info.style.designs ?? []).some((d) => d !== except && (d.music === file || d.badge?.image === file));
  }

  /** The badge panel: the badge of the theme or of the sub-theme being edited */
  private renderBadgePanel(): void {
    const design = this.nodeDesign();
    this.badgeTitle.textContent = design ? tr('te.badgeOf', { name: design.name }) : tr('te.levelBadge');
    if (design && !design.badge) {
      // Wears another badge: offer to make its own from it
      const linked = design.themeId ? bundledThemeById(design.themeId) : null;
      const make = el('button', 'primary', tr('te.makeOwnBadge'));
      make.type = 'button';
      make.addEventListener('click', () => {
        const from = structuredClone(linked?.info.style.badge ?? this.draft.info.style.badge);
        // A linked theme's picture isn't in this pack
        if (from.image && !this.draft.images[from.image]) delete from.image;
        design.badge = from;
        this.save();
        this.renderBadgePanel();
      });
      this.badgeBody.replaceChildren(
        el('p', 'muted', tr(linked ? 'te.badgeFromLinked' : 'te.badgeFromMain', { name: linked?.info.name ?? this.draft.info.name })),
        make,
      );
      this.renderChips();
      return;
    }
    const badge = this.editBadge();
    const b = (patch: Partial<BadgeStyle>) => Object.assign(badge, patch);
    const showTitle = el('input');
    showTitle.type = 'checkbox';
    showTitle.checked = badge.showTitle;
    showTitle.addEventListener('change', () => {
      badge.showTitle = showTitle.checked;
      this.save();
    });
    const toggle = el('label', 'toggle');
    toggle.append(showTitle, el('span', '', tr('te.showTheLevelTitle')));
    const tri = (v: boolean | undefined): '' | 'on' | 'off' => (v === undefined ? '' : v ? 'on' : 'off');
    const section = (id: string, title: string, ...children: HTMLElement[]) => this.section(id, title, ...children);
    const group = (...children: HTMLElement[]) => this.group(...children);

    const reset = el('button', 'subtle', design ? tr('te.useMainBadge') : tr('te.resetBadge'));
    reset.type = 'button';
    reset.addEventListener('click', () => {
      if (design) {
        if (design.badge?.image && !this.fileInUse(design.badge.image, design)) delete this.draft.images[design.badge.image];
        delete design.badge;
      } else this.draft.info.style.badge = { ...DEFAULT_BADGE };
      this.part = null;
      this.save();
      this.renderBadgePanel();
    });

    this.badgeBody.replaceChildren(
      this.foldButtons(this.badgeBody),
      section('badge-design', tr('te.secBadgeDesign'), group(
        this.field(tr('te.design'), this.select(badge.kind, BADGE_KINDS, (v) => b({ kind: v }))),
        this.field(tr('te.mainColor'), this.color(badge.primary, (v) => b({ primary: v }))),
        this.field(tr('te.secondColor'), this.color(badge.secondary, (v) => b({ secondary: v }))),
        this.field(tr('te.badgeImageCustomImageDesign'), this.image(badge.image, design ? `badge-${design.id}` : 'badge', (n) => {
          if (n) badge.image = n;
          else delete badge.image;
        }), true),
      ), reset),
      section('badge-layout', tr('te.secBadgeLayout'), this.partChips, this.placementBox),
      section('badge-anim', tr('te.secBadgeAnim'), this.animFields(badge)),
      section('badge-sample', tr('te.secPreviewSample'), this.sampleBox),
      section('badge-number', tr('te.secBadgeNumber'), group(
        this.field(tr('te.numberFont'), fontPicker(this.select(badge.font, BADGE_FONTS, (v) => b({ font: v })), badge.font)),
        this.field(tr('te.numberDigits'), this.select(String(badge.pad) as '0' | '2' | '3', [['0', '7'], ['2', '07'], ['3', '007']], (v) => b({ pad: Number(v) }))),
        this.field(tr('common.numberColor'), this.color(badge.numberColor, (v) => b({ numberColor: v }))),
        ...this.formatFields(badge.numberFormat, (f) => {
          if (f) badge.numberFormat = f;
          else delete badge.numberFormat;
        }),
        el('p', 'field wide te-fx-head', tr('te.numberEffects')),
        ...this.fxFields(badge.numberFx, (fx) => {
          if (fx) badge.numberFx = fx;
          else delete badge.numberFx;
        }),
      )),
      section('badge-title', tr('te.secBadgeTitle'), toggle, group(
        this.field(tr('te.titleFont'), fontPicker(this.select<BadgeFont | ''>(badge.titleFont ?? '', [['', tr('te.sameAsNumber')], ...BADGE_FONTS], (v) => {
          if (v) badge.titleFont = v;
          else delete badge.titleFont;
        }), badge.titleFont ?? '')),
        this.field(tr('te.titleColor'), this.color(badge.titleColor, (v) => b({ titleColor: v }))),
        this.field(tr('te.caption'), this.text(badge.caption ?? '', (v) => {
          if (v.trim()) badge.caption = v.slice(0, 40);
          else delete badge.caption;
        }, { max: 40 })),
        this.field(tr('te.titlePlate'), this.select(tri(badge.titlePlate), [['', tr('te.designDefault')], ['on', tr('te.on')], ['off', tr('te.off')]], (v) => {
          if (v) badge.titlePlate = v === 'on';
          else delete badge.titlePlate;
        })),
        ...this.formatFields(badge.titleFormat, (f) => {
          if (f) badge.titleFormat = f;
          else delete badge.titleFormat;
        }),
        el('p', 'field wide te-fx-head', tr('te.titleEffects')),
        ...this.fxFields(badge.titleFx, (fx) => {
          if (fx) badge.titleFx = fx;
          else delete badge.titleFx;
        }),
      )),
    );
    this.renderPlacement();
    this.renderChips();
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
      const remove = setIcon(el('button', 'danger'), 'trash', tr('te.removeFont'));
      remove.type = 'button';
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
        // Edit what the level wears
        const node = this.designOfLevel(i)?.id ?? null;
        if (node !== this.node) {
          this.node = node;
          this.part = null;
          this.renderForm();
        }
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
        if (!t) setIcon(b, 'trash', title);
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
      const style = this.draft.info.style;
      const byRange = levelDesign(style, { level: this.levelNo(i) });
      const autoName = byRange?.name ?? (m.theme ? tr('te.levelOwnDesign') : this.draft.info.name);
      const designOptions: [string, string][] = [['', tr('te.autoDesign', { name: autoName })], [DEFAULT_DESIGN, this.draft.info.name],
        ...(style.designs ?? []).map((d) => [d.id, subThemeLabel(d.name)] as [string, string])];
      const designSelect = this.select(m.themeDesign && (m.themeDesign === DEFAULT_DESIGN || style.designs?.some((d) => d.id === m.themeDesign)) ? m.themeDesign : '', designOptions, (value) => {
        if (value) m.themeDesign = value;
        else delete m.themeDesign;
        // A picked sub-theme replaces the level's embedded colors
        if (value && value !== DEFAULT_DESIGN) delete m.theme;
        this.previewIndex = i;
        this.node = this.designOfLevel(i)?.id ?? null;
        this.save();
        this.renderForm();
        this.renderLevels();
      });
      designSelect.title = tr('te.design');
      li.append(label, designSelect, diffInput,
        tool('↑', tr('pack.moveUp'), move(-1), i === 0),
        tool('↓', tr('pack.moveDown'), move(1), i === levels.length - 1),
        tool('', tr('te.remove'), () => {
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
    const out: MapData = {
      ...m,
      level: this.sample.level ?? m.level ?? this.previewIndex + 1,
      title: this.sample.title || (m.title ?? m.name.replace(/^\d+\.\s*/, '')),
    };
    // Show the sub-theme being edited (or the theme's own look) on this level
    const real = levelDesign(style, out);
    if ((real?.id ?? null) !== this.node) out.themeDesign = this.node ?? DEFAULT_DESIGN;
    out.theme = levelMaze(style, out);
    return out;
  }

  /** The badge a preview map wears, with its picture */
  private previewBadge(map: MapData): { style: BadgeStyle; image: string | undefined } {
    const info = this.draft.info;
    const pack: ThemeEntry = {
      info, levels: this.draft.levels, assets: this.draft.images, official: false,
      badgeUrl: info.style.badge.image ? this.draft.images[info.style.badge.image] : undefined,
    };
    const t = levelThemeIn(pack, map);
    return { style: t.info.style.badge, image: t.badgeUrl };
  }

  private drawPreview(): void {
    if (this.canvas.hidden) return;
    const map = this.previewMap();
    if (!this.compiled || this.compiledFor === null) {
      this.compiled = compileMap(map);
      this.compiledFor = JSON.stringify(map);
      fitCanvas(this.canvas, map);
    }
    // Zoomed in on the top-left corner, where the badge sits
    setCamera(this.canvas, this.zoom === 1 ? null : { zoom: this.zoom, x: map.width / (2 * this.zoom), y: map.height / (2 * this.zoom) });
    const now = performance.now();
    beginFrame(this.ctx, map);
    drawMap(this.ctx, map, this.compiled, now % 600000, { now });
    const badge = this.previewBadge(map);
    const hits: BadgeHit[] = [];
    drawLevelBadge(this.ctx, map, badge.style, badgeImage(badge.image), now, hits);
    this.hits = hits;
    if (this.badgeEditable()) this.drawOverlay(map);
  }

  // ───────────────────────── Badge placement ─────────────────────────

  /** Placement of one part (a fresh empty one when it has none) */
  private placed(id: BadgePartId): BadgePart {
    return this.editBadge().layout?.[id] ?? {};
  }

  /** Set a part's placement, dropping values back at the design's default */
  private setPlaced(id: BadgePartId, p: BadgePart): void {
    const badge = this.editBadge();
    const clean: BadgePart = {};
    if (p.x) clean.x = Math.round(p.x * 10) / 10;
    if (p.y) clean.y = Math.round(p.y * 10) / 10;
    if (p.scale !== undefined && Math.abs(p.scale - 1) > 1e-3) clean.scale = Math.round(Math.min(5, Math.max(0.2, p.scale)) * 1000) / 1000;
    if (p.rotate) {
      let r = ((p.rotate % 360) + 540) % 360 - 180;
      r = Math.round(r * 10) / 10;
      if (r) clean.rotate = r;
    }
    if (p.hidden) clean.hidden = true;
    const layout = { ...badge.layout };
    if (Object.keys(clean).length) layout[id] = clean;
    else delete layout[id];
    if (Object.keys(layout).length) badge.layout = layout;
    else delete badge.layout;
  }

  private previewToolbar(): HTMLElement {
    const bar = el('div', 'te-toolbar te-tool-group');
    for (const [b, fn] of [[this.undoBtn, () => this.undo()], [this.redoBtn, () => this.redo()]] as const) {
      b.type = 'button';
      b.addEventListener('click', fn);
    }
    this.renderChips();

    const zoomBtn = (cls: string, fn: () => void) => {
      const b = el('button', cls);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    const level = zoomBtn('zoom-level', () => setZoom(1));
    level.title = tr('editor.zoomReset');
    const setZoom = (z: number) => {
      this.zoom = z;
      level.textContent = `${Math.round(z * 100)}%`;
    };
    const step = (d: -1 | 1) => () => {
      const k = ZOOMS.indexOf(this.zoom);
      setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, k + d))]);
    };
    const out = setIcon(zoomBtn('zoom-btn', step(-1)), 'zoomOut', tr('editor.zoomOut'));
    const into = setIcon(zoomBtn('zoom-btn', step(1)), 'zoomIn', tr('editor.zoomIn'));
    setZoom(this.zoom);

    const snapBox = el('label', 'check');
    const snap = el('input');
    snap.type = 'checkbox';
    snap.checked = this.snap;
    snap.addEventListener('change', () => (this.snap = snap.checked));
    snapBox.append(snap, el('span', '', tr('te.snap')));
    snapBox.title = tr('te.snapHint');

    const num = el('input', 'te-sample-num');
    num.type = 'number';
    num.min = '0';
    num.max = '9999';
    num.placeholder = '#';
    num.title = tr('te.sampleNumber');
    num.addEventListener('input', () => {
      const v = Math.round(Number(num.value));
      this.sample.level = num.value.trim() !== '' && Number.isFinite(v) ? Math.max(0, Math.min(9999, v)) : undefined;
    });
    const title = el('input', 'te-sample-title');
    title.placeholder = tr('te.sampleTitle');
    title.title = tr('te.sampleTitle');
    title.maxLength = 80;
    title.addEventListener('input', () => (this.sample.title = title.value || undefined));

    this.sampleBox = el('div', 'fields te-sample');
    const field = (label: string, control: HTMLElement) => this.field(label, control);
    this.sampleBox.append(field(tr('te.sampleNumber'), num), field(tr('te.sampleTitle'), title));
    this.snapBox = snapBox;
    bar.append(out, level, into);
    return bar;
  }

  /** Part buttons above the preview (the selected one is highlighted) */
  private renderChips(): void {
    this.partChips.replaceChildren(...PARTS.map((id) => {
      const b = el('button', '', PART_NAMES[id]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.part === id));
      if (this.placed(id).hidden) b.classList.add('te-chip-hidden');
      b.addEventListener('click', () => this.selectPart(this.part === id ? null : id));
      return b;
    }));
  }

  private selectPart(id: BadgePartId | null): void {
    this.part = id;
    this.renderChips();
    this.renderPlacement();
  }

  /** The placement section: X / Y / size / rotation of each part */
  private renderPlacement(): void {
    const box = this.placementBox;
    const rows = PARTS.map((id) => {
      const p = this.placed(id);
      const row = el('div', `te-place-row${this.part === id ? ' on' : ''}`);
      const name = el('button', 'te-place-name', PART_NAMES[id]);
      name.type = 'button';
      name.addEventListener('click', () => this.selectPart(id));
      const num = (value: number, step: number, title: string, apply: (v: number) => void) => {
        const i = el('input');
        i.type = 'number';
        i.step = String(step);
        i.title = title;
        i.value = String(Math.round(value * 10) / 10);
        i.addEventListener('focus', () => this.part !== id && this.selectPart(id));
        i.addEventListener('change', () => {
          const v = Number(i.value);
          if (!Number.isFinite(v)) return;
          apply(v);
          this.save();
          this.renderPlacement();
        });
        const l = el('label', 'te-place-num');
        l.append(el('small', '', title), i);
        return l;
      };
      const hide = el('label', 'toggle te-place-hide');
      const hc = el('input');
      hc.type = 'checkbox';
      hc.checked = !!p.hidden;
      hc.addEventListener('change', () => {
        this.setPlaced(id, { ...this.placed(id), hidden: hc.checked || undefined });
        this.save();
        this.renderChips();
      });
      hide.append(hc, el('span', '', id === 'graphic' ? tr('te.hideShape') : tr('te.hidePart')));
      const reset = el('button', 'subtle', tr('te.resetPart'));
      reset.type = 'button';
      reset.disabled = !Object.keys(p).length;
      reset.addEventListener('click', () => {
        this.setPlaced(id, {});
        this.save();
        this.renderPlacement();
        this.renderChips();
      });
      row.append(name,
        num(p.x ?? 0, 1, 'X', (v) => this.setPlaced(id, { ...this.placed(id), x: v })),
        num(p.y ?? 0, 1, 'Y', (v) => this.setPlaced(id, { ...this.placed(id), y: v })),
        num((p.scale ?? 1) * 100, 5, tr('te.scalePct'), (v) => this.setPlaced(id, { ...this.placed(id), scale: v / 100 })),
        num(p.rotate ?? 0, 5, tr('te.rotateDeg'), (v) => this.setPlaced(id, { ...this.placed(id), rotate: v })),
        hide, reset);
      return row;
    });
    const resetAll = el('button', 'subtle', tr('te.resetLayout'));
    resetAll.type = 'button';
    resetAll.disabled = !this.editBadge().layout;
    resetAll.addEventListener('click', () => {
      delete this.editBadge().layout;
      this.save();
      this.renderPlacement();
      this.renderChips();
    });
    box.replaceChildren(...rows, resetAll);
  }

  /** Map point under the mouse (in the zoomed preview) */
  private pointer(e: MouseEvent): { x: number; y: number } {
    return clientToMap(this.canvas, this.previewMap(), e.clientX, e.clientY);
  }

  /** Map units per CSS pixel on the preview */
  private unit(map: MapData): number {
    return unitsPerPx(this.canvas, map);
  }

  /** The selected part's rotate and resize handles */
  private handles(hit: BadgeHit, u: number): { rotate: { x: number; y: number }; top: { x: number; y: number }; scale: { x: number; y: number } } {
    const [a, b, c, d] = hit.poly;
    const top = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Outward from the box's top edge
    const ux = a.x - d.x, uy = a.y - d.y;
    const len = Math.hypot(ux, uy) || 1;
    return { rotate: { x: top.x + (ux / len) * 22 * u, y: top.y + (uy / len) * 22 * u }, top, scale: c };
  }

  private hitAt(p: { x: number; y: number }): { id: BadgePartId; mode: 'move' | 'rotate' | 'scale'; hit: BadgeHit } | null {
    if (!this.badgeEditable()) return null;
    const map = this.previewMap();
    const u = this.unit(map);
    const sel = this.hits.find((h) => h.part === this.part);
    if (sel) {
      const h = this.handles(sel, u);
      if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) < 9 * u) return { id: sel.part, mode: 'rotate', hit: sel };
      if (Math.hypot(p.x - h.scale.x, p.y - h.scale.y) < 9 * u) return { id: sel.part, mode: 'scale', hit: sel };
    }
    const inside = (h: BadgeHit) => {
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const a = h.poly[i], b = h.poly[(i + 1) % 4];
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (Math.abs(cross) < 1e-9) continue;
        if (sign === 0) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) return false;
      }
      return true;
    };
    // The selected part first, then the title, the number, the graphic
    const order = [...this.hits].sort((a, b) => rank(a) - rank(b));
    function rank(h: BadgeHit): number {
      return h.part === sel?.part ? -1 : PARTS.length - PARTS.indexOf(h.part);
    }
    const hit = order.find(inside);
    return hit ? { id: hit.part, mode: 'move', hit } : null;
  }

  private bindCanvas(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = this.pointer(e);
      const hit = this.hitAt(p);
      if (!hit) {
        if (this.part) this.selectPart(null);
        return;
      }
      e.preventDefault();
      if (this.part !== hit.id) this.selectPart(hit.id);
      this.drag = { ...hit, from: p, start: { ...this.placed(hit.id) } };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointer(e);
      if (!this.drag) {
        const hit = this.hitAt(p);
        this.hover = hit ? (hit.mode === 'move' ? hit.id : hit.mode) : null;
        c.style.cursor = !hit ? '' : hit.mode === 'rotate' ? 'alias' : hit.mode === 'scale' ? 'nwse-resize' : 'move';
        return;
      }
      const { id, mode, hit, from, start } = this.drag;
      const snap = this.snap !== e.altKey;
      const next: BadgePart = { ...start };
      if (mode === 'move') {
        // Mouse movement into the part's own frame (the number may sit in a turned plate)
        const [a, b, cc, d] = hit.frame;
        const det = a * d - b * cc || 1;
        const dx = p.x - from.x, dy = p.y - from.y;
        let lx = (d * dx - cc * dy) / det;
        let ly = (-b * dx + a * dy) / det;
        if (e.shiftKey) {
          if (Math.abs(lx) > Math.abs(ly)) ly = 0;
          else lx = 0;
        }
        const step = snap ? 2 : 0.5;
        next.x = Math.round(((start.x ?? 0) + lx) / step) * step;
        next.y = Math.round(((start.y ?? 0) + ly) / step) * step;
      } else if (mode === 'rotate') {
        const a0 = Math.atan2(from.y - hit.pivot.y, from.x - hit.pivot.x);
        const a1 = Math.atan2(p.y - hit.pivot.y, p.x - hit.pivot.x);
        let r = (start.rotate ?? 0) + ((a1 - a0) * 180) / Math.PI;
        r = snap || e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r);
        next.rotate = r;
      } else {
        const d0 = Math.hypot(from.x - hit.pivot.x, from.y - hit.pivot.y) || 1;
        const d1 = Math.hypot(p.x - hit.pivot.x, p.y - hit.pivot.y);
        const sc = Math.min(5, Math.max(0.2, (start.scale ?? 1) * (d1 / d0)));
        next.scale = snap ? Math.round(sc * 20) / 20 : Math.round(sc * 100) / 100;
      }
      this.setPlaced(id, next);
    });
    const end = (e: PointerEvent) => {
      if (!this.drag) return;
      this.drag = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      this.save();
      this.renderPlacement();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => !this.drag && (this.hover = null));
    c.addEventListener('dblclick', (e) => {
      const hit = this.hitAt(this.pointer(e));
      if (!hit || hit.mode !== 'move') return;
      // Back to the design's spot (a hidden part stays hidden)
      this.setPlaced(hit.id, this.placed(hit.id).hidden ? { hidden: true } : {});
      this.save();
      this.renderPlacement();
    });
  }

  /** Outlines of the parts (hovered, selected) and the selected one's handles */
  private drawOverlay(map: MapData): void {
    const ctx = this.ctx;
    const u = this.unit(map);
    const poly = (h: BadgeHit) => {
      ctx.beginPath();
      h.poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    };
    ctx.save();
    for (const h of this.hits) {
      const selected = h.part === this.part;
      if (!selected && h.part !== this.hover && !this.drag) continue;
      if (this.drag && !selected) continue;
      poly(h);
      ctx.lineWidth = (selected ? 1.6 : 1.2) * u;
      ctx.setLineDash(selected ? [] : [4 * u, 3 * u]);
      ctx.strokeStyle = selected ? '#2f8cf0' : 'rgba(47,140,240,0.8)';
      ctx.stroke();
      if (!selected) continue;
      ctx.setLineDash([]);
      const hd = this.handles(h, u);
      ctx.beginPath();
      ctx.moveTo(hd.top.x, hd.top.y);
      ctx.lineTo(hd.rotate.x, hd.rotate.y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hd.rotate.x, hd.rotate.y, 5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(hd.scale.x - 4.5 * u, hd.scale.y - 4.5 * u, 9 * u, 9 * u);
      ctx.fill();
      ctx.stroke();
      // Pivot
      ctx.beginPath();
      ctx.arc(h.pivot.x, h.pivot.y, 2.5 * u, 0, Math.PI * 2);
      ctx.fillStyle = '#2f8cf0';
      ctx.fill();
      // Live readout while dragging
      if (this.drag) {
        const p = this.placed(h.part);
        const text = this.drag.mode === 'rotate' ? `${Math.round(p.rotate ?? 0)}°`
          : this.drag.mode === 'scale' ? `${Math.round((p.scale ?? 1) * 100)}%`
            : `${Math.round(p.x ?? 0)}, ${Math.round(p.y ?? 0)}`;
        ctx.font = `600 ${12 * u}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const tw = ctx.measureText(text).width;
        const bx = hd.scale.x + 8 * u, by = hd.scale.y + 6 * u;
        ctx.fillStyle = 'rgba(20,24,40,0.8)';
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 10 * u, 18 * u, 4 * u);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, bx + 5 * u, by + 3 * u);
      }
    }
    ctx.restore();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (!mod && !e.altKey && k === 'h') {
      e.preventDefault();
      this.togglePanels();
      return;
    }
    if (this.tab !== 'game') return;
    if (!this.part || mod) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const p = this.placed(this.part);
      this.setPlaced(this.part, { ...p, x: (p.x ?? 0) + d[0], y: (p.y ?? 0) + d[1] });
      this.save();
      this.renderPlacement();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.setPlaced(this.part, {});
      this.save();
      this.renderPlacement();
      this.renderChips();
    }
  }

  // ───────────────────────── Undo ─────────────────────────

  private resetHistory(): void {
    this.history = [JSON.stringify(this.draft.info)];
    this.histIndex = 0;
    this.histAt = 0;
    this.syncHistoryButtons();
  }

  /** Remember the theme as it is now; quick runs of changes (a color being dragged) count as one */
  private record(): void {
    const snap = JSON.stringify(this.draft.info);
    if (snap === this.history[this.histIndex]) return;
    const now = performance.now();
    this.history.length = this.histIndex + 1;
    if (now - this.histAt < 400 && this.histIndex > 0) this.history[this.histIndex] = snap;
    else {
      this.history.push(snap);
      if (this.history.length > HISTORY_MAX) this.history.shift();
      this.histIndex = this.history.length - 1;
    }
    this.histAt = now;
    this.syncHistoryButtons();
  }

  private syncHistoryButtons(): void {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = this.histIndex <= 0;
    this.redoBtn.disabled = this.histIndex >= this.history.length - 1;
  }

  private undo(): void {
    if (this.histIndex > 0) this.restore(this.histIndex - 1);
  }

  private redo(): void {
    if (this.histIndex < this.history.length - 1) this.restore(this.histIndex + 1);
  }

  private restore(index: number): void {
    this.histIndex = index;
    this.histAt = 0;
    this.draft.info = JSON.parse(this.history[index]) as ThemeInfo;
    if (this.node && !this.nodeDesign()) this.node = null;
    this.compiledFor = null;
    this.store();
    this.renderForm();
    this.renderLevels();
    if (this.tab !== 'game') this.renderSelect();
    this.renderChips();
    this.syncHistoryButtons();
  }

  private loadOpened(): Set<string> {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* default */
    }
    return new Set(OPEN_DEFAULT);
  }

  private saveOpened(): void {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...this.opened]));
    } catch {
      /* not remembered */
    }
  }
}
