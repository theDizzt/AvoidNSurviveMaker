import './style.css';
// Game version, e.g. "Update 20" — edit the VERSION file at the repo root
import versionFile from '../../VERSION?raw';
import { BUILTIN_LEVELS } from '../core/levels';
import { decodeMap } from '../core/share';
import type { MapData } from '../core/types';
import { Editor } from './editor';
import { onOptionsChange, options, resetOptions, setOption, type Options } from './options';
import { PlayController } from './play';
import { FONT_TASKS, runPreload, type PreloadTask } from './preload';
import { LiquidBackground } from './liquid';
import { floatingPanel } from './float-panel';
import { Account } from './auth/account';
import { AuthUI, showToast } from './auth/auth-ui';
import { PlayTimeTracker } from './auth/playtime';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const VERSION = versionFile.trim();
for (const id of ['menu-version', 'preload-version']) $(id).textContent = VERSION;

// ───────────────────────── Screens ─────────────────────────

type Screen = 'preload' | 'menu' | 'options' | 'auth' | 'verify' | 'play' | 'editor';

const screens: Record<Screen, HTMLElement> = {
  preload: $('preload-screen'),
  menu: $('menu-screen'),
  options: $('options-screen'),
  auth: $('auth-screen'),
  verify: $('verify-screen'),
  play: $('play-view'),
  editor: $('editor-view'),
};
const levelSelect = $<HTMLSelectElement>('level-select');
const backToEditor = $<HTMLButtonElement>('btn-back-editor');
const openInEditor = $<HTMLButtonElement>('btn-play-edit');
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

const liquid = new LiquidBackground($<HTMLCanvasElement>('liquid-bg'));
liquid.setActive(true);

let current: Screen = 'preload';
let sharedMap: MapData | null = null;
let currentMap: MapData = BUILTIN_LEVELS[0];
let testing = false;

function show(next: Screen): void {
  if (current === 'play' && next !== 'play') play.hide();
  if (current === 'editor' && next !== 'editor') editor.hide();
  for (const [name, el] of Object.entries(screens)) el.hidden = name !== next;
  const inGame = next === 'play' || next === 'editor';
  // The liquid animation only runs on menu screens, so gameplay keeps the whole frame budget
  document.body.classList.toggle('in-game', inGame);
  liquid.setActive(!inGame);
  current = next;
  if (next === 'play') play.show();
  if (next === 'editor') {
    editor.show();
    for (const p of editorPanels) p.refresh();
  }
  if (next === 'menu') $('menu-start').focus();
  if (next === 'options') $('options-back').focus();
}

function showPlay(map: MapData, opts: { test?: boolean } = {}): void {
  testing = !!opts.test;
  currentMap = map;
  levelSelect.hidden = testing;
  openInEditor.hidden = testing;
  backToEditor.hidden = !testing;
  play.load(map);
  show('play');
}

function showEditor(): void {
  testing = false;
  show('editor');
}

function selectedLevel(): MapData {
  const v = levelSelect.value;
  if (v === 'shared' && sharedMap) return sharedMap;
  return BUILTIN_LEVELS[Number(v)] ?? BUILTIN_LEVELS[0];
}

function renderLevelOptions(): void {
  const opts = BUILTIN_LEVELS.map((m, i) => new Option(m.name, String(i)));
  if (sharedMap) opts.unshift(new Option(`🔗 Shared map: ${sharedMap.name}`, 'shared'));
  levelSelect.replaceChildren(...opts);
}

// ───────────────────────── Main menu ─────────────────────────

$('menu-start').addEventListener('click', () => showPlay(selectedLevel()));
$('menu-options').addEventListener('click', () => show('options'));
$('menu-editor').addEventListener('click', showEditor);

// Arrow keys move between menu buttons
for (const screen of [screens.menu, screens.options]) {
  screen.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...screen.querySelectorAll<HTMLElement>('.menu-btn, .option input')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
    e.preventDefault();
  });
}

// ───────────────────────── Options ─────────────────────────

const optionInputs: Record<keyof Options, HTMLInputElement> = {
  showTrail: $<HTMLInputElement>('opt-trail'),
  showTimer: $<HTMLInputElement>('opt-timer'),
  showDebug: $<HTMLInputElement>('opt-debug'),
};

function syncOptions(): void {
  for (const [k, input] of Object.entries(optionInputs) as [keyof Options, HTMLInputElement][]) {
    input.checked = options[k];
  }
  debugPanel.hidden = !options.showDebug;
}

for (const [k, input] of Object.entries(optionInputs) as [keyof Options, HTMLInputElement][]) {
  input.addEventListener('change', () => setOption(k, input.checked));
}
onOptionsChange(syncOptions);
syncOptions();

$('options-back').addEventListener('click', () => show('menu'));
$('options-reset').addEventListener('click', resetOptions);
screens.options.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') show('menu');
});

// ───────────────────────── Play / editor navigation ─────────────────────────

levelSelect.addEventListener('change', () => {
  showPlay(selectedLevel());
  levelSelect.blur(); // a lingering dropdown focus could trigger a blur fail on click
});
$('btn-editor-play').addEventListener('click', () => showPlay(selectedLevel()));
$('btn-editor-menu').addEventListener('click', () => show('menu'));
backToEditor.addEventListener('click', showEditor);
$('btn-play-menu').addEventListener('click', () => (testing ? showEditor() : show('menu')));

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
const editorPanels = [floatingPanel($('tools-panel'), 'tools'), floatingPanel($('inspector-panel'), 'inspector')];
const panelsBtn = $<HTMLButtonElement>('btn-panels');
const togglePanels = () => {
  const hidden = screens.editor.classList.toggle('panels-hidden');
  panelsBtn.setAttribute('aria-pressed', String(hidden));
  panelsBtn.textContent = hidden ? 'Show panels' : 'Hide panels';
};
panelsBtn.addEventListener('click', togglePanels);

// No browser right-click menu anywhere in the app (the editor canvas opens its own). Text fields
// keep theirs so copy / paste by mouse still works.
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  const editable = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
  if (!editable) e.preventDefault();
});

window.addEventListener('keydown', (e) => {
  if ((current !== 'play' && current !== 'editor') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  // Physical keys, so these also work with a non-Latin IME
  if (e.code === 'KeyF') toggleFullscreen();
  else if (current === 'editor' && e.code === 'KeyH') togglePanels();
});
openInEditor.addEventListener('click', () => {
  editor.loadMap(currentMap);
  showEditor();
});

editor.onTest = (map) => showPlay(map, { test: true });
play.onClear = (map) => {
  if (testing) editor.markVerified(map);
};
play.onExit = () => (testing ? showEditor() : show('menu'));

// ───────────────────────── Accounts ─────────────────────────

const account = new Account();
// Total time the game is open, saved to the player's profile
const playTime = new PlayTimeTracker(account);
account.beforeSignOut = () => playTime.flush();
new AuthUI(account, (screen) => show(screen));
for (const s of [screens.auth, screens.verify]) {
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show('menu');
  });
}

// ───────────────────────── Boot ─────────────────────────

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
  const shared = sharedMapTask();
  const accountTask: PreloadTask = { label: 'Account', run: () => account.init() };
  const tasks = [...FONT_TASKS, accountTask, ...(shared ? [shared] : [])];

  await runPreload(tasks, (done, total, label) => {
    bar.style.width = `${Math.round((done / total) * 100)}%`;
    text.textContent = done === total ? 'Ready' : label;
  });

  renderLevelOptions();
  screens.preload.classList.add('fade-out');
  await new Promise((r) => setTimeout(r, 300));
  screens.preload.classList.remove('fade-out');

  // A share link goes straight to that map; otherwise land on the main menu
  if (sharedMap) showPlay(sharedMap);
  else show('menu');

  // Result of an email verification link, if the player just came back from one
  if (account.notice) showToast(account.notice.text, account.notice.kind);
}

window.addEventListener('hashchange', async () => {
  const task = sharedMapTask();
  if (!task) return;
  await task.run();
  renderLevelOptions();
  if (sharedMap) showPlay(sharedMap);
});

void boot();
