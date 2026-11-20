import { language, LANGUAGES, saveLanguage, t, type Language } from './i18n';
import { renderFontLicenses } from './font-licenses';
import './style.css';
// Game version, e.g. "Update 20" — edit the VERSION file at the repo root
import versionFile from '../../VERSION?raw';
import { BUILTIN_LEVELS } from '../core/levels';
import { chapterLevelCode, levelLabel } from './localized/level';
import { decodeMap, decodePack } from './localized/share';
import type { MapData, MapPack } from '../core/types';
import { Editor } from './editor';
import { ThemeEditor } from './theme-editor';
import { customTheme } from './theme-registry';
import { installTooltips } from './tooltip';
import { CampaignUI, fitRotatedGrid, themeFromKey, themeKey } from './campaign-ui';
import { levelKey, recordClear, themeUnlocked, totalStars } from './progress';
import { filledSlots, themedLevel, type ThemeEntry } from './localized/theme-pack';
import { OFFICIAL_THEMES, allThemes, badgeFor, levelThemeIn, musicFor, themeBadge, themeMusic } from './theme-registry';
import { GRAPHICS_LEVELS, onOptionsChange, options, POLLING_RATES, resetOptions, setOption } from './options';
import { refreshSkinGate, setSkinGate } from './skin';
import { CustomizeUI } from './customize-ui';
import { PlayController } from './play';
import { FONT_TASKS, runPreload, type PreloadTask } from './preload';
import { Backdrop, type BackdropMode } from './backdrop';
import { floatingPanel } from './float-panel';
import { Account } from './auth/account';
import { AuthUI, showToast } from './auth/auth-ui';
import { PlayTimeTracker } from './auth/playtime';
import { RecordSync } from './auth/records';
import { installDiamondDial, installDiamondProgress } from './diamond-dial';
import { renderTag } from './player-tag';
import { StatsUI } from './stats-ui';
import { DeathTracker } from './auth/deaths';
import { clearLeaderboardCache } from './auth/leaderboard';
import { IrisTransition } from './iris-transition';
import { gameAudio } from './audio';
import { installMenuMusicControls, menuMusicUrl } from './menu-music';
import { applyI18n } from './i18n-dom';
import { Achievements } from './achievements';
import { AchievementsUI } from './achievements-ui';
<<<<<<< HEAD
import { ACHIEVEMENTS } from '../core/achievements';
=======
import { ACHIEVEMENTS, rewardAchievement } from '../core/achievements';
import { setIcon } from './icons';
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

// Static page text comes from the locale file (src/locale/<lang>.json)
applyI18n();
installTooltips();
// Editor toolbar: icon buttons, the label in the tooltip (with the shortcut)
setIcon($<HTMLButtonElement>('btn-undo'), 'undo', t('common.undo'), 'Ctrl+Z');
setIcon($<HTMLButtonElement>('btn-redo'), 'redo', t('common.redo'), 'Ctrl+Y');
setIcon($<HTMLButtonElement>('btn-shortcuts'), 'keyboard', t('editor.shortcuts'), '?');
setIcon($<HTMLButtonElement>('btn-zoom-out'), 'zoomOut', t('editor.zoomOut'));
setIcon($<HTMLButtonElement>('btn-zoom-in'), 'zoomIn', t('editor.zoomIn'));
setIcon($<HTMLButtonElement>('btn-panels'), 'panels', t('editor.hidePanels'), 'H');
setIcon($<HTMLButtonElement>('btn-editor-fullscreen'), 'fullscreen', t('common.fullscreen'), 'F');
const iris = new IrisTransition();

const REOPEN_OPTIONS_KEY = 'avoid-n-survive:reopen-options';
const VERSION = versionFile.trim();
for (const id of ['menu-version', 'preload-version']) $(id).textContent = VERSION;

// ───────────────────────── Screens ─────────────────────────

type Screen = 'preload' | 'menu' | 'themes' | 'levels' | 'themeEditor' | 'options' | 'licenses' | 'stats' | 'achievements' | 'customize' | 'auth' | 'verify' | 'play' | 'editor';

const screens: Record<Screen, HTMLElement> = {
  preload: $('preload-screen'),
  menu: $('menu-screen'),
  themes: $('themes-screen'),
  levels: $('levels-screen'),
  themeEditor: $('theme-editor-screen'),
  options: $('options-screen'),
  licenses: $('licenses-screen'),
  stats: $('stats-screen'),
  achievements: $('achievements-screen'),
  customize: $('customize-screen'),
  auth: $('auth-screen'),
  verify: $('verify-screen'),
  play: $('play-view'),
  editor: $('editor-view'),
};
const levelSelect = $<HTMLSelectElement>('level-select');
const backToEditor = $<HTMLButtonElement>('btn-back-editor');
const openInEditor = $<HTMLButtonElement>('btn-play-edit');
const nextLevelBtn = $<HTMLButtonElement>('btn-next-level');
const debugPanel = $('debug-panel');

const play = new PlayController({
  root: $('play-view'),
  canvas: $<HTMLCanvasElement>('play-canvas'),
  status: $('play-status'),
  debug: $('debug-stats'),
});

const editor = new Editor({
  canvas: $<HTMLCanvasElement>('editor-canvas'),
  hint: $('editor-hint'),
  palette: $('palette'),
  theme: $('theme-panel'),
  level: $('level-panel'),
  snap: $<HTMLInputElement>('opt-snap'),
  preview: $<HTMLInputElement>('opt-preview'),
  gridTop: $<HTMLInputElement>('opt-grid-top'),
  center: $<HTMLInputElement>('opt-center'),
  symmetry: $<HTMLSelectElement>('opt-symmetry'),
  symmetryStatus: $('symmetry-status'),
  undo: $<HTMLButtonElement>('btn-undo'),
  redo: $<HTMLButtonElement>('btn-redo'),
  shortcuts: $<HTMLButtonElement>('btn-shortcuts'),
  zoomIn: $<HTMLButtonElement>('btn-zoom-in'),
  zoomOut: $<HTMLButtonElement>('btn-zoom-out'),
  zoomReset: $<HTMLButtonElement>('btn-zoom-reset'),
  name: $<HTMLInputElement>('map-name'),
  author: $<HTMLInputElement>('map-author'),
  size: $<HTMLSelectElement>('map-size'),
  props: $('props'),
  messages: $('messages'),
  verify: $('verify-status'),
  test: $<HTMLButtonElement>('btn-test'),
  share: $<HTMLButtonElement>('btn-share'),
  shareUrl: $<HTMLInputElement>('share-url'),
  exportBtn: $<HTMLButtonElement>('btn-export'),
  importBtn: $<HTMLButtonElement>('btn-import'),
  importFile: $<HTMLInputElement>('import-file'),
  newBtn: $<HTMLButtonElement>('btn-new'),
});

const campaign = new CampaignUI($('themes-screen'), $('levels-screen'));
const fitDia = (id: string, maxW: number, maxH: number) => fitRotatedGrid($(id), $(id).querySelector<HTMLElement>('.dgrid')!, maxW, maxH, 1.5);
const fitMenu = () => fitDia('menu-dia', Math.min(1000, window.innerWidth * 0.96), Math.max(320, Math.min(window.innerHeight * 0.8, window.innerHeight - 230)));
/** Options and stats: larger panels; the screen scrolls rather than shrinking text too far */
/** Width kept free beside the achievements grid: page buttons, Status/Category (left) and Back (right) */
const ACH_SIDE = 500;
/** Height kept free below the achievements grid (page number) */
const ACH_BELOW = 40;
/** `side`: width kept free beside the grid (page buttons) */
const fitPanel = (id: string, side = 0, below = 0) => {
  const wrap = $(id);
  const flat = window.innerWidth < 640; // too narrow for a turned grid: style.css lays out upright cards
  wrap.classList.toggle('dia-flat', flat);
  if (flat) {
    wrap.style.width = wrap.style.height = '';
    wrap.querySelector<HTMLElement>('.dgrid')!.style.transform = '';
  } else fitDia(id, Math.min(1100, window.innerWidth * 0.96 - side), Math.max(below ? 280 : 480, window.innerHeight - 150 - below));
};
window.addEventListener('resize', () => {
  if (current === 'menu') fitMenu();
  if (current === 'options') fitPanel('options-dia');
  if (current === 'stats') fitPanel('stats-dia');
  if (current === 'achievements') fitPanel('achievements-dia', ACH_SIDE, ACH_BELOW);
  if (current === 'customize') fitPanel('customize-dia');
});
campaign.onBack = (from) => show(from === 'levels' ? 'themes' : 'menu');
campaign.onPlay = (theme, level) => {
  if (level < 0) return show('levels');
  playCampaign(theme, level);
};

/** Start the selected campaign level directly. */
function playCampaign(theme: ThemeEntry, level: number): void {
  const map = themedLevel(theme, level);
  if (map) showPlay(map, { key: `c:${themeKey(theme)}:${level}` });
}

/** 'c:<theme key>:<level index>' → the theme and level index */
function campaignOf(key: string): { theme: ThemeEntry; index: number } | null {
  if (!key.startsWith('c:')) return null;
  const parts = key.split(':');
  const theme = themeFromKey(parts[1]);
  const index = Number(parts[2]);
  return theme && Number.isInteger(index) ? { theme, index } : null;
}
for (const s of ['themes', 'levels'] as const) {
  screens[s].addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show(s === 'levels' ? 'themes' : 'menu');
  });
}

const themeEditor = new ThemeEditor($('theme-editor-screen'));
themeEditor.onBack = () => show('menu');
themeEditor.getEditorMap = () => editor.getMap();
themeEditor.onPlayCustom = () => {
  const t = customTheme();
  if (!t) return;
  campaign.renderLevels(t); // makes it the current world
  show('levels');
};
$('menu-theme-editor').addEventListener('click', () => show('themeEditor'));

editor.onChange = () => syncMusic();

const backdrop = new Backdrop($('app-bg'), $<HTMLCanvasElement>('demo-bg'));
/** Background per screen; the map and theme editors share the world select grid */
function syncBackdrop(): void {
  const modes: Partial<Record<Screen, BackdropMode>> = { play: 'none', themes: 'grid', editor: 'grid', themeEditor: 'grid', levels: 'theme' };
  backdrop.set(modes[current] ?? 'demo', campaign.currentTheme ?? campaignOf(currentKey)?.theme ?? OFFICIAL_THEMES[0]);
}

let current: Screen = 'preload';
let sharedMap: MapData | null = null;
/** Map pack being played (from a share link, or "Play pack" in the editor) */
let playPack: MapPack | null = null;
let currentMap: MapData = BUILTIN_LEVELS[0];
/** Level list entry being played: 'b:3' built-in, 'p:3' pack level, 'shared', or '' (editor test) */
let currentKey = '';
let testing = false;

function syncMusic(): void {
  // Map editor (and its test play): the chosen chapter theme's music, else the menu music
  if (current === 'editor' || (current === 'play' && testing)) {
    gameAudio.setMusic(musicFor(current === 'editor' ? editor.mapLook : currentMap) ?? menuMusicUrl);
    return;
  }
  // A shared map plays its picked theme's music
  if (current === 'play' && currentKey === 'shared') {
    gameAudio.setMusic(musicFor(currentMap));
    return;
  }
  // Campaign levels: their pack's music, or that of the theme linked to their design
  const c = current === 'play' ? campaignOf(currentKey) : null;
  const theme = current === 'levels' ? campaign.currentTheme : c ? levelThemeIn(c.theme, currentMap) : null;
  if (current === 'levels' || current === 'play') {
    gameAudio.setMusic(themeMusic(theme ?? null));
  } else if (current === 'themeEditor' || current === 'preload') {
    gameAudio.setMusic(null);
  } else gameAudio.setMusic(menuMusicUrl);
}

installMenuMusicControls(syncMusic);

function screenColors(screen: Screen): readonly [string, string] | undefined {
  if (screen === 'levels') return (campaign.currentTheme ?? campaignOf(currentKey)?.theme)?.info.colors;
  if (screen === 'play') return campaignOf(currentKey)?.theme.info.colors;
  return undefined;
}

function show(next: Screen, prepare?: () => void, colors?: readonly [string, string]): void {
  if (current === next && !prepare) return;
  iris.run(() => {
    prepare?.();
    showImmediately(next);
  }, colors ?? screenColors(next) ?? screenColors(current) ?? ['#9fe2ff', '#c3b5ff']);
}

function showImmediately(next: Screen): void {
  if (current === 'play' && next !== 'play') play.hide();
  if (current === 'editor' && next !== 'editor') editor.hide();
  if (current === 'themeEditor' && next !== 'themeEditor') themeEditor.hide();
  for (const [name, el] of Object.entries(screens)) el.hidden = name !== next;
  const inGame = next === 'play' || next === 'editor';
  document.body.classList.toggle('in-game', inGame);
  current = next;
  // The demo only runs on menu screens, so gameplay and editing keep the whole frame budget
  syncBackdrop();
  if (next === 'play') play.show();
  if (next === 'editor') {
    editor.show();
    for (const p of editorPanels) p.refresh();
  }
  if (next === 'menu') {
    $('menu-stars').textContent = String(totalStars());
    requestAnimationFrame(fitMenu);
    $('menu-start').focus();
  }
  if (next === 'themes') campaign.renderThemes();
  if (next === 'themeEditor') themeEditor.show();
  if (next === 'levels') {
    const t = campaign.currentTheme ?? campaignOf(currentKey)?.theme ?? OFFICIAL_THEMES[0];
    if (t) campaign.renderLevels(t);
  }
  if (next === 'options') {
    requestAnimationFrame(() => fitPanel('options-dia'));
    $('options-back').focus();
  }
  if (next === 'stats') {
    requestAnimationFrame(() => fitPanel('stats-dia'));
    void stats.render();
    $('stats-back').focus();
  }
<<<<<<< HEAD
  if (next === 'achievements') { achievementsUI.open(); $('achievements-back').focus(); }
  if (next === 'customize') $('customize-back').focus();
=======
  if (next === 'achievements') {
    achievementsUI.open();
    requestAnimationFrame(() => fitPanel('achievements-dia', ACH_SIDE, ACH_BELOW));
    $('achievements-back').focus();
  }
  if (next === 'customize') {
    customizeUI.show();
    requestAnimationFrame(() => fitPanel('customize-dia'));
    $('customize-back').focus();
  }
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
  if (next === 'licenses') {
    renderFontLicenses($('licenses-list'));
    $('licenses-back').focus();
  }
  syncMusic();
}

function showPlay(map: MapData, opts: { test?: boolean; key?: string } = {}): void {
  show('play', () => {
    testing = !!opts.test;
    currentMap = map;
    currentKey = opts.key ?? '';
    // Campaign levels wear their theme's badge design
    const c = campaignOf(currentKey);
    // Other maps (editor test play, shared links) wear their chapter preset's badge, if any
    play.badge = c ? themeBadge(levelThemeIn(c.theme, map)) : badgeFor(map);
    renderLevelOptions(); // worlds may have unlocked since
    if (currentKey) levelSelect.value = currentKey;
    // From the editor the level list only makes sense while playing a pack
    levelSelect.hidden = testing && !currentKey.startsWith('p:');
    openInEditor.hidden = testing;
    backToEditor.hidden = !testing;
    play.load(map);
    updateNext();
  }, campaignOf(opts.key ?? '')?.theme.info.colors);
}

function showEditor(): void {
  testing = false;
  show('editor');
}

function mapFor(key: string): MapData | null {
  if (key === 'shared') return sharedMap;
  if (key.startsWith('c:')) {
    const c = campaignOf(key);
    return c ? themedLevel(c.theme, c.index) : null;
  }
  const [kind, n] = key.split(':');
  const list = kind === 'p' ? playPack?.levels : kind === 'b' ? BUILTIN_LEVELS : undefined;
  return list?.[Number(n)] ?? null;
}

/** The entry after the current one in a pack or the built-in list */
function nextKey(): string | null {
  const c = campaignOf(currentKey);
  if (c) {
    // The next slot that holds a level (chapters can have empty "Soon" slots in between)
    const next = filledSlots(c.theme).find((i) => i > c.index);
    const key = next !== undefined ? `c:${themeKey(c.theme)}:${next}` : null;
    return key && mapFor(key) ? key : null;
  }
  const [kind, n] = currentKey.split(':');
  if (kind !== 'p' && kind !== 'b') return null;
  const key = `${kind}:${Number(n) + 1}`;
  return mapFor(key) ? key : null;
}

function updateNext(): void {
  const next = nextKey();
  nextLevelBtn.hidden = !next;
  play.nextHint = next ? t('play.nextHint') : null;
}

function playNext(): void {
  const key = nextKey();
  const c = key ? campaignOf(key) : null;
  if (c && !testing) return playCampaign(c.theme, c.index);
  const map = key ? mapFor(key) : null;
  if (key && map) showPlay(map, { test: testing, key });
}

function selectedLevel(): { map: MapData; key: string } {
  const key = levelSelect.value;
  const map = mapFor(key);
  if (map) return { map, key };
  const first = OFFICIAL_THEMES[0];
  return { map: (first && themedLevel(first, 0)) || BUILTIN_LEVELS[0], key: first ? `c:${themeKey(first)}:0` : '' };
}

function renderLevelOptions(): void {
  const groups: HTMLElement[] = [];
  if (playPack) {
    const g = document.createElement('optgroup');
    g.label = playPack.author ? t('main.packByOption', { name: playPack.name, author: playPack.author }) : t('main.packOption', { name: playPack.name });
    g.append(...playPack.levels.map((m, i) => new Option(levelLabel(m), `p:${i}`)));
    groups.push(g);
  }
  if (sharedMap) groups.push(new Option(t('main.sharedOption', { label: levelLabel(sharedMap) }), 'shared'));
  allThemes().forEach((th) => {
    if (!th.levels.length || !themeUnlocked(th)) return;
    const g = document.createElement('optgroup');
    g.label = th.official ? th.info.name : t('main.customOption', { name: th.info.name });
    const chapter = OFFICIAL_THEMES.indexOf(th);
    g.append(...filledSlots(th).map((i) => {
      const map = themedLevel(th, i)!;
      // Chapter levels go by their code ("1-03 · Title"), whatever the map's own level number says
      const label = chapter >= 0 ? `${chapterLevelCode(chapter + 1, i + 1)} · ${map.title || map.name}` : levelLabel(map);
      return new Option(label, `c:${themeKey(th)}:${i}`);
    }));
    groups.push(g);
  });
  levelSelect.replaceChildren(...groups);
  if (currentKey && mapFor(currentKey)) levelSelect.value = currentKey;
}

// ───────────────────────── Main menu ─────────────────────────

$('menu-start').addEventListener('click', () => show('themes'));
$('menu-options').addEventListener('click', () => show('options'));
$('menu-editor').addEventListener('click', showEditor);

// Arrow keys move between menu buttons
for (const screen of [screens.menu, screens.options, screens.stats]) {
  screen.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...screen.querySelectorAll<HTMLElement>('.menu-btn, .dgrid input, .dgrid button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
    e.preventDefault();
  });
}

// ───────────────────────── Options ─────────────────────────

type ToggleOption = 'showDebug';
type VolumeOption = 'masterVolume' | 'musicVolume' | 'effectsVolume';
const optionInputs: Record<ToggleOption, HTMLInputElement> = {
  showDebug: $<HTMLInputElement>('opt-debug'),
};

const volumeInputs: Record<VolumeOption, HTMLInputElement> = {
  masterVolume: $<HTMLInputElement>('opt-master-volume'),
  musicVolume: $<HTMLInputElement>('opt-music-volume'),
  effectsVolume: $<HTMLInputElement>('opt-effects-volume'),
};

/** Volume sliders drawn as diamond dials; each entry redraws its dial after a code-side change */
const volumeDials = Object.fromEntries(
  (Object.entries(volumeInputs) as [VolumeOption, HTMLInputElement][]).map(([k, input]) => [k, installDiamondDial(input)]),
) as Record<VolumeOption, () => void>;

function syncOptions(): void {
  for (const [k, input] of Object.entries(optionInputs) as [ToggleOption, HTMLInputElement][]) {
    input.checked = options[k];
  }
  for (const [k, input] of Object.entries(volumeInputs) as [VolumeOption, HTMLInputElement][]) {
    input.value = String(options[k]);
    volumeDials[k]();
    input.setAttribute('aria-valuetext', `${options[k]}%`);
    $(`${input.id}-value`).textContent = `${options[k]}%`;
  }
  debugPanel.hidden = !options.showDebug;
}

for (const [k, input] of Object.entries(optionInputs) as [ToggleOption, HTMLInputElement][]) {
  input.addEventListener('change', () => setOption(k, input.checked));
}
for (const [k, input] of Object.entries(volumeInputs) as [VolumeOption, HTMLInputElement][]) {
  input.addEventListener('input', () => setOption(k, Number(input.value)));
}
onOptionsChange(syncOptions);
syncOptions();

// Polling rate (play input samples per second) and graphics quality
// Each click steps to the next value (Auto → Max → 1000 → … → 125 → Auto).
const pollingTile = $<HTMLButtonElement>('opt-polling');
pollingTile.addEventListener('click', () => {
  setOption('pollingRate', POLLING_RATES[(POLLING_RATES.indexOf(options.pollingRate) + 1) % POLLING_RATES.length]);
});
const graphicsTile = $<HTMLButtonElement>('opt-graphics');
graphicsTile.addEventListener('click', () => {
  const next = GRAPHICS_LEVELS[(GRAPHICS_LEVELS.indexOf(options.graphics) + 1) % GRAPHICS_LEVELS.length];
  setOption('graphics', next);
});
let appliedGraphics = options.graphics;
const syncPerformance = () => {
  pollingTile.dataset.level = options.pollingRate ? 'capped' : 'max';
  $('opt-polling-value').textContent = options.pollingRate === -1 ? t('options.pollingAuto')
    : options.pollingRate ? `${options.pollingRate} Hz` : t('options.pollingMax');
  graphicsTile.dataset.level = options.graphics;
  $('opt-graphics-value').textContent = t(`options.graphics.${options.graphics}`);
  // A new resolution: every canvas refits on resize
  if (options.graphics !== appliedGraphics) {
    appliedGraphics = options.graphics;
    window.dispatchEvent(new Event('resize'));
  }
};
onOptionsChange(syncPerformance);
syncPerformance();

$('options-back').addEventListener('click', () => show('menu'));
$('options-reset').addEventListener('click', () => {
  resetOptions();
});
$('options-licenses').addEventListener('click', () => openLicenses('options'));

// Language: saved, then the page reloads so every string (many are built at startup) switches
const languageSelect = $<HTMLSelectElement>('opt-language');
languageSelect.append(...LANGUAGES.map((l) => new Option(l.label, l.id, false, l.id === language)));
languageSelect.title = t('options.languageReload');
languageSelect.addEventListener('change', () => {
  const next = languageSelect.value as Language;
  if (next === language) return;
  if (!saveLanguage(next)) {
    languageSelect.value = language;
    return;
  }
  try { sessionStorage.setItem(REOPEN_OPTIONS_KEY, '1'); } catch { /* land on the menu instead */ }
  location.reload();
});
/** The licenses list doubles as the Credits page; Back returns to where it was opened from */
let licensesFrom: 'options' | 'menu' = 'options';
const openLicenses = (from: 'options' | 'menu') => {
  licensesFrom = from;
  $('licenses-title').textContent = t(from === 'menu' ? 'menu.credits' : 'options.licenses');
  show('licenses');
};
$('menu-credits').addEventListener('click', () => openLicenses('menu'));
$('licenses-back').addEventListener('click', () => show(licensesFrom));
screens.licenses.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') show(licensesFrom);
});
$('menu-stats').addEventListener('click', () => show('stats'));
$('menu-achievements').addEventListener('click', () => show('achievements'));
const customizeUI = new CustomizeUI($('customize-grid'));
$('menu-customize').addEventListener('click', () => show('customize'));
$('stats-refresh').addEventListener('click', () => void stats.render());
for (const s of ['stats', 'achievements', 'customize'] as const) {
  $(`${s}-back`).addEventListener('click', () => show('menu'));
  screens[s].addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show('menu');
  });
}
screens.options.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') show('menu');
});

// ───────────────────────── Play / editor navigation ─────────────────────────

levelSelect.addEventListener('change', () => {
  const { map, key } = selectedLevel();
  showPlay(map, { test: testing && key.startsWith('p:'), key });
  levelSelect.blur(); // a lingering dropdown focus could trigger a blur fail on click
});
nextLevelBtn.addEventListener('click', () => {
  playNext();
  nextLevelBtn.blur();
});
$('btn-editor-menu').addEventListener('click', () => show('menu'));
backToEditor.addEventListener('click', showEditor);
$('btn-play-menu').addEventListener('click', () => leavePlay());
$('btn-play-back').addEventListener('click', () => leavePlay());

// Fullscreen: on a 16:9 monitor the game then fills the entire screen
const fullscreenButtons = [...document.querySelectorAll<HTMLButtonElement>('.btn-fullscreen')];
const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
};
for (const b of fullscreenButtons) b.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  const label = t(on ? 'common.exitFullscreen' : 'common.fullscreen');
  for (const b of fullscreenButtons) {
    if (b.classList.contains('icon-btn')) setIcon(b, on ? 'exitFullscreen' : 'fullscreen', label, 'F');
    else b.textContent = label;
  }
});

// Editor panels float over the canvas; H (or the button) hides them to see the whole map
const editorPanels = (
  [['tools-panel', 'tools'], ['level-info-panel', 'level-info'], ['object-panel', 'object']] as const
).map(([el, id]) => floatingPanel($(el), id, { resizable: true }));
const panelsBtn = $<HTMLButtonElement>('btn-panels');
const togglePanels = () => {
  const hidden = screens.editor.classList.toggle('panels-hidden');
  panelsBtn.setAttribute('aria-pressed', String(hidden));
  setIcon(panelsBtn, hidden ? 'panelsHidden' : 'panels', t(hidden ? 'editor.showPanels' : 'editor.hidePanels'), 'H');
};
panelsBtn.addEventListener('click', togglePanels);

// No browser right-click menu anywhere in the app (the editor canvas opens its own). Text fields
// keep theirs so copy / paste by mouse still works.
// Capture phase on window, so it runs first even when something below stops the event.
// Only fields you type text into count: checkboxes, sliders, color pickers etc. are inputs too
const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number']);
const noBrowserMenu = (e: MouseEvent) => {
  const t = e.target;
  const editable = (t instanceof HTMLInputElement && TEXT_INPUTS.has(t.type)) || t instanceof HTMLTextAreaElement
    || (t instanceof HTMLElement && t.isContentEditable);
  if (!editable) e.preventDefault();
};
window.addEventListener('contextmenu', noBrowserMenu, true);
document.addEventListener('contextmenu', noBrowserMenu);

window.addEventListener('keydown', (e) => {
  if ((current !== 'play' && current !== 'editor') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  // Physical keys, so these also work with a non-Latin IME
  if (e.code === 'KeyF') toggleFullscreen();
  else if (current === 'editor' && e.code === 'KeyH') togglePanels();
  else if (current === 'play' && e.code === 'KeyN' && play.status !== 'playing') playNext();
});
openInEditor.addEventListener('click', () => {
  editor.loadMap(currentMap);
  showEditor();
});

editor.onTest = (map) => showPlay(map, { test: true });
play.onClear = (map, _replay, time, crystal) => {
  // Campaign stars (and the crystal star, if carried to GOAL)
  const c = campaignOf(currentKey);
  if (c && !testing) {
<<<<<<< HEAD
    const stars = recordClear(c.theme, c.index, map, time);
    if (c.theme.official) achievements.record(levelKey(c.theme, c.index), time, stars);
=======
    const stars = recordClear(c.theme, c.index, map, time, crystal);
    if (c.theme.official) {
      const key = levelKey(c.theme, c.index);
      achievements.record(key, time, stars, crystal);
    }
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
  }
  // A clear of the same gameplay verifies the editor's map for sharing
  editor.markVerified(map, time);
};
// Esc / Main Menu: back to where the level was picked
const leavePlay = () => (testing ? showEditor() : currentKey.startsWith('c:') ? show('levels') : show('menu'));
play.onExit = leavePlay;

// ───────────────────────── Accounts ─────────────────────────

const account = new Account();
const achievements = new Achievements(account);
<<<<<<< HEAD
const achievementsUI = new AchievementsUI($('achievements-content'), achievements, (def) => {
  for (const key of def.levels) {
    const record = achievements.records[key];
    if (record && (def.kind === 'clear' || record.stars >= 3)) continue;
=======
const achievementsUI = new AchievementsUI({
  grid: $('achievements-grid'),
  status: $('achievements-status'),
  prev: $<HTMLButtonElement>('achievements-prev'),
  next: $<HTMLButtonElement>('achievements-next'),
  page: $('achievements-page'),
  filter: $<HTMLButtonElement>('achievements-filter'),
  category: $<HTMLButtonElement>('achievements-category'),
}, achievements, (def) => {
  if (def.kind === 'discord') return () => $('menu-discord').click();
  for (const key of def.levels) {
    const record = achievements.records[key];
    if (def.kind === 'stars' && record && record.stars >= 3) continue;
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
    const [id, slot] = key.split('/');
    const theme = OFFICIAL_THEMES.find(t => t.info.id === id);
    if (!theme || !themeUnlocked(theme) || !filledSlots(theme).includes(Number(slot))) continue;
    return () => { campaign.renderLevels(theme); show('levels'); };
  }
  return null;
});
<<<<<<< HEAD
=======
// Reward skins unlock with their achievement
setSkinGate((kind, n) => {
  const def = rewardAchievement(kind, n);
  return !def || !!achievements.unlocks[def.id];
});
achievements.subscribe(refreshSkinGate);
$('menu-discord').addEventListener('click', () => achievements.claimDiscord());
>>>>>>> 33e5f4f737b41ce92384948a16016133a510cf06
achievements.onUnlock = (ids) => {
  const names = ids.slice(0, 3).map(id => t(ACHIEVEMENTS.find(d => d.id === id)!.name)).join(', ');
  showToast(t('ach.unlocked', { names }) + (ids.length > 3 ? t('ach.more', { n: ids.length - 3 }) : ''), 'ok');
};
// Total time the game is open, saved to the player's profile
const playTime = new PlayTimeTracker(account);
// Deaths in runs (total and per level), saved to the player's account
const deaths = new DeathTracker(account);
account.beforeSignOut = async () => {
  await Promise.all([playTime.flush(), deaths.flush()]);
};
play.onDeath = () => {
  if (testing) return; // editor test plays don't count
  const c = campaignOf(currentKey);
  deaths.record(c ? levelKey(c.theme, c.index) : null);
};
// Best time (ms) and stars per level, saved to the player's account
const recordSync = new RecordSync(account);
recordSync.onSaved = () => {
  void achievements.refresh();
  if (current === 'levels' && campaign.currentTheme) campaign.renderLevels(campaign.currentTheme);
  if (current === 'themes') campaign.renderThemes();
  $('menu-stars').textContent = String(totalStars());
  renderLevelOptions();
};
const recordsButton = $<HTMLButtonElement>('records-sync');
const importGuestButton = $<HTMLButtonElement>('records-import-guest');
const recordsStatus = $('records-status');
const signedOutRecords = t('records.signedOut');
function renderRecordsOption(): void {
  importGuestButton.disabled = !recordSync.canImportGuest || !!recordsButton.dataset.busy;
  if (recordsButton.dataset.busy) return;
  recordsButton.disabled = !recordSync.available;
  if (recordSync.available) {
    const to = document.createElement('span');
    renderTag(to, account.tag ?? t('records.yourAccount'));
    recordsStatus.replaceChildren(t('records.savedTo'), to);
  } else recordsStatus.textContent = account.configured ? signedOutRecords : t('records.local');
  recordsButton.title = recordSync.available
    ? t('records.syncHint')
    : account.configured ? t('records.signInHint') : t('records.unconfiguredHint');
}
const stats = new StatsUI($('stats-dia'), $('stats-message'), $('stats-records'), account, recordSync, deaths);
account.onChange(() => current === 'stats' && void stats.render());
account.onChange(renderRecordsOption);
account.onChange(clearLeaderboardCache); // so the player's own row is marked after signing in
renderRecordsOption();
let progressUser = account.user?.id ?? null;
account.onChange(() => {
  const next = account.user?.id ?? null;
  if (next === progressUser) return;
  progressUser = next;
  // A run started by the previous player must not be recorded for the next one.
  if (current === 'play') play.load(currentMap);
});
importGuestButton.addEventListener('click', () => {
  recordSync.importGuest();
  showToast(t('records.guestImported'), 'ok');
  renderRecordsOption();
});
recordsButton.addEventListener('click', async () => {
  recordsButton.dataset.busy = '1';
  recordsButton.disabled = true;
  importGuestButton.disabled = true;
  recordsStatus.textContent = t('records.syncing');
  const result = await recordSync.syncAll();
  delete recordsButton.dataset.busy;
  renderRecordsOption();
  if (result.ok) {
    recordsStatus.textContent = t('records.synced', { up: result.uploaded, down: result.downloaded });
    $('menu-stars').textContent = String(totalStars());
    renderLevelOptions();
  } else recordsStatus.textContent = result.message;
  showToast(result.ok ? t('records.syncedToast') : result.message, result.ok ? 'ok' : 'error');
});
const authUI = new AuthUI(account, (screen) => show(screen));
// Player tile: signed in → their stats, signed out → sign in
$('menu-user').addEventListener('click', () => (account.user ? show('stats') : authUI.open('signin')));
for (const s of [screens.auth, screens.verify]) {
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show('menu');
  });
}

// ───────────────────────── Boot ─────────────────────────

/** After a language change the page reloads; land back on Options instead of the main menu */
function reopenOptions(): boolean {
  try {
    const yes = sessionStorage.getItem(REOPEN_OPTIONS_KEY) === '1';
    sessionStorage.removeItem(REOPEN_OPTIONS_KEY);
    return yes;
  } catch {
    return false;
  }
}

function sharedPackTask(): PreloadTask | null {
  const m = /^#p=(.+)$/.exec(location.hash);
  if (!m) return null;
  return {
    label: t('preload.sharedPack'),
    run: async () => {
      try {
        playPack = await decodePack(m[1]);
      } catch (err) {
        alert(t('main.packLinkFailed', { message: (err as Error).message }));
      }
    },
  };
}

function sharedMapTask(): PreloadTask | null {
  const m = /^#m=(.+)$/.exec(location.hash);
  if (!m) return null;
  return {
    label: t('preload.sharedMap'),
    run: async () => {
      try {
        sharedMap = await decodeMap(m[1]);
      } catch (err) {
        alert(t('main.mapLinkFailed', { message: (err as Error).message }));
      }
    },
  };
}

async function boot(): Promise<void> {
  const percent = $('preload-percent');
  const setProgress = installDiamondProgress($('preload-dia'), (r) => (percent.textContent = `${Math.round(r * 100)}%`));
  const text = $('preload-text');
  const shared = sharedMapTask() ?? sharedPackTask();
  const accountTask: PreloadTask = { label: t('common.account'), run: async () => {
    await account.init();
    achievements.initializeGuest();
  } };
  const tasks = [...FONT_TASKS, accountTask, ...(shared ? [shared] : [])];

  await runPreload(tasks, (done, total, label) => {
    setProgress(done / total);
    text.textContent = done === total ? t('preload.ready') : label;
  });

  renderLevelOptions();

  // A share link goes straight to that map; otherwise land on the main menu
  if (sharedMap) showPlay(sharedMap, { key: 'shared' });
  else if (playPack) showPlay(playPack.levels[0], { key: 'p:0' });
  else show(reopenOptions() ? 'options' : 'menu');

  // Result of an email verification link, if the player just came back from one
  if (account.notice) showToast(account.notice.text, account.notice.kind);
}

window.addEventListener('hashchange', async () => {
  const isPack = location.hash.startsWith('#p=');
  const task = isPack ? sharedPackTask() : sharedMapTask();
  if (!task) return;
  await task.run();
  renderLevelOptions();
  if (isPack && playPack) showPlay(playPack.levels[0], { key: 'p:0' });
  else if (!isPack && sharedMap) showPlay(sharedMap, { key: 'shared' });
});

// Button clicks on menu screens (not the theme editor) make a click sound. Capture phase, so it
// plays even when the button's own handler switches screens.
document.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest?.('button');
  if (!btn || btn.disabled || !btn.closest('.screen.menu') || btn.closest('.te-screen')) return;
  gameAudio.play('click');
}, true);

void boot();
