import { renderFontLicenses } from './font-licenses';
import './style.css';
// Game version, e.g. "Update 20" — edit the VERSION file at the repo root
import versionFile from '../../VERSION?raw';
import { BUILTIN_LEVELS } from '../core/levels';
import { levelLabel } from '../core/level';
import { decodeMap, decodePack } from '../core/share';
import type { MapData, MapPack } from '../core/types';
import { Editor } from './editor';
import { ThemeEditor } from './theme-editor';
import { customTheme } from './theme-registry';
import { installTooltips } from './tooltip';
import { CampaignUI, fitRotatedGrid, themeFromKey, themeKey } from './campaign-ui';
import { levelKey, recordClear, themeUnlocked, totalStars } from './progress';
import { filledSlots, themedLevel, type ThemeEntry } from '../core/theme-pack';
import { OFFICIAL_THEMES, allThemes, badgeFor, chapterMusicFor } from './theme-registry';
import { onOptionsChange, options, resetOptions, setOption } from './options';
import { PlayController } from './play';
import { FONT_TASKS, runPreload, type PreloadTask } from './preload';
import { Backdrop, type BackdropMode } from './backdrop';
import { floatingPanel } from './float-panel';
import { Account } from './auth/account';
import { AuthUI, showToast } from './auth/auth-ui';
import { PlayTimeTracker } from './auth/playtime';
import { RecordSync } from './auth/records';
import { installDiamondDial } from './diamond-dial';
import { renderTag } from './player-tag';
import { StatsUI } from './stats-ui';
import { DeathTracker } from './auth/deaths';
import { clearLeaderboardCache } from './auth/leaderboard';
import { IrisTransition } from './iris-transition';
import { gameAudio } from './audio';
import { installMenuMusicControls, menuMusicUrl } from './menu-music';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

installTooltips();
const iris = new IrisTransition();

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
  undo: $<HTMLButtonElement>('btn-undo'),
  redo: $<HTMLButtonElement>('btn-redo'),
  shortcuts: $<HTMLButtonElement>('btn-shortcuts'),
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
const fitDia = (id: string, maxW: number, maxH: number) => fitRotatedGrid($(id), $(id).querySelector<HTMLElement>('.dgrid')!, maxW, maxH);
const fitMenu = () => fitDia('menu-dia', Math.min(560, window.innerWidth * 0.9), window.innerHeight * 0.58);
/** Options and stats: larger panels; the screen scrolls rather than shrinking text too far */
const fitPanel = (id: string) => {
  const wrap = $(id);
  const flat = window.innerWidth < 640; // too narrow for a turned grid: style.css lays out upright cards
  wrap.classList.toggle('dia-flat', flat);
  if (flat) {
    wrap.style.width = wrap.style.height = '';
    wrap.querySelector<HTMLElement>('.dgrid')!.style.transform = '';
  } else fitDia(id, Math.min(860, window.innerWidth * 0.94), Math.max(480, window.innerHeight - 190));
};
window.addEventListener('resize', () => {
  if (current === 'menu') fitMenu();
  if (current === 'options') fitPanel('options-dia');
  if (current === 'stats') fitPanel('stats-dia');
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
    gameAudio.setMusic(chapterMusicFor(current === 'editor' ? editor.mapTheme : currentMap.theme) ?? menuMusicUrl);
    return;
  }
  const theme = current === 'levels' ? campaign.currentTheme : current === 'play' ? campaignOf(currentKey)?.theme : null;
  if (current === 'levels' || current === 'play') {
    gameAudio.setMusic(theme?.info.music ? theme.assets[theme.info.music] ?? null : null);
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
  if (next === 'achievements') $('achievements-back').focus();
  if (next === 'customize') $('customize-back').focus();
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
    play.badge = c ? { style: c.theme.info.style.badge, imageUrl: c.theme.badgeUrl } : badgeFor(map);
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
  play.nextHint = next ? 'press N for the next level' : null;
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
    g.label = `Pack: ${playPack.name}${playPack.author ? ` by ${playPack.author}` : ''}`;
    g.append(...playPack.levels.map((m, i) => new Option(levelLabel(m), `p:${i}`)));
    groups.push(g);
  }
  if (sharedMap) groups.push(new Option(`Shared map: ${levelLabel(sharedMap)}`, 'shared'));
  allThemes().forEach((t) => {
    if (!t.levels.length || !themeUnlocked(t)) return;
    const g = document.createElement('optgroup');
    g.label = t.official ? t.info.name : `Custom: ${t.info.name}`;
    g.append(...filledSlots(t).map((i) => new Option(levelLabel(themedLevel(t, i)!), `c:${themeKey(t)}:${i}`)));
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

type ToggleOption = 'showTrail' | 'showTimer' | 'showDebug';
type VolumeOption = 'masterVolume' | 'musicVolume' | 'effectsVolume';
const optionInputs: Record<ToggleOption, HTMLInputElement> = {
  showTrail: $<HTMLInputElement>('opt-trail'),
  showTimer: $<HTMLInputElement>('opt-timer'),
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

$('options-back').addEventListener('click', () => show('menu'));
$('options-reset').addEventListener('click', resetOptions);
$('options-licenses').addEventListener('click', () => show('licenses'));
$('licenses-back').addEventListener('click', () => show('options'));
screens.licenses.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') show('options');
});
$('menu-stats').addEventListener('click', () => show('stats'));
$('menu-achievements').addEventListener('click', () => show('achievements'));
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

// Fullscreen: on a 16:9 monitor the game then fills the entire screen
const fullscreenButtons = [...document.querySelectorAll<HTMLButtonElement>('.btn-fullscreen')];
const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
};
for (const b of fullscreenButtons) b.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  for (const b of fullscreenButtons) b.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});

// Editor panels float over the canvas; H (or the button) hides them to see the whole map
const editorPanels = (
  [['tools-panel', 'tools'], ['level-info-panel', 'level-info'], ['object-panel', 'object']] as const
).map(([el, id]) => floatingPanel($(el), id, { resizable: true }));
const panelsBtn = $<HTMLButtonElement>('btn-panels');
const togglePanels = () => {
  const hidden = screens.editor.classList.toggle('panels-hidden');
  panelsBtn.setAttribute('aria-pressed', String(hidden));
  panelsBtn.textContent = hidden ? 'Show panels' : 'Hide panels';
};
panelsBtn.addEventListener('click', togglePanels);

// No browser right-click menu anywhere in the app (the editor canvas opens its own). Text fields
// keep theirs so copy / paste by mouse still works.
// Capture phase on window, so it runs first even when something below stops the event.
const noBrowserMenu = (e: MouseEvent) => {
  const t = e.target;
  const editable = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
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
play.onClear = (map, _replay, time) => {
  // Campaign stars
  const c = campaignOf(currentKey);
  if (c) recordClear(c.theme, c.index, map, time);
  // A clear of the same gameplay verifies the editor's map for sharing
  editor.markVerified(map, time);
};
// Esc / Main Menu: back to where the level was picked
const leavePlay = () => (testing ? showEditor() : currentKey.startsWith('c:') ? show('levels') : show('menu'));
play.onExit = leavePlay;

// ───────────────────────── Accounts ─────────────────────────

const account = new Account();
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
const recordsButton = $<HTMLButtonElement>('records-sync');
const recordsStatus = $('records-status');
const signedOutRecords = 'Sign in to save records';
function renderRecordsOption(): void {
  if (recordsButton.dataset.busy) return;
  recordsButton.disabled = !recordSync.available;
  if (recordSync.available) {
    const to = document.createElement('span');
    renderTag(to, account.tag ?? 'your account');
    recordsStatus.replaceChildren('Saved to ', to);
  } else recordsStatus.textContent = account.configured ? signedOutRecords : 'Kept in this browser';
  recordsButton.title = recordSync.available
    ? "Upload records already in this browser and download the account's records"
    : account.configured ? 'Sign in to save your best times and stars to your account' : 'Accounts are not set up, so records stay in this browser';
}
const stats = new StatsUI($('stats-dia'), $('stats-message'), $('stats-records'), account, recordSync, deaths);
account.onChange(() => current === 'stats' && void stats.render());
account.onChange(renderRecordsOption);
account.onChange(clearLeaderboardCache); // so the player's own row is marked after signing in
renderRecordsOption();
recordsButton.addEventListener('click', async () => {
  recordsButton.dataset.busy = '1';
  recordsButton.disabled = true;
  recordsStatus.textContent = 'Syncing…';
  const result = await recordSync.syncAll();
  delete recordsButton.dataset.busy;
  renderRecordsOption();
  if (result.ok) {
    recordsStatus.textContent = `↑ ${result.uploaded} sent · ↓ ${result.downloaded} updated`;
    $('menu-stars').textContent = String(totalStars());
    renderLevelOptions();
  } else recordsStatus.textContent = result.message;
  showToast(result.ok ? 'Records synced.' : result.message, result.ok ? 'ok' : 'error');
});
new AuthUI(account, (screen) => show(screen));
for (const s of [screens.auth, screens.verify]) {
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show('menu');
  });
}

// ───────────────────────── Boot ─────────────────────────

function sharedPackTask(): PreloadTask | null {
  const m = /^#p=(.+)$/.exec(location.hash);
  if (!m) return null;
  return {
    label: 'Shared map pack',
    run: async () => {
      try {
        playPack = await decodePack(m[1]);
      } catch (err) {
        alert(`Couldn't open the map pack link: ${(err as Error).message}`);
      }
    },
  };
}

function sharedMapTask(): PreloadTask | null {
  const m = /^#m=(.+)$/.exec(location.hash);
  if (!m) return null;
  return {
    label: 'Shared map',
    run: async () => {
      try {
        sharedMap = await decodeMap(m[1]);
      } catch (err) {
        alert(`Couldn't open the share link: ${(err as Error).message}`);
      }
    },
  };
}

async function boot(): Promise<void> {
  const bar = $('preload-bar');
  const text = $('preload-text');
  const shared = sharedMapTask() ?? sharedPackTask();
  const accountTask: PreloadTask = { label: 'Account', run: () => account.init() };
  const tasks = [...FONT_TASKS, accountTask, ...(shared ? [shared] : [])];

  await runPreload(tasks, (done, total, label) => {
    bar.style.width = `${Math.round((done / total) * 100)}%`;
    text.textContent = done === total ? 'Ready' : label;
  });

  renderLevelOptions();

  // A share link goes straight to that map; otherwise land on the main menu
  if (sharedMap) showPlay(sharedMap, { key: 'shared' });
  else if (playPack) showPlay(playPack.levels[0], { key: 'p:0' });
  else show('menu');

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

void boot();
