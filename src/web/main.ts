import './style.css';
import { BUILTIN_LEVELS } from '../core/levels';
import { decodeMap } from '../core/share';
import type { MapData } from '../core/types';
import { Editor } from './editor';
import { onOptionsChange, options, resetOptions, setOption, type Options } from './options';
import { PlayController } from './play';
import { FONT_TASKS, runPreload, type PreloadTask } from './preload';
import { LiquidBackground } from './liquid';
import { Account } from './auth/account';
import { AuthUI, showToast } from './auth/auth-ui';
import { PlayTimeTracker } from './auth/playtime';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

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
const topbar = $('topbar');
const navPlay = $<HTMLButtonElement>('nav-play');
const navEdit = $<HTMLButtonElement>('nav-edit');
const levelSelect = $<HTMLSelectElement>('level-select');
const backToEditor = $<HTMLButtonElement>('btn-back-editor');
const openInEditor = $<HTMLButtonElement>('btn-play-edit');
const debugPanel = $('debug-panel');

const play = new PlayController({
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
  undo: $<HTMLButtonElement>('btn-undo'),
  redo: $<HTMLButtonElement>('btn-redo'),
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
  topbar.hidden = !inGame;
  // The liquid animation only runs on menu screens, so gameplay keeps the whole frame budget
  document.body.classList.toggle('in-game', inGame);
  liquid.setActive(!inGame);
  navPlay.setAttribute('aria-pressed', String(next === 'play'));
  navEdit.setAttribute('aria-pressed', String(next === 'editor'));
  current = next;
  if (next === 'play') play.show();
  if (next === 'editor') editor.show();
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
navPlay.addEventListener('click', () => showPlay(selectedLevel()));
navEdit.addEventListener('click', showEditor);
$('nav-menu').addEventListener('click', () => show('menu'));
$('nav-menu-btn').addEventListener('click', () => show('menu'));
backToEditor.addEventListener('click', showEditor);
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
