import { pointInRect } from '../core/geometry';
import { compileMover, moverPos } from '../core/mover';
import { encodeMap } from '../core/share';
import type { MapData, Mover, Point, Rect } from '../core/types';
import { createEmptyMap, LIMITS, mapWarnings, validateMap } from '../core/validate';
import { beginFrame, clientToMap, COLORS, drawMap, fitCanvas, unitsPerPx } from './render';

type Tool = 'select' | 'wall' | 'mover' | 'start' | 'goal';
type Selection = { kind: 'wall'; i: number } | { kind: 'mover'; i: number } | { kind: 'start' } | { kind: 'goal' } | null;
type Drag =
  | { type: 'create'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'move'; px: number; py: number; before: string; moved: boolean; orig: Rect | Point[] }
  | { type: 'handle'; j: number; before: string; moved: boolean };

const STORAGE_KEY = 'avoid-n-survive:editor';
const GRID = 10;
const HISTORY_LIMIT = 200;

const TOOL_HINTS: Record<Tool, string> = {
  select: '클릭해서 선택, 드래그로 이동. 선택한 장애물의 경로 지점(동그라미)도 드래그 가능. Delete로 삭제',
  wall: '드래그해서 벽을 그리세요',
  mover: '드래그해서 장애물 크기를 정한 뒤, 클릭으로 이동 경로 지점을 추가하세요. Enter로 완료',
  start: '드래그해서 START 영역을 지정하세요',
  goal: '드래그해서 GOAL 영역을 지정하세요',
};

export interface EditorElements {
  canvas: HTMLCanvasElement;
  hint: HTMLElement;
  tools: HTMLButtonElement[];
  snap: HTMLInputElement;
  preview: HTMLInputElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  name: HTMLInputElement;
  author: HTMLInputElement;
  width: HTMLInputElement;
  height: HTMLInputElement;
  props: HTMLElement;
  messages: HTMLElement;
  verify: HTMLElement;
  test: HTMLButtonElement;
  share: HTMLButtonElement;
  shareUrl: HTMLInputElement;
  exportBtn: HTMLButtonElement;
  importBtn: HTMLButtonElement;
  importFile: HTMLInputElement;
  newBtn: HTMLButtonElement;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class Editor {
  onTest: (map: MapData) => void = () => {};

  private map: MapData;
  private verifiedJson: string | null = null;
  private history: string[] = [];
  private future: string[] = [];
  private tool: Tool = 'select';
  private sel: Selection = null;
  private drag: Drag | null = null;
  private pendingMover: number | null = null;
  private visible = false;
  private valid = true;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly previewStart = performance.now();

  constructor(private readonly el: EditorElements) {
    this.ctx = el.canvas.getContext('2d')!;
    this.map = createEmptyMap();
    this.restore();

    el.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    el.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    el.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => fitCanvas(el.canvas, this.map)).observe(el.canvas.parentElement!);

    for (const b of el.tools) b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool));
    el.undo.addEventListener('click', () => this.undo());
    el.redo.addEventListener('click', () => this.redo());

    const textField = (input: HTMLInputElement, key: 'name' | 'author') =>
      input.addEventListener('change', () => this.edit(() => (this.map[key] = input.value.slice(0, LIMITS.maxText))));
    textField(el.name, 'name');
    textField(el.author, 'author');
    const sizeField = (input: HTMLInputElement, key: 'width' | 'height') =>
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value));
        if (!Number.isFinite(v)) return this.syncInputs();
        this.edit(() => (this.map[key] = Math.min(LIMITS.maxSize, Math.max(LIMITS.minSize, v))));
        fitCanvas(el.canvas, this.map);
      });
    sizeField(el.width, 'width');
    sizeField(el.height, 'height');

    el.test.addEventListener('click', () => this.onTest(clone(this.map)));
    el.share.addEventListener('click', () => void this.share());
    el.exportBtn.addEventListener('click', () => this.exportJson());
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => void this.importJson());
    el.newBtn.addEventListener('click', () => {
      if (!confirm('현재 맵을 지우고 새로 만들까요? (되돌리기로 복구할 수 있어요)')) return;
      this.edit(() => (this.map = createEmptyMap()));
      this.sel = null;
      fitCanvas(el.canvas, this.map);
    });

    this.setTool('select');
    this.changed();

    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  show(): void {
    this.visible = true;
    fitCanvas(this.el.canvas, this.map);
  }

  hide(): void {
    this.visible = false;
    this.finishMover();
  }

  /** 플레이 화면의 맵을 에디터로 가져오기 (리믹스). 되돌리기로 이전 작업 복구 가능 */
  loadMap(map: MapData): void {
    this.edit(() => (this.map = clone(map)));
    this.sel = null;
    fitCanvas(this.el.canvas, this.map);
  }

  /** 테스트 플레이에서 클리어한 맵이 현재 편집 중인 맵과 같으면 공유 가능 상태로 */
  markVerified(map: MapData): void {
    const json = JSON.stringify(map);
    if (json === JSON.stringify(this.map)) {
      this.verifiedJson = json;
      this.changed();
    }
  }

  // ───────────────────────── 상태 관리 ─────────────────────────

  private snapshot(json = JSON.stringify(this.map)): void {
    this.history.push(json);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
  }

  private edit(fn: () => void): void {
    this.snapshot();
    fn();
    this.changed();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (prev === undefined) return;
    this.future.push(JSON.stringify(this.map));
    this.map = JSON.parse(prev) as MapData;
    this.afterHistoryJump();
  }

  private redo(): void {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(JSON.stringify(this.map));
    this.map = JSON.parse(next) as MapData;
    this.afterHistoryJump();
  }

  private afterHistoryJump(): void {
    this.pendingMover = null;
    if (this.sel && (this.sel.kind === 'wall' || this.sel.kind === 'mover')) {
      const list = this.sel.kind === 'wall' ? this.map.walls : this.map.movers;
      if (this.sel.i >= list.length) this.sel = null;
    }
    fitCanvas(this.el.canvas, this.map);
    this.changed();
  }

  /** 맵이 바뀐 뒤: 저장, 검증, 패널 갱신 */
  private changed(): void {
    this.save();
    this.syncInputs();
    this.renderProps();

    const msgs: { text: string; error: boolean }[] = [];
    try {
      validateMap(this.map);
      this.valid = true;
      for (const w of mapWarnings(this.map)) msgs.push({ text: w, error: false });
    } catch (err) {
      this.valid = false;
      msgs.push({ text: (err as Error).message, error: true });
    }
    this.el.messages.replaceChildren(
      ...msgs.map((m) => {
        const li = document.createElement('li');
        li.textContent = m.text;
        li.className = m.error ? 'error' : 'warn';
        return li;
      }),
    );

    const verified = this.verifiedJson === JSON.stringify(this.map);
    this.el.share.disabled = !verified || !this.valid;
    this.el.verify.textContent = verified
      ? '✅ 클리어 확인됨 — 공유할 수 있어요'
      : '공유하려면 먼저 테스트 플레이로 직접 클리어해야 해요';
    this.el.verify.className = verified ? 'verify ok' : 'verify';
    if (!verified) this.el.shareUrl.value = '';
    this.el.undo.disabled = this.history.length === 0;
    this.el.redo.disabled = this.future.length === 0;
    this.updateHint();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ map: this.map, verifiedJson: this.verifiedJson }));
    } catch {
      /* 저장소를 못 쓰는 환경이면 무시 */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { map: unknown; verifiedJson: string | null };
      this.map = validateMap(data.map);
      this.verifiedJson = typeof data.verifiedJson === 'string' ? data.verifiedJson : null;
    } catch {
      this.map = createEmptyMap();
    }
  }

  private syncInputs(): void {
    const set = (input: HTMLInputElement, v: string) => {
      if (document.activeElement !== input) input.value = v;
    };
    set(this.el.name, this.map.name);
    set(this.el.author, this.map.author);
    set(this.el.width, String(this.map.width));
    set(this.el.height, String(this.map.height));
  }

  // ───────────────────────── 도구 & 입력 ─────────────────────────

  private setTool(tool: Tool): void {
    this.finishMover();
    this.tool = tool;
    for (const b of this.el.tools) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    this.el.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    this.updateHint();
  }

  private finishMover(): void {
    if (this.pendingMover === null) return;
    this.pendingMover = null;
    this.updateHint();
  }

  private updateHint(): void {
    this.el.hint.textContent =
      this.pendingMover !== null
        ? `경로 지점 추가 중 (현재 ${this.map.movers[this.pendingMover]?.path.length ?? 0}개) — 클릭으로 추가, Enter/Esc로 완료`
        : TOOL_HINTS[this.tool];
  }

  private snapv(v: number): number {
    return this.el.snap.checked ? Math.round(v / GRID) * GRID : Math.round(v);
  }

  private moverRect(m: Mover): Rect {
    const p = moverPos(compileMover(m), 0, { x: 0, y: 0 });
    return { x: p.x, y: p.y, w: m.w, h: m.h };
  }

  private hitTest(p: Point): Selection {
    for (let i = this.map.movers.length - 1; i >= 0; i--) {
      if (pointInRect(p.x, p.y, this.moverRect(this.map.movers[i]))) return { kind: 'mover', i };
    }
    for (let i = this.map.walls.length - 1; i >= 0; i--) {
      if (pointInRect(p.x, p.y, this.map.walls[i])) return { kind: 'wall', i };
    }
    if (pointInRect(p.x, p.y, this.map.goal)) return { kind: 'goal' };
    if (pointInRect(p.x, p.y, this.map.start)) return { kind: 'start' };
    return null;
  }

  private hitHandle(p: Point): number {
    if (this.sel?.kind !== 'mover') return -1;
    const r = 8 * unitsPerPx(this.el.canvas, this.map);
    const path = this.map.movers[this.sel.i].path;
    for (let j = path.length - 1; j >= 0; j--) {
      if (Math.hypot(path[j].x - p.x, path[j].y - p.y) <= r) return j;
    }
    return -1;
  }

  private selectedRect(): Rect | null {
    const s = this.sel;
    if (!s) return null;
    if (s.kind === 'start') return this.map.start;
    if (s.kind === 'goal') return this.map.goal;
    if (s.kind === 'wall') return this.map.walls[s.i] ?? null;
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.el.canvas.setPointerCapture(e.pointerId);
    const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);

    if (this.tool === 'select') {
      const j = this.hitHandle(p);
      if (j >= 0) {
        this.drag = { type: 'handle', j, before: JSON.stringify(this.map), moved: false };
        return;
      }
      this.sel = this.hitTest(p);
      this.renderProps();
      if (this.sel) {
        const orig = this.sel.kind === 'mover' ? clone(this.map.movers[this.sel.i].path) : clone(this.selectedRect()!);
        this.drag = { type: 'move', px: p.x, py: p.y, before: JSON.stringify(this.map), moved: false, orig };
      }
      return;
    }

    if (this.tool === 'mover' && this.pendingMover !== null) {
      const idx = this.pendingMover;
      this.edit(() => this.map.movers[idx].path.push({ x: this.snapv(p.x), y: this.snapv(p.y) }));
      return;
    }

    const x = this.snapv(p.x);
    const y = this.snapv(p.y);
    this.drag = { type: 'create', x0: x, y0: y, x1: x, y1: y };
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);

    if (d.type === 'create') {
      d.x1 = this.snapv(p.x);
      d.y1 = this.snapv(p.y);
      return;
    }
    if (!d.moved) {
      d.moved = true;
      this.snapshot(d.before);
    }
    if (d.type === 'handle' && this.sel?.kind === 'mover') {
      this.map.movers[this.sel.i].path[d.j] = { x: this.snapv(p.x), y: this.snapv(p.y) };
      return;
    }
    if (d.type === 'move' && this.sel) {
      const dx = p.x - d.px;
      const dy = p.y - d.py;
      if (Array.isArray(d.orig)) {
        const o = d.orig;
        const ddx = this.snapv(o[0].x + dx) - o[0].x;
        const ddy = this.snapv(o[0].y + dy) - o[0].y;
        if (this.sel.kind === 'mover') this.map.movers[this.sel.i].path = o.map((q) => ({ x: q.x + ddx, y: q.y + ddy }));
      } else {
        const r = this.selectedRect();
        if (r) {
          r.x = this.snapv(d.orig.x + dx);
          r.y = this.snapv(d.orig.y + dy);
        }
      }
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type !== 'create') {
      if (d.moved) this.changed();
      return;
    }

    const r: Rect = {
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      w: Math.abs(d.x1 - d.x0),
      h: Math.abs(d.y1 - d.y0),
    };

    if (this.tool === 'wall') {
      if (r.w < 2 || r.h < 2) return;
      this.edit(() => this.map.walls.push(r));
      this.sel = { kind: 'wall', i: this.map.walls.length - 1 };
    } else if (this.tool === 'start' || this.tool === 'goal') {
      if (r.w < 10 || r.h < 10) return;
      const key = this.tool;
      this.edit(() => (this.map[key] = r));
      this.sel = { kind: key };
    } else if (this.tool === 'mover') {
      // 클릭만 했으면 30x30 기본 크기
      const w = r.w >= 6 ? r.w : 30;
      const h = r.h >= 6 ? r.h : 30;
      const cx = r.w >= 6 ? r.x + r.w / 2 : d.x0;
      const cy = r.h >= 6 ? r.y + r.h / 2 : d.y0;
      this.edit(() =>
        this.map.movers.push({ w, h, path: [{ x: cx, y: cy }], speed: 200, mode: 'pingpong', offset: 0 }),
      );
      this.sel = { kind: 'mover', i: this.map.movers.length - 1 };
      this.pendingMover = this.sel.i;
    }
    this.renderProps();
    this.updateHint();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      this.finishMover();
      if (e.key === 'Escape') {
        this.sel = null;
        this.renderProps();
      }
    } else if (!mod && e.key >= '1' && e.key <= '5') {
      this.setTool((['select', 'wall', 'mover', 'start', 'goal'] as const)[Number(e.key) - 1]);
    }
  }

  private deleteSelected(): void {
    const s = this.sel;
    if (!s || (s.kind !== 'wall' && s.kind !== 'mover')) return;
    this.edit(() => (s.kind === 'wall' ? this.map.walls : this.map.movers).splice(s.i, 1));
    this.sel = null;
    this.pendingMover = null;
    this.renderProps();
  }

  // ───────────────────────── 속성 패널 ─────────────────────────

  private numField(label: string, value: number, apply: (v: number) => void, step = 1): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) {
        input.value = String(value);
        return;
      }
      this.edit(() => apply(v));
    });
    wrap.append(span, input);
    return wrap;
  }

  private button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  private rectFields(r: Rect): HTMLElement[] {
    return [
      this.numField('X', r.x, (v) => (r.x = Math.round(v))),
      this.numField('Y', r.y, (v) => (r.y = Math.round(v))),
      this.numField('너비', r.w, (v) => (r.w = Math.max(1, Math.round(v)))),
      this.numField('높이', r.h, (v) => (r.h = Math.max(1, Math.round(v)))),
    ];
  }

  private renderProps(): void {
    const box = this.el.props;
    const s = this.sel;
    if (!s) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = '선택 도구(1)로 오브젝트를 클릭하세요.';
      box.replaceChildren(p);
      return;
    }
    const title = document.createElement('h4');
    const grid = document.createElement('div');
    grid.className = 'fields';
    const extra: HTMLElement[] = [];

    if (s.kind === 'start' || s.kind === 'goal') {
      title.textContent = s.kind === 'start' ? 'START 영역' : 'GOAL 영역';
      grid.append(...this.rectFields(this.map[s.kind]));
    } else if (s.kind === 'wall') {
      const w = this.map.walls[s.i];
      if (!w) return box.replaceChildren();
      title.textContent = `벽 #${s.i + 1}`;
      grid.append(...this.rectFields(w));
      extra.push(this.button('삭제', () => this.deleteSelected(), 'danger'));
    } else {
      const m = this.map.movers[s.i];
      if (!m) return box.replaceChildren();
      title.textContent = `장애물 #${s.i + 1}`;
      grid.append(
        this.numField('너비', m.w, (v) => (m.w = Math.max(1, Math.round(v)))),
        this.numField('높이', m.h, (v) => (m.h = Math.max(1, Math.round(v)))),
        this.numField('속도 (px/초)', m.speed, (v) => (m.speed = Math.min(LIMITS.maxSpeed, Math.max(0, v))), 10),
        this.numField('시작 위상 (ms)', m.offset, (v) => (m.offset = Math.min(LIMITS.maxOffset, Math.max(0, Math.round(v)))), 50),
      );
      const modeWrap = document.createElement('label');
      modeWrap.className = 'field';
      const modeLabel = document.createElement('span');
      modeLabel.textContent = '이동 방식';
      const sel = document.createElement('select');
      for (const [v, t] of [['pingpong', '왕복'], ['loop', '순환']] as const) {
        const o = new Option(t, v, false, m.mode === v);
        sel.append(o);
      }
      sel.addEventListener('change', () => this.edit(() => (m.mode = sel.value as Mover['mode'])));
      modeWrap.append(modeLabel, sel);
      grid.append(modeWrap);

      const info = document.createElement('p');
      info.className = 'muted';
      info.textContent = `경로 지점 ${m.path.length}개${m.path.length < 2 ? ' (2개 이상이어야 움직여요)' : ''}`;
      const idx = s.i;
      extra.push(
        info,
        this.button('경로 지점 추가', () => {
          this.setTool('mover');
          this.pendingMover = idx;
          this.updateHint();
        }),
        this.button('마지막 지점 삭제', () => {
          if (m.path.length > 1) this.edit(() => m.path.pop());
        }),
        this.button('삭제', () => this.deleteSelected(), 'danger'),
      );
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(...extra);
    box.replaceChildren(title, grid, actions);
  }

  // ───────────────────────── 공유 / 파일 ─────────────────────────

  private async share(): Promise<void> {
    if (this.el.share.disabled) return;
    const code = await encodeMap(validateMap(this.map));
    const url = `${location.origin}${location.pathname}#m=${code}`;
    this.el.shareUrl.value = url;
    this.el.shareUrl.select();
    try {
      await navigator.clipboard.writeText(url);
      this.el.verify.textContent = `🔗 링크를 클립보드에 복사했어요 (${url.length}자)`;
    } catch {
      this.el.verify.textContent = `링크를 만들었어요. 직접 복사해 주세요 (${url.length}자)`;
    }
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.map, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.map.name.replace(/[\\/:*?"<>|]/g, '_') || 'map'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importJson(): Promise<void> {
    const file = this.el.importFile.files?.[0];
    this.el.importFile.value = '';
    if (!file) return;
    try {
      const map = validateMap(JSON.parse(await file.text()));
      this.loadMap(map);
    } catch (err) {
      alert(`맵을 불러오지 못했어요: ${(err as Error).message}`);
    }
  }

  // ───────────────────────── 그리기 ─────────────────────────

  private draw(): void {
    if (!this.visible) return;
    const { ctx, map } = this;
    const u = unitsPerPx(this.el.canvas, map);
    const movers = map.movers.map(compileMover);
    const preview = this.el.preview.checked;
    beginFrame(ctx, map);
    drawMap(ctx, map, movers, preview ? performance.now() - this.previewStart : 0);

    // 미리보기 중에는 편집 기준 위치(시작 위치)를 점선으로
    ctx.lineWidth = 1.5 * u;
    if (preview) {
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.strokeStyle = COLORS.mover;
      for (const m of map.movers) {
        const r = this.moverRect(m);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      ctx.setLineDash([]);
    }

    // 장애물 경로
    map.movers.forEach((m, i) => {
      const selected = this.sel?.kind === 'mover' && this.sel.i === i;
      if (m.path.length > 1) {
        ctx.strokeStyle = selected ? COLORS.mover : COLORS.path;
        ctx.setLineDash(selected ? [] : [6 * u, 4 * u]);
        ctx.beginPath();
        ctx.moveTo(m.path[0].x, m.path[0].y);
        for (const q of m.path.slice(1)) ctx.lineTo(q.x, q.y);
        if (m.mode === 'loop' && m.path.length > 2) ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (selected) {
        m.path.forEach((q, j) => {
          ctx.fillStyle = j === 0 ? '#fff' : COLORS.mover;
          ctx.strokeStyle = '#000';
          ctx.beginPath();
          ctx.arc(q.x, q.y, 5 * u, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      }
    });

    // 선택 표시
    const selMover = this.sel?.kind === 'mover' ? map.movers[this.sel.i] : undefined;
    const sr = selMover ? this.moverRect(selMover) : this.selectedRect();
    if (sr) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.strokeRect(sr.x - 3 * u, sr.y - 3 * u, sr.w + 6 * u, sr.h + 6 * u);
      ctx.setLineDash([]);
    }

    // 그리는 중인 사각형
    const d = this.drag;
    if (d?.type === 'create') {
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 * u;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = `${12 * u}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${w}×${h}`, x, y - 3 * u);
    }
  }
}
