import { pointInPoly, pointInRect } from '../core/geometry';
import { CompiledMotion } from '../core/motion';
import { compileObject, type CompiledObject, type Transform } from '../core/object';
import { polyOutline, shapeBounds, shapeCenter, translateShape } from '../core/shape';
import { encodeMap } from '../core/share';
import type {
  Easing, MapData, MapObject, Motion, MotionType, Point, PolyPoint, Rect, Repeat, Role, Rotation, Shape,
} from '../core/types';
import { createEmptyMap, DEFAULT_MOTION, defaultRotation, LIMITS, mapWarnings, validateMap } from '../core/validate';
import { beginFrame, clientToMap, COLORS, drawMap, FONT_MAIN, fitCanvas, traceObject, unitsPerPx } from './render';
import { renderThemePanel } from './theme-panel';

// ───────────────────────── Tools ─────────────────────────

type ShapeKind = 'rect' | 'ellipse' | 'poly' | 'free';
type Behavior = 'static' | 'moving' | 'rotating';
interface ObjectTool {
  kind: 'object';
  role: Role;
  behavior: Behavior;
  shape: ShapeKind;
}
type Tool = { kind: 'select' } | { kind: 'zone'; zone: 'start' | 'goal' } | ObjectTool;

const SHAPES: [ShapeKind, string][] = [
  ['rect', 'Rectangle'],
  ['ellipse', 'Circle'],
  ['poly', 'Polygon'],
  ['free', 'Freeform'],
];

/** Palette layout; numbers match the editor feature list */
const GROUPS: ({ title: string; role: Role; behavior: Behavior; first: number } | { title: string; zones: true })[] = [
  { title: 'Paths', role: 'path', behavior: 'static', first: 1 },
  { title: 'Walls', role: 'wall', behavior: 'static', first: 5 },
  { title: 'Zones', zones: true },
  { title: 'Moving paths', role: 'path', behavior: 'moving', first: 11 },
  { title: 'Rotating paths', role: 'path', behavior: 'rotating', first: 15 },
  { title: 'Moving walls', role: 'wall', behavior: 'moving', first: 19 },
  { title: 'Rotating walls', role: 'wall', behavior: 'rotating', first: 23 },
];

const ICONS: Record<ShapeKind, string> = {
  rect: '<rect x="3" y="6" width="18" height="12" rx="1"/>',
  ellipse: '<circle cx="12" cy="12" r="8"/>',
  poly: '<polygon points="12,3 21,10 17.5,20 6.5,20 3,10"/>',
  free: '<path d="M4 18 C3 9 9 3 13 7 S 21 8 20 15 S 9 21 4 18 Z"/>',
};

function toolLabel(t: ObjectTool): string {
  const shape = SHAPES.find(([k]) => k === t.shape)![1];
  const beh = t.behavior === 'moving' ? 'Moving ' : t.behavior === 'rotating' ? 'Rotating ' : '';
  return `${beh}${shape} ${t.role === 'path' ? 'Path' : 'Wall'}`;
}

function describeObject(o: MapObject): string {
  const shape =
    o.shape.type === 'rect' ? 'Rectangle'
      : o.shape.type === 'ellipse' ? 'Circle'
        : o.shape.points.some((p) => p.smooth) ? 'Freeform' : 'Polygon';
  const beh = o.rotation ? 'Rotating ' : o.motion ? 'Moving ' : '';
  return `${beh}${shape} ${o.role === 'path' ? 'Path' : 'Wall'}`;
}

// ───────────────────────── Editor state types ─────────────────────────

type Selection = { kind: 'object'; i: number } | { kind: 'start' } | { kind: 'goal' } | null;
type Handle =
  | { kind: 'corner'; j: number }
  | { kind: 'vertex'; j: number }
  | { kind: 'marker'; j: number }
  | { kind: 'pivot' };
type Drag =
  | { type: 'box'; x0: number; y0: number; x1: number; y1: number; square: boolean }
  | { type: 'move'; p0: Point; before: string; moved: boolean; orig: MapObject | Rect }
  | { type: 'handle'; h: Handle; before: string; moved: boolean; orig: MapObject | Rect };

const STORAGE_KEY = 'avoid-n-survive:editor';
/** Map sizes offered in the editor, all 16:9 */
const MAP_SIZES: [number, number][] = [[640, 360], [960, 540], [1280, 720], [1600, 900], [1920, 1080]];
const GRID = 10;
const HISTORY_LIMIT = 200;
const HANDLE_PX = 7;
const IDENTITY: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

const REPEAT_OPTIONS: [Repeat, string][] = [['loop', 'Loop'], ['pingpong', 'Ping-pong'], ['once', 'Once']];
const EASING_OPTIONS: [Easing, string][] = [['none', 'None'], ['in', 'Ease in'], ['out', 'Ease out'], ['inOut', 'Ease in & out']];
const ROUTE_OPTIONS: [MotionType, string][] = [['linear', 'Straight'], ['curve', 'Curve'], ['circle', 'Circle (orbit)']];
const DIRECTION_OPTIONS: [string, string][] = [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']];

export interface EditorElements {
  canvas: HTMLCanvasElement;
  hint: HTMLElement;
  palette: HTMLElement;
  theme: HTMLElement;
  snap: HTMLInputElement;
  preview: HTMLInputElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  name: HTMLInputElement;
  author: HTMLInputElement;
  size: HTMLSelectElement;
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

function translateObject(o: MapObject, dx: number, dy: number): MapObject {
  const out: MapObject = { ...clone(o), shape: translateShape(o.shape, dx, dy) };
  if (out.motion) out.motion.points = out.motion.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (out.rotation) out.rotation.pivot = { x: out.rotation.pivot.x + dx, y: out.rotation.pivot.y + dy };
  return out;
}

function rectFromCorners(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export class Editor {
  onTest: (map: MapData) => void = () => {};

  private map: MapData;
  private compiledCache: CompiledObject[] | null = null;
  private verifiedJson: string | null = null;
  private history: string[] = [];
  private future: string[] = [];
  private tool: Tool = { kind: 'select' };
  private sel: Selection = null;
  private drag: Drag | null = null;
  /** Polygon / freeform being drawn */
  private draft: { tool: ObjectTool; points: PolyPoint[] } | null = null;
  /** Object whose motion markers are being placed by clicking */
  private markerMode: number | null = null;
  private hover: Point | null = null;
  private visible = false;
  private valid = true;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly previewStart = performance.now();
  private readonly paletteButtons: { btn: HTMLButtonElement; tool: Tool }[] = [];

  constructor(private readonly el: EditorElements) {
    this.ctx = el.canvas.getContext('2d')!;
    this.map = createEmptyMap();
    this.restore();
    this.buildPalette();

    el.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    el.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    el.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    el.canvas.addEventListener('pointerleave', () => (this.hover = null));
    el.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    const refit = () => fitCanvas(el.canvas, this.map);
    new ResizeObserver(refit).observe(el.canvas.parentElement!);
    window.addEventListener('resize', refit);

    el.undo.addEventListener('click', () => this.undo());
    el.redo.addEventListener('click', () => this.redo());

    const textField = (input: HTMLInputElement, key: 'name' | 'author') =>
      input.addEventListener('change', () => this.edit(() => (this.map[key] = input.value.slice(0, LIMITS.maxText))));
    textField(el.name, 'name');
    textField(el.author, 'author');
    el.size.addEventListener('change', () => {
      const [w, h] = el.size.value.split('x').map(Number);
      if (!(w > 0 && h > 0)) return this.syncInputs();
      this.edit(() => {
        this.map.width = w;
        this.map.height = h;
      });
      fitCanvas(el.canvas, this.map);
    });

    el.test.addEventListener('click', () => {
      this.finishModes();
      this.onTest(clone(this.map));
    });
    el.share.addEventListener('click', () => void this.share());
    el.exportBtn.addEventListener('click', () => this.exportJson());
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => void this.importJson());
    el.newBtn.addEventListener('click', () => {
      if (!confirm('Clear the current map and start a new one? (You can restore it with Undo)')) return;
      this.edit(() => (this.map = createEmptyMap()));
      this.sel = null;
      fitCanvas(el.canvas, this.map);
    });

    this.setTool({ kind: 'select' });
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
    this.finishModes();
  }

  /** Bring a map from the play screen into the editor (remix). Previous work can be restored with Undo */
  loadMap(map: MapData): void {
    this.finishModes();
    this.edit(() => (this.map = clone(map)));
    this.sel = null;
    fitCanvas(this.el.canvas, this.map);
  }

  /** If the map cleared in test play matches the one being edited, mark it shareable */
  markVerified(map: MapData): void {
    const json = JSON.stringify(map);
    if (json === JSON.stringify(this.map)) {
      this.verifiedJson = json;
      this.changed();
    }
  }

  private get compiled(): CompiledObject[] {
    this.compiledCache ??= this.map.objects.map(compileObject);
    return this.compiledCache;
  }

  /** Call after any in-place change to map objects */
  private dirty(): void {
    this.compiledCache = null;
  }

  // ───────────────────────── Palette ─────────────────────────

  private buildPalette(): void {
    const box = this.el.palette;
    const addButton = (parent: HTMLElement, tool: Tool, html: string, title: string, cls: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pal-btn ${cls}`;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = html;
      b.addEventListener('click', () => this.setTool(tool));
      parent.append(b);
      this.paletteButtons.push({ btn: b, tool });
    };

    const selectRow = document.createElement('div');
    selectRow.className = 'pal-row';
    addButton(
      selectRow,
      { kind: 'select' },
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3 L19 12 L12 13.5 L9 20 Z"/></svg><span class="pal-text">Select</span>',
      'Select / edit (V)',
      'pal-select',
    );
    box.append(selectRow);

    for (const g of GROUPS) {
      const h = document.createElement('h4');
      h.className = 'pal-title';
      h.textContent = g.title;
      const row = document.createElement('div');
      row.className = 'pal-row';
      if ('zones' in g) {
        addButton(row, { kind: 'zone', zone: 'start' }, '<span class="pal-zone">S</span><span class="pal-num">9</span>', '#9 Start area', 'pal-start');
        addButton(row, { kind: 'zone', zone: 'goal' }, '<span class="pal-zone">G</span><span class="pal-num">10</span>', '#10 Goal area', 'pal-goal');
      } else {
        SHAPES.forEach(([shape], k) => {
          const tool: ObjectTool = { kind: 'object', role: g.role, behavior: g.behavior, shape };
          const num = g.first + k;
          const badge = g.behavior === 'moving' ? '<span class="pal-badge">⇄</span>' : g.behavior === 'rotating' ? '<span class="pal-badge">↻</span>' : '';
          addButton(
            row,
            tool,
            `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[shape]}</svg>${badge}<span class="pal-num">${num}</span>`,
            `#${num} ${toolLabel(tool)}`,
            `pal-${g.role} pal-${g.behavior}`,
          );
        });
      }
      box.append(h, row);
    }
  }

  private setTool(tool: Tool): void {
    this.finishModes();
    this.tool = tool;
    for (const { btn, tool: t } of this.paletteButtons) {
      btn.setAttribute('aria-pressed', String(JSON.stringify(t) === JSON.stringify(tool)));
    }
    this.el.canvas.style.cursor = tool.kind === 'select' ? 'default' : 'crosshair';
    this.updateHint();
  }

  /** Leave polygon drafting / marker placement */
  private finishModes(): void {
    this.draft = null;
    this.markerMode = null;
    this.updateHint();
  }

  // ───────────────────────── State ─────────────────────────

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
    this.finishModes();
    if (this.sel?.kind === 'object' && this.sel.i >= this.map.objects.length) this.sel = null;
    fitCanvas(this.el.canvas, this.map);
    this.changed();
  }

  /** After the map changes: save, validate, refresh panels */
  private changed(): void {
    this.dirty();
    this.save();
    this.syncInputs();
    this.renderProps();
    this.renderTheme();

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
    this.el.verify.textContent = verified ? '✅ Clear verified — ready to share' : 'To share, first clear the map yourself in test play';
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
      /* ignore when storage is unavailable */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { map: unknown; verifiedJson: string | null };
      this.map = validateMap(data.map); // also migrates drafts saved in an older format
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
    // 16:9 sizes; a map made in another ratio keeps its size as a "custom" entry
    const current = `${this.map.width}x${this.map.height}`;
    const sizes = MAP_SIZES.map(([w, h]) => [`${w}x${h}`, `${w} × ${h}${w === 960 ? ' (default)' : ''}`]);
    if (!sizes.some(([v]) => v === current)) sizes.push([current, `${this.map.width} × ${this.map.height} (not 16:9)`]);
    this.el.size.replaceChildren(...sizes.map(([v, t]) => new Option(t, v, false, v === current)));
  }

  private updateHint(): void {
    let text: string;
    if (this.markerMode !== null) {
      const m = this.map.objects[this.markerMode]?.motion;
      text = m?.type === 'circle'
        ? 'Click to set the orbit center. Enter or Esc when done'
        : `Click to place route markers (${m?.points.length ?? 0} placed). Enter or Esc when done`;
    } else if (this.draft) {
      text = this.draft.tool.shape === 'free'
        ? `Click to add curved points, Shift+click for sharp corners (${this.draft.points.length}). Click the first point or press Enter to close · Backspace undoes a point · Esc cancels`
        : `Click to add vertices (${this.draft.points.length}). Click the first point or press Enter to close · Backspace undoes a point · Esc cancels`;
    } else if (this.tool.kind === 'select') {
      text = 'Click to select, drag to move, drag handles to reshape. Polygons: double-click a vertex to toggle curve, double-click an edge to add a vertex, Alt+click a vertex to remove it';
    } else if (this.tool.kind === 'zone') {
      text = `Drag to set the ${this.tool.zone === 'start' ? 'START' : 'GOAL'} area`;
    } else {
      const t = this.tool;
      const how = t.shape === 'poly' || t.shape === 'free' ? 'Click to place points' : t.shape === 'ellipse' ? 'Drag to draw (Shift for a perfect circle)' : 'Drag to draw (Shift for a square)';
      const after = t.behavior === 'moving' ? ', then click to place route markers' : t.behavior === 'rotating' ? '; it spins around its center (drag the purple pivot to move the axis)' : '';
      text = `${toolLabel(t)}: ${how}${after}`;
    }
    this.el.hint.textContent = text;
  }

  // ───────────────────────── Pointer input ─────────────────────────

  private snapv(v: number): number {
    return this.el.snap.checked ? Math.round(v / GRID) * GRID : Math.round(v);
  }

  private snapPoint(p: Point): Point {
    return { x: this.snapv(p.x), y: this.snapv(p.y) };
  }

  private pointer(e: MouseEvent): Point {
    return clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
  }

  private hitTest(p: Point): Selection {
    const objs = this.compiled;
    for (let i = objs.length - 1; i >= 0; i--) {
      if (objs[i].role === 'wall' && pointInPoly(p.x, p.y, objs[i].poly)) return { kind: 'object', i };
    }
    if (pointInRect(p.x, p.y, this.map.goal)) return { kind: 'goal' };
    if (pointInRect(p.x, p.y, this.map.start)) return { kind: 'start' };
    for (let i = objs.length - 1; i >= 0; i--) {
      if (objs[i].role === 'path' && pointInPoly(p.x, p.y, objs[i].poly)) return { kind: 'object', i };
    }
    return null;
  }

  private selectedObject(): MapObject | null {
    return this.sel?.kind === 'object' ? (this.map.objects[this.sel.i] ?? null) : null;
  }

  private selectedZone(): Rect | null {
    if (this.sel?.kind === 'start') return this.map.start;
    if (this.sel?.kind === 'goal') return this.map.goal;
    return null;
  }

  /** Handles for the current selection, in priority order */
  private handles(): { h: Handle; p: Point }[] {
    const out: { h: Handle; p: Point }[] = [];
    const zone = this.selectedZone();
    if (zone) {
      rectCorners(zone).forEach((p, j) => out.push({ h: { kind: 'corner', j }, p }));
      return out;
    }
    const o = this.selectedObject();
    if (!o) return out;
    if (o.rotation) out.push({ h: { kind: 'pivot' }, p: o.rotation.pivot });
    o.motion?.points.forEach((p, j) => out.push({ h: { kind: 'marker', j }, p }));
    if (o.shape.type === 'poly') o.shape.points.forEach((p, j) => out.push({ h: { kind: 'vertex', j }, p }));
    else rectCorners(shapeBounds(o.shape)).forEach((p, j) => out.push({ h: { kind: 'corner', j }, p }));
    return out;
  }

  private hitHandle(p: Point): Handle | null {
    const r = HANDLE_PX * unitsPerPx(this.el.canvas, this.map);
    for (const { h, p: q } of this.handles()) {
      if (Math.hypot(q.x - p.x, q.y - p.y) <= r) return h;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.el.canvas.setPointerCapture(e.pointerId);
    const raw = this.pointer(e);
    const p = this.snapPoint(raw);

    // Placing route markers
    if (this.markerMode !== null) {
      const o = this.map.objects[this.markerMode];
      if (!o) return this.finishModes();
      this.edit(() => {
        o.motion ??= { ...DEFAULT_MOTION, points: [] };
        if (o.motion.type === 'circle') o.motion.points = [p];
        else if (o.motion.points.length < LIMITS.maxMarkers) o.motion.points.push(p);
      });
      if (o.motion?.type === 'circle') this.finishModes();
      return;
    }

    // Drawing a polygon / freeform
    if (this.draft) {
      const pts = this.draft.points;
      const first = pts[0];
      const r = HANDLE_PX * 1.5 * unitsPerPx(this.el.canvas, this.map);
      if (pts.length >= 3 && Math.hypot(first.x - raw.x, first.y - raw.y) <= r) {
        this.closeDraft();
      } else if (pts.length < LIMITS.maxPolyPoints) {
        pts.push(this.draft.tool.shape === 'free' && !e.shiftKey ? { ...p, smooth: true } : p);
        this.updateHint();
      }
      return;
    }

    const tool = this.tool;
    if (tool.kind === 'select') {
      const h = this.hitHandle(raw);
      const o = this.selectedObject();
      if (h && e.altKey && h.kind === 'vertex' && o?.shape.type === 'poly' && o.shape.points.length > 3) {
        const shape = o.shape;
        this.edit(() => shape.points.splice(h.j, 1));
        return;
      }
      if (h) {
        const orig = clone(this.selectedZone() ?? this.selectedObject()!);
        this.drag = { type: 'handle', h, before: JSON.stringify(this.map), moved: false, orig };
        return;
      }
      this.sel = this.hitTest(raw);
      this.renderProps();
      const target = this.selectedZone() ?? this.selectedObject();
      if (target) this.drag = { type: 'move', p0: raw, before: JSON.stringify(this.map), moved: false, orig: clone(target) };
      return;
    }

    if (tool.kind === 'object' && (tool.shape === 'poly' || tool.shape === 'free')) {
      this.draft = { tool, points: [tool.shape === 'free' && !e.shiftKey ? { ...p, smooth: true } : p] };
      this.sel = null;
      this.renderProps();
      this.updateHint();
      return;
    }

    this.drag = { type: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, square: e.shiftKey };
  }

  private onMove(e: PointerEvent): void {
    const raw = this.pointer(e);
    this.hover = raw;
    const d = this.drag;
    if (!d) return;
    const p = this.snapPoint(raw);

    if (d.type === 'box') {
      d.x1 = p.x;
      d.y1 = p.y;
      d.square = e.shiftKey;
      return;
    }
    if (!d.moved) {
      d.moved = true;
      this.snapshot(d.before);
    }

    if (d.type === 'move') {
      const zone = this.selectedZone();
      if (zone && !('shape' in d.orig)) {
        const o = d.orig;
        zone.x = this.snapv(o.x + raw.x - d.p0.x);
        zone.y = this.snapv(o.y + raw.y - d.p0.y);
      } else if (this.sel?.kind === 'object' && 'shape' in d.orig) {
        const b = shapeBounds(d.orig.shape);
        const dx = this.snapv(b.x + raw.x - d.p0.x) - b.x;
        const dy = this.snapv(b.y + raw.y - d.p0.y) - b.y;
        this.map.objects[this.sel.i] = translateObject(d.orig, dx, dy);
      }
      this.dirty();
      return;
    }

    // Handle drag
    const h = d.h;
    const zone = this.selectedZone();
    if (zone && h.kind === 'corner' && !('shape' in d.orig)) {
      const opposite = rectCorners(d.orig)[(h.j + 2) % 4];
      const r = rectFromCorners(opposite, p);
      Object.assign(zone, { ...r, w: Math.max(10, r.w), h: Math.max(10, r.h) });
      this.dirty();
      return;
    }
    const o = this.selectedObject();
    if (!o || !('shape' in d.orig)) return;
    if (h.kind === 'pivot' && o.rotation) o.rotation.pivot = p;
    else if (h.kind === 'marker' && o.motion) o.motion.points[h.j] = p;
    else if (h.kind === 'vertex' && o.shape.type === 'poly') o.shape.points[h.j] = { ...o.shape.points[h.j], x: p.x, y: p.y };
    else if (h.kind === 'corner') {
      const opposite = rectCorners(shapeBounds(d.orig.shape))[(h.j + 2) % 4];
      const r = rectFromCorners(opposite, p);
      r.w = Math.max(2, r.w);
      r.h = Math.max(2, r.h);
      if (o.shape.type === 'rect') o.shape = { type: 'rect', ...r };
      else if (o.shape.type === 'ellipse') o.shape = { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
    }
    this.dirty();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type !== 'box') {
      if (d.moved) this.changed();
      return;
    }

    let r = rectFromCorners({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
    if (d.square) {
      const s = Math.max(r.w, r.h);
      r = { x: d.x1 < d.x0 ? d.x0 - s : d.x0, y: d.y1 < d.y0 ? d.y0 - s : d.y0, w: s, h: s };
    }
    const tool = this.tool;

    if (tool.kind === 'zone') {
      if (r.w < 10 || r.h < 10) return;
      this.edit(() => (this.map[tool.zone] = r));
      this.sel = { kind: tool.zone };
      this.renderProps();
      return;
    }
    if (tool.kind !== 'object') return;

    // A plain click (no drag) drops a default-sized shape
    if (r.w < 4 && r.h < 4) r = { x: d.x0 - 30, y: d.y0 - 30, w: 60, h: 60 };
    if (r.w < 2 || r.h < 2) return;
    const shape: Shape = tool.shape === 'ellipse'
      ? { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 }
      : { type: 'rect', ...r };
    this.addObject(tool, shape);
  }

  private closeDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft || draft.points.length < 3) return this.updateHint();
    this.addObject(draft.tool, { type: 'poly', points: draft.points });
  }

  private addObject(tool: ObjectTool, shape: Shape): void {
    if (this.map.objects.length >= LIMITS.maxObjects) return;
    const o: MapObject = { role: tool.role, shape };
    if (tool.behavior === 'rotating') o.rotation = defaultRotation(o);
    if (tool.behavior === 'moving') o.motion = { ...DEFAULT_MOTION, points: [] };
    this.edit(() => this.map.objects.push(o));
    const i = this.map.objects.length - 1;
    this.sel = { kind: 'object', i };
    if (tool.behavior === 'moving') this.markerMode = i;
    this.renderProps();
    this.updateHint();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.tool.kind !== 'select' || this.draft || this.markerMode !== null) return;
    const o = this.selectedObject();
    if (!o || o.shape.type !== 'poly') return;
    const shape = o.shape;
    const raw = this.pointer(e);
    const h = this.hitHandle(raw);
    if (h?.kind === 'vertex') {
      this.edit(() => {
        const v = shape.points[h.j];
        shape.points[h.j] = v.smooth ? { x: v.x, y: v.y } : { ...v, smooth: true };
      });
      return;
    }
    // Insert a vertex on the nearest edge
    const pts = shape.points;
    let best = -1;
    let bestD = 8 * unitsPerPx(this.el.canvas, this.map);
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j];
      const b = pts[(j + 1) % pts.length];
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((raw.x - a.x) * (b.x - a.x) + (raw.y - a.y) * (b.y - a.y)) / len2));
      const dist = Math.hypot(a.x + (b.x - a.x) * t - raw.x, a.y + (b.y - a.y) * t - raw.y);
      if (dist < bestD) {
        bestD = dist;
        best = j;
      }
    }
    if (best >= 0 && pts.length < LIMITS.maxPolyPoints) {
      const p = this.snapPoint(raw);
      this.edit(() => shape.points.splice(best + 1, 0, p));
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      this.redo();
    } else if (mod && key === 'd') {
      e.preventDefault();
      this.duplicateSelected();
    } else if (e.key === 'Enter') {
      if (this.draft) this.closeDraft();
      else this.finishModes();
    } else if (e.key === 'Escape') {
      if (this.draft || this.markerMode !== null) this.finishModes();
      else {
        this.sel = null;
        this.renderProps();
      }
    } else if (e.key === 'Backspace' && this.draft) {
      this.draft.points.pop();
      if (this.draft.points.length === 0) this.draft = null;
      this.updateHint();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (!mod && key === 'v') {
      this.setTool({ kind: 'select' });
    }
  }

  private deleteSelected(): void {
    const s = this.sel;
    if (s?.kind !== 'object') return;
    this.finishModes();
    this.edit(() => this.map.objects.splice(s.i, 1));
    this.sel = null;
    this.renderProps();
  }

  private duplicateSelected(): void {
    const o = this.selectedObject();
    if (!o || this.map.objects.length >= LIMITS.maxObjects) return;
    this.edit(() => this.map.objects.push(translateObject(o, GRID * 2, GRID * 2)));
    this.sel = { kind: 'object', i: this.map.objects.length - 1 };
    this.renderProps();
  }

  // ───────────────────────── Properties panel ─────────────────────────

  private field(label: string, control: HTMLElement, wide = false): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = wide ? 'field wide' : 'field';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(span, control);
    return wrap;
  }

  private numField(label: string, value: number, apply: (v: number) => void, step = 1): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) {
        input.value = String(value);
        return;
      }
      this.edit(() => apply(v));
    });
    return this.field(label, input);
  }

  private selectField<T extends string>(label: string, value: T, options: [T, string][], apply: (v: T) => void, wide = false): HTMLElement {
    const sel = document.createElement('select');
    for (const [v, text] of options) sel.append(new Option(text, v, false, v === value));
    sel.addEventListener('change', () => this.edit(() => apply(sel.value as T)));
    return this.field(label, sel, wide);
  }

  private toggle(label: string, checked: boolean, apply: (on: boolean) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => this.edit(() => apply(input.checked)));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(input, span);
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

  private group(...children: HTMLElement[]): HTMLElement {
    const g = document.createElement('div');
    g.className = 'fields';
    g.append(...children);
    return g;
  }

  private note(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    return p;
  }

  private actions(...children: HTMLElement[]): HTMLElement {
    const d = document.createElement('div');
    d.className = 'actions';
    d.append(...children);
    return d;
  }

  private heading(text: string): HTMLElement {
    const h = document.createElement('h5');
    h.textContent = text;
    return h;
  }

  private rectFields(r: Rect): HTMLElement {
    return this.group(
      this.numField('X', r.x, (v) => (r.x = Math.round(v))),
      this.numField('Y', r.y, (v) => (r.y = Math.round(v))),
      this.numField('Width', r.w, (v) => (r.w = Math.max(1, Math.round(v)))),
      this.numField('Height', r.h, (v) => (r.h = Math.max(1, Math.round(v)))),
    );
  }

  private renderProps(): void {
    const box = this.el.props;
    const zone = this.selectedZone();
    if (zone) {
      const title = document.createElement('h4');
      title.textContent = this.sel?.kind === 'start' ? 'START area' : 'GOAL area';
      box.replaceChildren(title, this.rectFields(zone));
      return;
    }
    const o = this.selectedObject();
    if (!o || this.sel?.kind !== 'object') {
      box.replaceChildren(this.note('Pick a tool from the palette, or select an object with the Select tool (V).'));
      return;
    }
    const idx = this.sel.i;
    const title = document.createElement('h4');
    title.textContent = `#${idx + 1} ${describeObject(o)}`;
    const parts: HTMLElement[] = [title];

    parts.push(this.group(
      this.selectField<Role>('Type', o.role, [['path', 'Path (safe floor)'], ['wall', 'Wall (deadly)']], (v) => (o.role = v), true),
    ));

    // Shape
    const s = o.shape;
    if (s.type === 'rect') {
      parts.push(this.group(
        this.numField('X', s.x, (v) => (s.x = Math.round(v))),
        this.numField('Y', s.y, (v) => (s.y = Math.round(v))),
        this.numField('Width', s.w, (v) => (s.w = Math.max(1, Math.round(v)))),
        this.numField('Height', s.h, (v) => (s.h = Math.max(1, Math.round(v)))),
      ));
    } else if (s.type === 'ellipse') {
      parts.push(this.group(
        this.numField('Center X', s.cx, (v) => (s.cx = Math.round(v))),
        this.numField('Center Y', s.cy, (v) => (s.cy = Math.round(v))),
        this.numField('Radius X', s.rx, (v) => (s.rx = Math.max(1, Math.round(v)))),
        this.numField('Radius Y', s.ry, (v) => (s.ry = Math.max(1, Math.round(v)))),
      ));
    } else {
      const curved = s.points.filter((p) => p.smooth).length;
      parts.push(this.note(`${s.points.length} vertices (${curved} curved). Double-click a vertex to toggle curve.`));
    }

    // Movement
    parts.push(this.heading('Movement'), this.toggle('Moves along a route', !!o.motion, (on) => {
      if (on) {
        o.motion = { ...DEFAULT_MOTION, points: [] };
        queueMicrotask(() => this.startMarkers(idx));
      } else {
        delete o.motion;
      }
    }));
    if (o.motion) {
      const m: Motion = o.motion;
      const fields = [
        this.selectField<MotionType>('Route', m.type, ROUTE_OPTIONS, (v) => {
          if (v === 'circle' && m.type !== 'circle') {
            const c = shapeCenter(o.shape);
            m.points = [m.points[0] ?? { x: c.x, y: c.y - 80 }];
            m.repeat = 'loop';
            m.easing = 'none';
          }
          m.type = v;
        }),
        this.selectField<Repeat>('Repeat', m.repeat, REPEAT_OPTIONS, (v) => (m.repeat = v)),
        this.numField('Speed (px/s)', m.speed, (v) => (m.speed = Math.min(LIMITS.maxSpeed, Math.max(0, v))), 10),
        this.selectField<Easing>('Smooth start/end', m.easing, EASING_OPTIONS, (v) => (m.easing = v)),
        this.numField('Start delay (ms)', m.delay, (v) => (m.delay = Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, Math.round(v)))), 100),
      ];
      if (m.type === 'circle') {
        fields.push(this.selectField('Direction', m.clockwise ? 'cw' : 'ccw', DIRECTION_OPTIONS, (v) => (m.clockwise = v === 'cw')));
      }
      parts.push(this.group(...fields));
      parts.push(this.note(
        m.type === 'circle'
          ? m.points.length ? 'Orbit center: the orange "C" marker. Drag it to change the radius.' : 'Click "Set orbit center", then click on the map.'
          : `${m.points.length} route marker${m.points.length === 1 ? '' : 's'}. Negative delay = start partway through the route.`,
      ));
      parts.push(this.actions(
        this.button(m.type === 'circle' ? 'Set orbit center' : 'Place markers', () => this.startMarkers(idx)),
        this.button('Remove last', () => m.points.length && this.edit(() => m.points.pop())),
        this.button('Clear', () => m.points.length && this.edit(() => (m.points = []))),
      ));
    }

    // Rotation
    parts.push(this.heading('Rotation'), this.toggle('Rotates around a pivot', !!o.rotation, (on) => {
      if (on) o.rotation = defaultRotation(o);
      else delete o.rotation;
    }));
    if (o.rotation) {
      const r: Rotation = o.rotation;
      parts.push(this.group(
        this.numField('Speed (°/s)', r.speed, (v) => (r.speed = Math.min(LIMITS.maxRotSpeed, Math.max(0, v))), 5),
        this.numField('Angle (°)', r.angle, (v) => (r.angle = Math.min(LIMITS.maxAngle, Math.max(0, v))), 15),
        this.selectField('Direction', r.clockwise ? 'cw' : 'ccw', DIRECTION_OPTIONS, (v) => (r.clockwise = v === 'cw')),
        this.selectField<Repeat>('Repeat', r.repeat, REPEAT_OPTIONS, (v) => (r.repeat = v)),
        this.selectField<Easing>('Smooth start/end', r.easing, EASING_OPTIONS, (v) => (r.easing = v)),
        this.numField('Start delay (ms)', r.delay, (v) => (r.delay = Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, Math.round(v)))), 100),
        this.numField('Pivot X', r.pivot.x, (v) => (r.pivot = { ...r.pivot, x: Math.round(v) })),
        this.numField('Pivot Y', r.pivot.y, (v) => (r.pivot = { ...r.pivot, y: Math.round(v) })),
      ));
      parts.push(this.note('Angle 360 + Loop = continuous spin. Ping-pong swings back and forth.'));
      parts.push(this.actions(this.button('Center pivot', () => this.edit(() => (r.pivot = shapeCenter(o.shape))))));
    }

    parts.push(this.actions(
      this.button('Duplicate', () => this.duplicateSelected()),
      this.button('Delete', () => this.deleteSelected(), 'danger'),
    ));
    box.replaceChildren(...parts);
  }

  /** Rebuild the theme panel only when the theme actually changed, so open controls keep focus */
  private renderedTheme: string | null = null;
  private renderTheme(): void {
    const json = JSON.stringify(this.map.theme ?? null);
    if (json === this.renderedTheme) return;
    this.renderedTheme = json;
    renderThemePanel(this.el.theme, this.map.theme, (next) =>
      this.edit(() => {
        if (next) this.map.theme = next;
        else delete this.map.theme;
      }),
    );
  }

  private startMarkers(i: number): void {
    this.draft = null;
    this.markerMode = i;
    this.updateHint();
  }

  // ───────────────────────── Sharing / files ─────────────────────────

  private async share(): Promise<void> {
    if (this.el.share.disabled) return;
    const code = await encodeMap(validateMap(this.map));
    const url = `${location.origin}${location.pathname}#m=${code}`;
    this.el.shareUrl.value = url;
    this.el.shareUrl.select();
    try {
      await navigator.clipboard.writeText(url);
      this.el.verify.textContent = `🔗 Link copied to clipboard (${url.length} chars)`;
    } catch {
      this.el.verify.textContent = `Link created — please copy it manually (${url.length} chars)`;
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
      this.loadMap(validateMap(JSON.parse(await file.text())));
    } catch (err) {
      alert(`Couldn't load the map: ${(err as Error).message}`);
    }
  }

  // ───────────────────────── Drawing ─────────────────────────

  private draw(): void {
    if (!this.visible) return;
    const { ctx, map } = this;
    const u = unitsPerPx(this.el.canvas, map);
    const objs = this.compiled;
    const preview = this.el.preview.checked;
    beginFrame(ctx, map);
    drawMap(ctx, map, objs, preview ? performance.now() - this.previewStart : 0);

    // While previewing, show where dynamic objects rest (their editing position)
    if (preview) {
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.strokeStyle = 'rgba(36,52,80,0.45)';
      ctx.lineWidth = 1.2 * u;
      for (const o of objs) {
        if (!o.dynamic) continue;
        ctx.beginPath();
        traceObject(ctx, o, IDENTITY);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const selIndex = this.sel?.kind === 'object' ? this.sel.i : -1;

    // Routes and pivots of every dynamic object (faint), the selected one highlighted
    map.objects.forEach((o, i) => {
      const selected = i === selIndex;
      if (o.motion) {
        const route = new CompiledMotion(o.motion, shapeCenter(o.shape)).route();
        if (route.length >= 4) {
          ctx.strokeStyle = selected ? COLORS.routeSelected : COLORS.route;
          ctx.lineWidth = (selected ? 2 : 1.2) * u;
          ctx.setLineDash(selected ? [] : [6 * u, 4 * u]);
          ctx.beginPath();
          ctx.moveTo(route[0], route[1]);
          for (let k = 2; k < route.length; k += 2) ctx.lineTo(route[k], route[k + 1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (o.rotation && !selected) {
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath();
        ctx.arc(o.rotation.pivot.x, o.rotation.pivot.y, 2.5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Selection outline
    const zone = this.selectedZone();
    const selObj = selIndex >= 0 ? objs[selIndex] : undefined;
    if (zone || selObj) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.beginPath();
      if (zone) ctx.rect(zone.x, zone.y, zone.w, zone.h);
      else traceObject(ctx, selObj!, IDENTITY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Handles
    const o = this.selectedObject();
    let markerNo = 0;
    for (const { h, p } of this.handles()) {
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = COLORS.ink;
      if (h.kind === 'pivot') {
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(p.x - 4 * u, p.y);
        ctx.lineTo(p.x + 4 * u, p.y);
        ctx.moveTo(p.x, p.y - 4 * u);
        ctx.lineTo(p.x, p.y + 4 * u);
        ctx.stroke();
      } else if (h.kind === 'marker') {
        markerNo++;
        ctx.fillStyle = COLORS.routeSelected;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1a1206';
        ctx.font = `700 ${9 * u}px ${FONT_MAIN}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o?.motion?.type === 'circle' ? 'C' : String(markerNo), p.x, p.y + 0.5 * u);
      } else if (h.kind === 'vertex' && o?.shape.type === 'poly' && o.shape.points[h.j].smooth) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.x - 4 * u, p.y - 4 * u, 8 * u, 8 * u);
        ctx.strokeRect(p.x - 4 * u, p.y - 4 * u, 8 * u, 8 * u);
      }
    }

    // Polygon / freeform in progress
    if (this.draft) {
      const pts = this.hover ? [...this.draft.points, this.snapPoint(this.hover)] : this.draft.points;
      if (pts.length >= 3) {
        const ring = polyOutline(pts);
        ctx.fillStyle = 'rgba(58,159,240,0.1)';
        ctx.beginPath();
        for (let k = 0; k < ring.length; k += 2) ctx.lineTo(ring[k], ring[k + 1]);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      this.draft.points.forEach((p, k) => {
        ctx.fillStyle = k === 0 ? COLORS.routeSelected : COLORS.ink;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (k === 0 ? 6 : 3.5) * u, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Box being dragged
    const d = this.drag;
    if (d?.type === 'box') {
      let r = rectFromCorners({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
      if (d.square) {
        const s = Math.max(r.w, r.h);
        r = { x: d.x1 < d.x0 ? d.x0 - s : d.x0, y: d.y1 < d.y0 ? d.y0 - s : d.y0, w: s, h: s };
      }
      ctx.fillStyle = 'rgba(58,159,240,0.12)';
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      if (this.tool.kind === 'object' && this.tool.shape === 'ellipse') {
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(r.x, r.y, r.w, r.h);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.font = `${12 * u}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${r.w}×${r.h}`, r.x, r.y - 3 * u);
    }

    // Marker placement preview
    if (this.markerMode !== null && this.hover) {
      const p = this.snapPoint(this.hover);
      ctx.strokeStyle = COLORS.routeSelected;
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
