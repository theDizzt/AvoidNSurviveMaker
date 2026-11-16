import './style.css';
import { BUILTIN_LEVELS } from '../core/levels';
import { decodeMap } from '../core/share';
import type { MapData } from '../core/types';
import { Editor } from './editor';
import { PlayController } from './play';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다`);
  return el as T;
};

const playView = $('play-view');
const editorView = $('editor-view');
const navPlay = $<HTMLButtonElement>('nav-play');
const navEdit = $<HTMLButtonElement>('nav-edit');
const levelSelect = $<HTMLSelectElement>('level-select');
const backToEditor = $<HTMLButtonElement>('btn-back-editor');
const openInEditor = $<HTMLButtonElement>('btn-play-edit');

const play = new PlayController({
  canvas: $<HTMLCanvasElement>('play-canvas'),
  status: $('play-status'),
  debug: $('debug-stats'),
});

const editor = new Editor({
  canvas: $<HTMLCanvasElement>('editor-canvas'),
  hint: $('editor-hint'),
  tools: [...editorView.querySelectorAll<HTMLButtonElement>('[data-tool]')],
  snap: $<HTMLInputElement>('opt-snap'),
  preview: $<HTMLInputElement>('opt-preview'),
  undo: $<HTMLButtonElement>('btn-undo'),
  redo: $<HTMLButtonElement>('btn-redo'),
  name: $<HTMLInputElement>('map-name'),
  author: $<HTMLInputElement>('map-author'),
  width: $<HTMLInputElement>('map-width'),
  height: $<HTMLInputElement>('map-height'),
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

let sharedMap: MapData | null = null;
let currentMap: MapData = BUILTIN_LEVELS[0];
let testing = false;

function renderLevelOptions(): void {
  const opts = BUILTIN_LEVELS.map((m, i) => new Option(m.name, String(i)));
  if (sharedMap) opts.unshift(new Option(`🔗 공유된 맵: ${sharedMap.name}`, 'shared'));
  levelSelect.replaceChildren(...opts);
}

function showPlay(map: MapData, opts: { test?: boolean } = {}): void {
  testing = !!opts.test;
  currentMap = map;
  editor.hide();
  editorView.hidden = true;
  playView.hidden = false;
  navPlay.setAttribute('aria-pressed', 'true');
  navEdit.setAttribute('aria-pressed', 'false');
  levelSelect.hidden = testing;
  openInEditor.hidden = testing;
  backToEditor.hidden = !testing;
  play.load(map);
  play.show();
}

function showEditor(): void {
  testing = false;
  play.hide();
  playView.hidden = true;
  editorView.hidden = false;
  navPlay.setAttribute('aria-pressed', 'false');
  navEdit.setAttribute('aria-pressed', 'true');
  editor.show();
}

function selectedLevel(): MapData {
  const v = levelSelect.value;
  if (v === 'shared' && sharedMap) return sharedMap;
  return BUILTIN_LEVELS[Number(v)] ?? BUILTIN_LEVELS[0];
}

levelSelect.addEventListener('change', () => {
  showPlay(selectedLevel());
  levelSelect.blur(); // 드롭다운 포커스가 남아 있으면 클릭 시 blur 실패가 생길 수 있음
});
navPlay.addEventListener('click', () => showPlay(selectedLevel()));
navEdit.addEventListener('click', showEditor);
backToEditor.addEventListener('click', showEditor);
openInEditor.addEventListener('click', () => {
  editor.loadMap(currentMap);
  showEditor();
});

editor.onTest = (map) => showPlay(map, { test: true });
play.onClear = (map) => {
  if (testing) editor.markVerified(map);
};

async function boot(): Promise<void> {
  const m = /^#m=(.+)$/.exec(location.hash);
  if (m) {
    try {
      sharedMap = await decodeMap(m[1]);
    } catch (err) {
      alert(`공유 링크를 열 수 없어요: ${(err as Error).message}`);
    }
  }
  renderLevelOptions();
  showPlay(sharedMap ?? BUILTIN_LEVELS[0]);
}

window.addEventListener('hashchange', () => void boot());
void boot();
