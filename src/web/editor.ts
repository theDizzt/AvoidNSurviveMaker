import { pointInPoly, pointInRect } from '../core/geometry';
import { CompiledMotion } from '../core/motion';
import { compileObject, transformAt, type CompiledObject, type Transform } from '../core/object';
import {
  alignOffset, distributeOffsets, objectsBounds, reorder, shapeCentroid, translateObject, turnObjects, unionRect,
  type AlignMode, type Turn, type ZOrder,
} from '../core/arrange';
import { gameplayKey } from '../core/level';
import { initialChannels } from '../core/switches';
import { mergeShapes, type MergeOp } from '../core/merge';
import { flattenShape, polyOutline, shapeBounds, shapeCenter } from '../core/shape';
import { encodeMap } from '../core/share';
import type {
  Easing, LinkAction, MapData, MapObject, Motion, MotionType, Point, PolyPoint, Rect, Repeat, Role, Rotation, Shape,
  TriggerKind,
} from '../core/types';
import { SWITCH_COLORS, switchColor } from '../core/colors';
import { boulderShape, spikeShape } from '../core/hazards';
import { BeamCaster } from '../core/laser';
import { createEmptyMap, DEFAULT_MOTION, defaultRotation, LIMITS, mapErrors, mapWarnings, validateMap } from '../core/validate';
import {
  beginFrame, clientToMap, COLORS, drawDarkAreas, drawGlobalDark, drawMap, FONT_MAIN, fitCanvas, TEXT_BASE_FONTS, traceObject, unitsPerPx,
} from './render';
import { closeContextMenu, openContextMenu, type MenuItem } from './context-menu';
import { renderThemePanel } from './theme-panel';
import { badgeFor, badgeTitle, chapterMazePresets } from './theme-registry';
import { badgeImage, drawLevelBadge } from './badge';
import { DEFAULT_BADGE } from '../core/theme-pack';
import { fontPicker } from './font-picker';

// ───────────────────────── Tools ─────────────────────────

type ShapeKind = 'rect' | 'ellipse' | 'poly' | 'free' | 'sector';
type Behavior = 'static' | 'moving' | 'rotating';
interface ObjectTool {
  kind: 'object';
  role: Role;
  behavior: Behavior;
  shape: ShapeKind;
  /** role 'trigger': which kind of switch / zone */
  trigger?: TriggerKind;
  /** Walls with a built-in behavior */
  special?: 'spike' | 'boulder' | 'disc' | 'blade';
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
  sector: '<path d="M5 19 L5 5 A14 14 0 0 1 19 19 Z"/>',
};

/** Special objects (#27–42): fixed palette numbers, independent of moving / rotating */
const SPECIAL_IDS = {
  sectorPath: 27, sectorWall: 28, spike: 29, boulder: 30, coin: 31, laser: 37, mirror: 38, portal: 39, door: 40, dark: 41, globalDark: 42,
  disc: 43, blade: 44, movingDisc: 45, movingBlade: 46, text: 47, safe: 48,
} as const;
const TRIGGER_IDS: Record<TriggerKind, number> = { switch: 32, timer: 33, hold: 34, startZone: 35, stopZone: 36 };
const TRIGGER_NAMES: Record<TriggerKind, string> = {
  switch: 'Switch', timer: 'Timer Switch', hold: 'Hold Switch', startZone: 'Event Start Zone', stopZone: 'Event Stop Zone',
};
/** Switch buttons are always square */
const isButton = (k: TriggerKind | undefined) => k === 'switch' || k === 'timer' || k === 'hold';

const ROLE_NAMES: Record<Role, string> = {
  path: 'Path', wall: 'Wall', coin: 'Coin', dark: 'Darkness Area', trigger: 'Switch', door: 'Auto Door', laser: 'Laser', mirror: 'Mirror', portal: 'Portal',
  text: 'Text Box', safe: 'Safe Zone',
};
/** Objects that always stay square */
const isSquare = (o: { role: Role; trigger?: { kind: TriggerKind }; saw?: { kind: string } }) => o.role === 'portal' || o.role === 'laser' || isButton(o.trigger?.kind) || o.saw?.kind === 'disc';

function toolLabel(t: ObjectTool): string {
  if (t.role === 'trigger') return TRIGGER_NAMES[t.trigger ?? 'switch'];
  if (t.special === 'spike') return 'Spike Stake';
  if (t.special === 'boulder') return 'Rolling Boulder';
  if (t.special === 'disc' || t.special === 'blade') return `${t.behavior === 'moving' ? 'Moving ' : ''}${t.special === 'disc' ? 'Circular Grinder' : 'Saw Blade'}`;
  if (t.role !== 'path' && t.role !== 'wall') return ROLE_NAMES[t.role];
  const shape = t.shape === 'sector' ? 'Sector' : SHAPES.find(([k]) => k === t.shape)![1];
  const beh = t.behavior === 'moving' ? 'Moving ' : t.behavior === 'rotating' ? 'Rotating ' : '';
  return `${beh}${shape} ${ROLE_NAMES[t.role]}`;
}

/** Freeform: drawn with the freeform tool, made by merging, or any polygon with curved vertices */
function isFreeform(s: Shape): boolean {
  return s.type === 'poly' && (!!s.free || s.points.some((p) => p.smooth));
}

function describeObject(o: MapObject): string {
  const shape =
    o.shape.type === 'rect' ? 'Rectangle'
      : o.shape.type === 'ellipse' ? 'Circle'
        : o.shape.type === 'sector' ? 'Sector'
          : isFreeform(o.shape) ? 'Freeform' : 'Polygon';
  const beh = o.rotation ? 'Rotating ' : o.motion ? 'Moving ' : '';
  if (o.role === 'trigger') return `${beh}${switchColor(o.trigger?.color ?? 0).name} ${TRIGGER_NAMES[o.trigger?.kind ?? 'switch']}`;
  if (o.spike) return 'Spike Stake';
  if (o.boulder) return 'Rolling Boulder';
  if (o.saw) return `${o.motion ? 'Moving ' : ''}${o.saw.kind === 'disc' ? 'Circular Grinder' : 'Saw Blade'}`;
  if (o.role === 'laser' || o.role === 'portal') return `${beh}${switchColor((o.laser ?? o.portal)!.color).name} ${ROLE_NAMES[o.role]}`;
  if (o.role !== 'path' && o.role !== 'wall') return `${beh}${ROLE_NAMES[o.role]}`;
  return `${beh}${shape} ${ROLE_NAMES[o.role]}`;
}

/** The palette number of the tool that makes this kind of object */
function objectToolId(o: MapObject): number {
  if (o.role === 'coin') return SPECIAL_IDS.coin;
  if (o.role === 'dark') return SPECIAL_IDS.dark;
  if (o.role === 'door') return SPECIAL_IDS.door;
  if (o.role === 'laser') return SPECIAL_IDS.laser;
  if (o.role === 'mirror') return SPECIAL_IDS.mirror;
  if (o.role === 'portal') return SPECIAL_IDS.portal;
  if (o.spike) return SPECIAL_IDS.spike;
  if (o.boulder) return SPECIAL_IDS.boulder;
  if (o.saw) return o.saw.kind === 'disc' ? (o.motion ? SPECIAL_IDS.movingDisc : SPECIAL_IDS.disc) : o.motion ? SPECIAL_IDS.movingBlade : SPECIAL_IDS.blade;
  if (o.role === 'text') return SPECIAL_IDS.text;
  if (o.role === 'safe') return SPECIAL_IDS.safe;
  if (o.role === 'trigger') return TRIGGER_IDS[o.trigger?.kind ?? 'switch'];
  if (o.shape.type === 'sector') return o.role === 'path' ? SPECIAL_IDS.sectorPath : SPECIAL_IDS.sectorWall;
  const shape = o.shape.type === 'rect' ? 0 : o.shape.type === 'ellipse' ? 1 : isFreeform(o.shape) ? 3 : 2;
  const group = GROUPS.find(
    (g) => 'role' in g && g.role === o.role && g.behavior === (o.rotation ? 'rotating' : o.motion ? 'moving' : 'static'),
  );
  return group && 'first' in group ? group.first + shape : 0;
}

const ZONE_IDS = { start: 9, goal: 10 } as const;

/** "120×40"; circles report their diameter, polygons their bounding box */
function sizeText(w: number, h: number): string {
  return `${Math.round(w)}×${Math.round(h)}`;
}

// ───────────────────────── Editor state types ─────────────────────────

/** Selected objects keep the order they were picked in (merge "subtract" keeps the first one) */
type Selection = { kind: 'objects'; ids: number[] } | { kind: 'start' } | { kind: 'goal' } | null;
type Hit = { kind: 'object'; i: number } | { kind: 'start' } | { kind: 'goal' } | null;
type Handle =
  | { kind: 'corner'; j: number }
  | { kind: 'vertex'; j: number }
  | { kind: 'marker'; j: number }
  | { kind: 'pivot' }
  /** Sector: the two arc ends (angles) and the arc middle (radius) */
  | { kind: 'arc'; part: 'start' | 'end' | 'radius' }
  /** Laser: beam direction */
  | { kind: 'aim' };
type Drag =
  | { type: 'box'; x0: number; y0: number; x1: number; y1: number; square: boolean }
  | {
    type: 'move'; p0: Point; before: string; moved: boolean;
    /** Zone being moved, or the selected objects as they were */
    zone?: Rect; objs?: { i: number; o: MapObject }[];
    /** Object clicked inside the current selection: picked alone if released without moving */
    clicked: number | null;
  }
  | { type: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean; base: number[] }
  | { type: 'handle'; h: Handle; before: string; moved: boolean; orig: MapObject | Rect };

const STORAGE_KEY = 'avoid-n-survive:editor';
const GRID_TOP_KEY = 'avoid-n-survive:editor-grid-top';
/** Map sizes offered in the editor, all 16:9 */
const MAP_SIZES: [number, number][] = [[640, 360], [960, 540], [1280, 720], [1600, 900], [1920, 1080]];
const GRID = 10;
const HISTORY_LIMIT = 200;
const HANDLE_PX = 7;
/** Screen px within which a dragged pivot snaps to the shape's center points / vertices */
const PIVOT_SNAP_PX = 10;
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
  /** Level settings: title, number, difficulty, star times */
  level: HTMLElement;
  snap: HTMLInputElement;
  preview: HTMLInputElement;
  gridTop: HTMLInputElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  shortcuts: HTMLButtonElement;
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

type CommandId =
  | 'cut' | 'copy' | 'paste' | 'duplicate' | 'delete'
  | 'selectAll' | 'selectPaths' | 'selectWalls' | 'selectSame'
  | 'front' | 'forward' | 'backward' | 'back'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignTop' | 'alignMiddle' | 'alignBottom' | 'distH' | 'distV' | 'alignToMap'
  | 'rotCW' | 'rotCCW' | 'flipV' | 'flipH'
  | 'group' | 'ungroup' | 'regroup'
  | 'union' | 'combine' | 'fragment' | 'intersect' | 'subtract'
  | 'pivotCenter' | 'pivotCentroid'
  | 'makePath' | 'makeWall';

interface Command {
  label: string;
  enabled: boolean;
  run: () => void;
  keys?: string;
  checked?: boolean;
  danger?: boolean;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Shown in the "?" overlay; keep in sync with Editor.onKey and the F/H keys in main.ts */
const SHORTCUTS: [string, [string, string][]][] = [
  ['Tools', [
    ['V', 'Select / edit'],
    ['1 / 2 / 3 / 4', 'Rectangle / Circle / Polygon / Freeform'],
    ['W', 'Switch between path and wall'],
    ['M', 'Moving object (press again for static)'],
    ['R', 'Rotating object (press again for static)'],
    ['S / G', 'Start area / Goal area'],
  ]],
  ['Edit', [
    ['Ctrl+Z', 'Undo'],
    ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'],
    ['Ctrl+D', 'Duplicate'],
    ['Delete', 'Delete'],
    ['Ctrl+A', 'Select all'],
    ['Shift+Click / Ctrl+Click', 'Add to / remove from selection'],
    ['Drag', 'On empty space: select everything inside the box'],
    ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
    ['Ctrl+] / Ctrl+[', 'Bring forward / send backward'],
    ['Ctrl+Shift+] / Ctrl+Shift+[', 'Bring to front / send to back'],
    ['Alt', 'While dragging a pivot: place freely (no snapping)'],
    ['Arrows', 'Move selection (grid step when Snap is on)'],
    ['Shift+Arrows', 'Move selection ×10'],
    ['Tab / Shift+Tab', 'Select next / previous'],
    ['Esc', 'Cancel drawing / deselect'],
    ['Enter', 'Close polygon / finish markers'],
    ['Backspace', 'Remove last point while drawing'],
  ]],
  ['View', [
    ['N', 'Toggle snap to grid'],
    ['P', 'Toggle motion preview'],
    ['T', 'Test play'],
    ['H', 'Hide / show panels'],
    ['F', 'Fullscreen'],
    ['Right-click', 'Arrange, align, rotate, group and merge menu'],
    ['?', 'Show this list'],
  ]],
];

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
  /** Called after every change to the map (the map pack panel listens) */
  onChange: () => void = () => {};

  private map: MapData;
  /** Maze colors of the map being edited (picks the editor's music) */
  get mapTheme(): MapData['theme'] {
    return this.map.theme;
  }
  private compiledCache: CompiledObject[] | null = null;
  /** gameplayKey() of the map as last cleared in test play (sharing needs a verified clear) */
  private verifiedJson: string | null = null;
  /** Clear time of that test play, used to suggest star times */
  private lastClearMs: number | null = null;
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
  /** Last object tool used; number keys / W / M / R change one aspect of it */
  private lastObjectTool: ObjectTool = { kind: 'object', role: 'path', behavior: 'static', shape: 'rect' };
  /** Copied objects (Ctrl+C / Ctrl+X) and how many times they have been pasted */
  private clipboard: { objs: MapObject[]; pastes: number } | null = null;
  /** Consecutive arrow-key nudges of the same selection share one undo step */
  private lastNudge: { key: string; t: number } | null = null;
  private helpBox: HTMLElement | null = null;
  /** Switch color for the next switch / door / link (the last one picked) */
  private lastColor = 0;
  /** Palette button for #42 global darkness (pressed while the map has it) */
  private globalDarkBtn: HTMLButtonElement | null = null;
  /** Align / distribute relative to the map instead of the selection */
  private alignToMap = false;
  /** Members of the last ungrouped group, for "Regroup" (valid while the object list keeps its layout) */
  private lastUngrouped: { ids: number[]; count: number } | null = null;
  /** Short status message shown in the hint bar for a moment */
  private flashMsg: { text: string; until: number } | null = null;
  /** Pivot snap target while dragging a pivot (drawn as a guide) */
  private pivotSnap: { p: Point; label: string } | null = null;

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
    el.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onContextMenu(e);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    const refit = () => fitCanvas(el.canvas, this.map);
    new ResizeObserver(refit).observe(el.canvas.parentElement!);
    window.addEventListener('resize', refit);

    // "Grid on top" is a per-browser preference
    try {
      el.gridTop.checked = localStorage.getItem(GRID_TOP_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    el.gridTop.addEventListener('change', () => {
      try {
        localStorage.setItem(GRID_TOP_KEY, el.gridTop.checked ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    });
    el.undo.addEventListener('click', () => this.undo());
    el.redo.addEventListener('click', () => this.redo());
    el.shortcuts.addEventListener('click', () => this.toggleHelp());

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
      this.clearSelection();
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
    closeContextMenu();
    this.finishModes();
    this.toggleHelp(false);
  }

  /** Bring a map from the play screen into the editor (remix). Previous work can be restored with Undo */
  loadMap(map: MapData): void {
    this.finishModes();
    this.edit(() => (this.map = clone(map)));
    this.clearSelection();
    fitCanvas(this.el.canvas, this.map);
  }

  /** If the map cleared in test play matches the one being edited, mark it shareable */
  markVerified(map: MapData, timeMs?: number): void {
    const key = gameplayKey(map);
    if (key === gameplayKey(this.map)) {
      this.verifiedJson = key;
      if (timeMs !== undefined) this.lastClearMs = timeMs;
      this.changed();
    }
  }

  /** The map being edited (a copy) */
  getMap(): MapData {
    return clone(this.map);
  }

  /** Has this map (by its gameplay) been cleared in test play? Defaults to the map being edited */
  isVerified(map: MapData = this.map): boolean {
    return this.verifiedJson === gameplayKey(map);
  }

  /** Open a map; `verified` carries over a clear made earlier (e.g. a level stored in a map pack) */
  openMap(map: MapData, verified: boolean): void {
    this.loadMap(map);
    if (verified) {
      this.verifiedJson = gameplayKey(map);
      this.changed();
    }
  }


  private get compiled(): CompiledObject[] {
    if (!this.compiledCache) {
      this.compiledCache = this.map.objects.map(compileObject);
      this.beamCaster = null;
    }
    return this.compiledCache;
  }

  /** Laser preview; rebuilt with the compiled objects */
  private beamCaster: BeamCaster | null = null;

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
        addButton(row, { kind: 'zone', zone: 'start' }, '<span class="pal-zone">S</span><span class="pal-num">9</span>', '#9 Start area (S)', 'pal-start');
        addButton(row, { kind: 'zone', zone: 'goal' }, '<span class="pal-zone">G</span><span class="pal-num">10</span>', '#10 Goal area (G)', 'pal-goal');
      } else {
        SHAPES.forEach(([shape], k) => {
          const tool: ObjectTool = { kind: 'object', role: g.role, behavior: g.behavior, shape };
          const num = g.first + k;
          const badge = g.behavior === 'moving' ? '<span class="pal-badge">⇄</span>' : g.behavior === 'rotating' ? '<span class="pal-badge">↻</span>' : '';
          addButton(
            row,
            tool,
            `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[shape]}</svg>${badge}<span class="pal-num">${num}</span>`,
            `#${num} ${toolLabel(tool)} (${k + 1})`,
            `pal-${g.role} pal-${g.behavior}`,
          );
        });
      }
      box.append(h, row);
    }

    // Special objects
    const h = document.createElement('h4');
    h.className = 'pal-title';
    h.textContent = 'Special';
    const row = document.createElement('div');
    row.className = 'pal-row';
    const sectorPath: ObjectTool = { kind: 'object', role: 'path', behavior: 'static', shape: 'sector' };
    const sectorWall: ObjectTool = { kind: 'object', role: 'wall', behavior: 'static', shape: 'sector' };
    const coin: ObjectTool = { kind: 'object', role: 'coin', behavior: 'static', shape: 'ellipse' };
    const dark: ObjectTool = { kind: 'object', role: 'dark', behavior: 'static', shape: 'rect' };
    const svg = (inner: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
    addButton(row, sectorPath, `${svg(ICONS.sector)}<span class="pal-num">27</span>`, '#27 Sector Path', 'pal-path pal-static');
    addButton(row, sectorWall, `${svg(ICONS.sector)}<span class="pal-num">28</span>`, '#28 Sector Wall', 'pal-wall pal-static');
    addButton(row, coin, `${svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="4" fill="none"/>')}<span class="pal-num">31</span>`, '#31 Coin', 'pal-coin');
    const trig = (kind: TriggerKind): ObjectTool => ({ kind: 'object', role: 'trigger', behavior: 'static', shape: 'rect', trigger: kind });
    const btn = '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="#fff" fill-opacity="0.55"/>';
    addButton(row, trig('switch'), `${svg(btn)}<span class="pal-num">32</span>`, '#32 Switch', 'pal-switch');
    addButton(row, trig('timer'), `${svg(`${btn}<path d="M12 12 L12 8 A4 4 0 0 1 16 12 Z" fill="#243450" fill-opacity="0.5"/>`)}<span class="pal-num">33</span>`, '#33 Timer Switch', 'pal-switch');
    addButton(row, trig('hold'), `${svg(`${btn}<circle cx="12" cy="12" r="2" fill="#243450"/>`)}<span class="pal-num">34</span>`, '#34 Hold Switch', 'pal-switch');
    addButton(row, trig('startZone'), `${svg('<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/><path d="M10 9 L15 12 L10 15 Z" fill="#c2577b"/>')}<span class="pal-num">35</span>`, '#35 Event Start Zone', 'pal-zone-ev');
    addButton(row, trig('stopZone'), `${svg('<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/><rect x="9.5" y="9.5" width="5" height="5" fill="#c2577b"/>')}<span class="pal-num">36</span>`, '#36 Event Stop Zone', 'pal-zone-ev');
    const door: ObjectTool = { kind: 'object', role: 'door', behavior: 'static', shape: 'rect' };
    addButton(row, door, `${svg('<rect x="2" y="9" width="9" height="6"/><rect x="13" y="9" width="9" height="6"/><path d="M8 6 L5 6 M16 6 L19 6" />')}<span class="pal-num">40</span>`, '#40 Auto Door', 'pal-door');
    addButton(row, dark, `${svg('<rect x="4" y="4" width="16" height="16" rx="2"/>')}<span class="pal-num">41</span>`, '#41 Darkness Area', 'pal-dark');
    const spike: ObjectTool = { kind: 'object', role: 'wall', behavior: 'static', shape: 'poly', special: 'spike' };
    const boulder: ObjectTool = { kind: 'object', role: 'wall', behavior: 'moving', shape: 'poly', special: 'boulder' };
    const laser: ObjectTool = { kind: 'object', role: 'laser', behavior: 'static', shape: 'rect' };
    const mirror: ObjectTool = { kind: 'object', role: 'mirror', behavior: 'static', shape: 'poly' };
    const portal: ObjectTool = { kind: 'object', role: 'portal', behavior: 'static', shape: 'rect' };
    addButton(row, spike, `${svg('<path d="M3 21 L18 6 L21 3 L17 7 Z" stroke-linejoin="round"/><path d="M5 19 L8 22 M2 16 L5 19" />')}<span class="pal-num">29</span>`, '#29 Spike Stake', 'pal-wall pal-moving');
    addButton(row, boulder, `${svg('<polygon points="12,3 14.6,7.6 19.8,6.2 18.4,11.4 21,14 16.4,16.6 17.8,21.8 12.6,20.4 10,23 7.4,18.4 2.2,19.8 3.6,14.6 1,12 5.6,9.4 4.2,4.2 9.4,5.6" transform="scale(0.9) translate(1.3 0)"/>')}<span class="pal-num">30</span>`, '#30 Rolling Boulder', 'pal-wall pal-moving');
    addButton(row, laser, `${svg('<rect x="3" y="8" width="8" height="8" rx="1.5"/><path d="M11 12 L22 12" stroke="#e2486c" stroke-width="2.4"/>')}<span class="pal-num">37</span>`, '#37 Laser', 'pal-laser');
    addButton(row, mirror, `${svg('<path d="M4 20 L20 4" stroke-width="4" stroke="#8fa3bf"/><path d="M4 20 L20 4" stroke-width="1.4" stroke="#fff"/>')}<span class="pal-num">38</span>`, '#38 Mirror', 'pal-mirror');
    addButton(row, portal, `${svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="5" fill="none"/><circle cx="12" cy="12" r="1.6"/>')}<span class="pal-num">39</span>`, '#39 Teleport Portal', 'pal-portal');
    const sawTool = (special: 'disc' | 'blade', behavior: Behavior): ObjectTool => ({ kind: 'object', role: 'wall', behavior, shape: special === 'disc' ? 'ellipse' : 'rect', special });
    const discIcon = '<path d="M12 2 L14 5 L17.6 4.2 L18 7.9 L21.4 9.5 L19.6 12.7 L21.4 15.9 L18 17.4 L17.6 21.1 L14 20.3 L12 23 L10 20.3 L6.4 21.1 L6 17.4 L2.6 15.9 L4.4 12.7 L2.6 9.5 L6 7.9 L6.4 4.2 L10 5 Z" transform="scale(0.92) translate(1 0)"/><circle cx="12" cy="12.5" r="2.6" fill="#fff"/>';
    const bladeIcon = '<path d="M2 9 L4 7 L6 9 L8 7 L10 9 L12 7 L14 9 L16 7 L18 9 L20 7 L22 9 L22 15 L20 17 L18 15 L16 17 L14 15 L12 17 L10 15 L8 17 L6 15 L4 17 L2 15 Z"/>';
    const route = '<path d="M15 21 L22 21 M19.5 18.5 L22 21 L19.5 23.5" stroke-width="1.6" fill="none"/>';
    addButton(row, sawTool('disc', 'static'), `${svg(discIcon)}<span class="pal-num">43</span>`, '#43 Circular Grinder', 'pal-saw');
    addButton(row, sawTool('blade', 'static'), `${svg(bladeIcon)}<span class="pal-num">44</span>`, '#44 Saw Blade', 'pal-saw');
    addButton(row, sawTool('disc', 'moving'), `${svg(discIcon + route)}<span class="pal-num">45</span>`, '#45 Moving Circular Grinder', 'pal-saw');
    addButton(row, sawTool('blade', 'moving'), `${svg(bladeIcon + route)}<span class="pal-num">46</span>`, '#46 Moving Saw Blade', 'pal-saw');
    const textTool: ObjectTool = { kind: 'object', role: 'text', behavior: 'static', shape: 'rect' };
    const safeTool: ObjectTool = { kind: 'object', role: 'safe', behavior: 'static', shape: 'rect' };
    addButton(row, textTool, `${svg('<path d="M5 6 L19 6 M12 6 L12 19 M9 19 L15 19" stroke-width="2.6" fill="none" stroke-linecap="round"/>')}<span class="pal-num">47</span>`, '#47 Text Box', 'pal-text');
    addButton(row, safeTool, `${svg('<rect x="3" y="3" width="18" height="18" rx="2" fill-opacity="0.45"/><path d="M12 6.5 L16.5 8.3 L16.2 12.4 C15.8 15 14 16.6 12 17.6 C10 16.6 8.2 15 7.8 12.4 L7.5 8.3 Z" fill="#fff"/>')}<span class="pal-num">48</span>`, '#48 Safe Zone', 'pal-safe');
    // #42 is a map setting, not an object: the button toggles it
    const g = document.createElement('button');
    g.type = 'button';
    g.className = 'pal-btn pal-global-dark';
    g.title = '#42 Global darkness (toggle)';
    g.setAttribute('aria-label', g.title);
    g.innerHTML = `${svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="#fff"/>')}<span class="pal-num">42</span>`;
    g.addEventListener('click', () => this.edit(() => {
      if (this.map.darkness) delete this.map.darkness;
      else this.map.darkness = { light: 60 };
    }));
    this.globalDarkBtn = g;
    row.append(g);
    box.append(h, row);
  }

  private setTool(tool: Tool): void {
    this.finishModes();
    this.tool = tool;
    if (tool.kind === 'object' && (tool.role === 'path' || tool.role === 'wall') && tool.shape !== 'sector' && !tool.special) this.lastObjectTool = tool;
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
    this.lastNudge = null;
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
    this.lastNudge = null;
    this.finishModes();
    fitCanvas(this.el.canvas, this.map);
    this.changed();
  }

  /** After the map changes: save, validate, refresh panels */
  private changed(): void {
    // Drop selected indices that no longer exist (delete, merge, undo…) before panels read them
    if (this.sel?.kind === 'objects') {
      const ids = this.sel.ids.filter((i) => i < this.map.objects.length);
      this.sel = ids.length ? { kind: 'objects', ids } : null;
    }
    this.dirty();
    this.save();
    this.syncInputs();
    this.renderProps();
    this.renderTheme();
    this.renderLevel();
    this.globalDarkBtn?.setAttribute('aria-pressed', String(!!this.map.darkness));

    const msgs: { text: string; error: boolean }[] = [];
    try {
      validateMap(this.map);
      const errors = mapErrors(this.map);
      this.valid = errors.length === 0;
      for (const e of errors) msgs.push({ text: e, error: true });
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

    const verified = this.isVerified();
    this.el.share.disabled = !verified || !this.valid;
    this.el.verify.textContent = verified ? 'Clear verified — ready to share' : 'To share, first clear the map yourself in test play';
    this.el.verify.className = verified ? 'verify ok' : 'verify';
    if (!verified) this.el.shareUrl.value = '';
    this.el.undo.disabled = this.history.length === 0;
    this.el.redo.disabled = this.future.length === 0;
    this.updateHint();
    this.onChange();
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
    const n = this.selIds().length;
    if (this.flashMsg && performance.now() < this.flashMsg.until) {
      text = this.flashMsg.text;
    } else if (this.markerMode !== null) {
      const m = this.map.objects[this.markerMode]?.motion;
      text = m?.type === 'circle'
        ? 'Click to set the orbit center. Enter or Esc when done'
        : `Click to place route markers (${m?.points.length ?? 0} placed). Enter or Esc when done`;
    } else if (this.draft) {
      text = this.draft.tool.shape === 'free'
        ? `Click to add curved points, Shift+click for sharp corners (${this.draft.points.length}). Click the first point or press Enter to close · Backspace undoes a point · Esc cancels`
        : `Click to add vertices (${this.draft.points.length}). Click the first point or press Enter to close · Backspace undoes a point · Esc cancels`;
    } else if (this.tool.kind === 'select' && n > 1) {
      text = `${n} objects selected. Drag to move them together · right-click for arrange, align, group and merge · Shift+click adds or removes`;
    } else if (this.tool.kind === 'select') {
      text = 'Click to select, drag on empty space to select several, Shift+click to add. Drag handles to reshape · double-click a vertex to toggle curve, an edge to add a vertex · Alt+click removes a vertex · right-click for more';
    } else if (this.tool.kind === 'zone') {
      text = `Drag to set the ${this.tool.zone === 'start' ? 'START' : 'GOAL'} area`;
    } else {
      const t = this.tool;
      const how = t.special === 'spike' ? 'Drag from the base to the tip (the tip is where it thrusts)'
        : t.special === 'boulder' ? 'Click to place it, then click route markers for it to roll along'
          : t.role === 'mirror' ? 'Drag from one end of the mirror to the other'
            : t.role === 'laser' ? 'Click to place the emitter, then drag the orange diamond to aim'
              : t.role === 'portal' ? 'Click to place a portal; same-colored portals connect' : t.shape === 'sector' ? 'Drag outward from the apex (the drag direction is the middle of the slice)' : t.role === 'coin' ? 'Click to place a coin (always 24×24)' : t.shape === 'poly' || t.shape === 'free' ? 'Click to place points' : t.shape === 'ellipse' ? 'Drag to draw (Shift for a perfect circle)' : 'Drag to draw (Shift for a square)';
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

  private hitTest(p: Point): Hit {
    const objs = this.compiled;
    const zoneTrigger = (i: number) => !isButton(this.map.objects[i]?.trigger?.kind);
    for (const role of ['coin', 'portal', 'laser', 'trigger', 'wall', 'door', 'mirror'] as const) {
      for (let i = objs.length - 1; i >= 0; i--) {
        if (role === 'trigger' && zoneTrigger(i)) continue;
        if (objs[i].role === role && pointInPoly(p.x, p.y, objs[i].poly)) return { kind: 'object', i };
      }
    }
    if (pointInRect(p.x, p.y, this.map.goal)) return { kind: 'goal' };
    if (pointInRect(p.x, p.y, this.map.start)) return { kind: 'start' };
    // Darkness areas last, so whatever lies under one can still be clicked
    for (const role of ['path', 'trigger', 'dark'] as const) {
      for (let i = objs.length - 1; i >= 0; i--) {
        if (role === 'trigger' && !zoneTrigger(i)) continue;
        if (objs[i].role === role && pointInPoly(p.x, p.y, objs[i].poly)) return { kind: 'object', i };
      }
    }
    return null;
  }

  /** Selected object indices in pick order (empty for zones / nothing) */
  private selIds(): number[] {
    return this.sel?.kind === 'objects' ? this.sel.ids : [];
  }

  /** The selected object when exactly one is selected */
  private selectedObject(): MapObject | null {
    const ids = this.selIds();
    return ids.length === 1 ? (this.map.objects[ids[0]] ?? null) : null;
  }

  private selectedIndex(): number {
    const ids = this.selIds();
    return ids.length === 1 ? ids[0] : -1;
  }

  /** Every object index that shares a group with any of `ids` (keeping `ids` first, in order) */
  private withGroups(ids: readonly number[]): number[] {
    const groups = new Set(ids.map((i) => this.map.objects[i]?.group).filter((g) => g !== undefined));
    const out = [...ids];
    if (groups.size) this.map.objects.forEach((o, i) => o.group !== undefined && groups.has(o.group) && !out.includes(i) && out.push(i));
    return out;
  }

  /** Select objects (indices are expanded to whole groups unless `exact`) */
  private selectObjects(ids: readonly number[], exact = false): void {
    const valid = [...new Set(ids)].filter((i) => i >= 0 && i < this.map.objects.length);
    const all = exact ? valid : this.withGroups(valid);
    this.sel = all.length ? { kind: 'objects', ids: all } : null;
    this.renderProps();
  }

  private selectZone(zone: 'start' | 'goal'): void {
    this.sel = { kind: zone };
    this.renderProps();
  }

  private clearSelection(): void {
    this.sel = null;
    this.renderProps();
  }

  /** Selected objects split into units that move / align together: each group, and each loose object */
  private selUnits(): number[][] {
    const units = new Map<string, number[]>();
    for (const i of this.selIds()) {
      const g = this.map.objects[i]?.group;
      const key = g === undefined ? `o${i}` : `g${g}`;
      const u = units.get(key);
      if (u) u.push(i);
      else units.set(key, [i]);
    }
    return [...units.values()];
  }

  /** Show a short message in the hint bar */
  private flash(text: string): void {
    this.flashMsg = { text, until: performance.now() + 2500 };
    this.updateHint();
    setTimeout(() => this.updateHint(), 2600);
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
    if (!o) return out; // no handles for multi-selections
    if (o.rotation) out.push({ h: { kind: 'pivot' }, p: o.rotation.pivot });
    o.motion?.points.forEach((p, j) => out.push({ h: { kind: 'marker', j }, p }));
    const s = o.shape;
    if (o.role === 'coin') return out; // fixed size: only route markers / pivot
    if (o.laser) {
      const b = shapeBounds(o.shape);
      const a = (o.laser.angle * Math.PI) / 180;
      const r = Math.max(b.w, b.h) / 2 + 22;
      out.unshift({ h: { kind: 'aim' }, p: { x: b.x + b.w / 2 + Math.cos(a) * r, y: b.y + b.h / 2 + Math.sin(a) * r } });
    }
    if (s.type === 'poly') s.points.forEach((p, j) => out.push({ h: { kind: 'vertex', j }, p }));
    else if (s.type === 'sector') {
      const at = (deg: number) => ({ x: s.cx + Math.cos((deg * Math.PI) / 180) * s.r, y: s.cy + Math.sin((deg * Math.PI) / 180) * s.r });
      out.push({ h: { kind: 'arc', part: 'radius' }, p: at(s.start + s.sweep / 2) });
      if (s.sweep < 360) {
        out.push({ h: { kind: 'arc', part: 'start' }, p: at(s.start) });
        out.push({ h: { kind: 'arc', part: 'end' }, p: at(s.start + s.sweep) });
      }
    } else rectCorners(shapeBounds(s)).forEach((p, j) => out.push({ h: { kind: 'corner', j }, p }));
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
      const hit = this.hitTest(raw);
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hit?.kind === 'object') {
        const ids = this.selIds();
        if (toggle) {
          // Add or remove the clicked object (with its group)
          const unit = this.withGroups([hit.i]);
          if (ids.includes(hit.i)) this.selectObjects(ids.filter((i) => !unit.includes(i)), true);
          else this.selectObjects([...ids, ...unit], true);
          return;
        }
        const already = ids.includes(hit.i);
        if (!already) this.selectObjects([hit.i]);
        this.startMove(raw, already ? hit.i : null);
        return;
      }
      if (hit) {
        if (toggle) return;
        this.selectZone(hit.kind);
        this.startMove(raw, null);
        return;
      }
      // Empty space: rubber-band selection
      const base = toggle ? this.selIds() : [];
      if (!toggle) this.clearSelection();
      this.drag = { type: 'marquee', x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y, add: toggle, base };
      return;
    }

    // Polygon / freeform tools place points one by one (spike, boulder and mirror tools drag instead)
    if (tool.kind === 'object' && (tool.shape === 'poly' || tool.shape === 'free') && !tool.special && tool.role !== 'mirror') {
      this.draft = { tool, points: [tool.shape === 'free' && !e.shiftKey ? { ...p, smooth: true } : p] };
      this.clearSelection();
      this.updateHint();
      return;
    }

    this.drag = { type: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, square: e.shiftKey };
  }

  private startMove(p0: Point, clicked: number | null): void {
    const zone = this.selectedZone();
    this.drag = {
      type: 'move', p0, before: JSON.stringify(this.map), moved: false, clicked,
      zone: zone ? clone(zone) : undefined,
      objs: this.selIds().map((i) => ({ i, o: clone(this.map.objects[i]) })),
    };
  }

  /** Points a dragged pivot snaps to: center of the bounds, center of mass, and the outline's corners */
  private pivotTargets(o: MapObject): { p: Point; label: string }[] {
    const s = o.shape;
    const out = [{ p: shapeCenter(s), label: 'Center' }];
    const c = shapeCentroid(s);
    if (Math.hypot(c.x - out[0].p.x, c.y - out[0].p.y) > 0.5) out.push({ p: c, label: 'Center of mass' });
    if (s.type === 'poly') s.points.forEach((v) => out.push({ p: { x: v.x, y: v.y }, label: 'Vertex' }));
    else if (s.type === 'sector') out.push({ p: { x: s.cx, y: s.cy }, label: 'Apex' });
    else {
      const b = shapeBounds(s);
      rectCorners(b).forEach((v) => out.push({ p: v, label: 'Corner' }));
      for (const [fx, fy] of [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) {
        out.push({ p: { x: b.x + b.w * fx, y: b.y + b.h * fy }, label: 'Edge middle' });
      }
    }
    return out;
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
      d.square = e.shiftKey || (this.tool.kind === 'object' && (this.tool.role === 'coin' || this.tool.role === 'portal' || isButton(this.tool.trigger)));
      return;
    }
    if (d.type === 'marquee') {
      d.x1 = raw.x;
      d.y1 = raw.y;
      return;
    }
    if (!d.moved) {
      // A tiny wobble while clicking isn't a move
      if (d.type === 'move' && Math.hypot(raw.x - d.p0.x, raw.y - d.p0.y) < 2 * unitsPerPx(this.el.canvas, this.map)) return;
      d.moved = true;
      this.snapshot(d.before);
    }

    if (d.type === 'move') {
      const zone = this.selectedZone();
      if (zone && d.zone) {
        zone.x = this.snapv(d.zone.x + raw.x - d.p0.x);
        zone.y = this.snapv(d.zone.y + raw.y - d.p0.y);
      } else if (d.objs?.length) {
        // Snap the combined bounds, so a multi-selection keeps its layout
        const b = objectsBounds(d.objs.map((x) => x.o));
        const dx = this.snapv(b.x + raw.x - d.p0.x) - b.x;
        const dy = this.snapv(b.y + raw.y - d.p0.y) - b.y;
        for (const { i, o } of d.objs) this.map.objects[i] = translateObject(o, dx, dy);
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
    if (h.kind === 'pivot' && o.rotation) {
      // Snap to the exact center / corners when close (hold Alt to place freely)
      const reach = PIVOT_SNAP_PX * unitsPerPx(this.el.canvas, this.map);
      let best: { p: Point; label: string } | null = null;
      let bestD = reach;
      if (!e.altKey) {
        for (const t of this.pivotTargets(o)) {
          const dist = Math.hypot(t.p.x - raw.x, t.p.y - raw.y);
          if (dist <= bestD) {
            bestD = dist;
            best = t;
          }
        }
      }
      this.pivotSnap = best;
      o.rotation.pivot = best ? { x: Math.round(best.p.x * 100) / 100, y: Math.round(best.p.y * 100) / 100 } : p;
    } else if (h.kind === 'aim' && o.laser) {
      const b = shapeBounds(o.shape);
      const deg = (Math.atan2(raw.y - (b.y + b.h / 2), raw.x - (b.x + b.w / 2)) * 180) / Math.PI;
      o.laser.angle = ((Math.round(this.el.snap.checked ? Math.round(deg / 15) * 15 : deg) % 360) + 360) % 360;
    } else if (h.kind === 'arc' && o.shape.type === 'sector') {
      const s = o.shape;
      const deg = (Math.atan2(raw.y - s.cy, raw.x - s.cx) * 180) / Math.PI;
      // Angles snap to 15° steps while Snap is on
      const ang = this.el.snap.checked ? Math.round(deg / 15) * 15 : Math.round(deg);
      const norm = (a: number) => ((a % 360) + 360) % 360;
      if (h.part === 'radius') s.r = Math.max(4, this.snapv(Math.hypot(raw.x - s.cx, raw.y - s.cy)));
      else if (h.part === 'start') {
        const end = s.start + s.sweep;
        s.sweep = norm(end - ang) || 360;
        s.start = norm(ang);
      } else {
        s.sweep = norm(ang - s.start) || 360;
      }
    } else if (h.kind === 'marker' && o.motion) o.motion.points[h.j] = p;
    else if (h.kind === 'vertex' && o.shape.type === 'poly') o.shape.points[h.j] = { ...o.shape.points[h.j], x: p.x, y: p.y };
    else if (h.kind === 'corner') {
      const opposite = rectCorners(shapeBounds(d.orig.shape))[(h.j + 2) % 4];
      let r = rectFromCorners(opposite, p);
      r.w = Math.max(2, r.w);
      r.h = Math.max(2, r.h);
      if (isSquare(o)) {
        // Switch buttons, portals and laser emitters stay square
        const s = Math.max(r.w, r.h);
        r = { x: p.x < opposite.x ? opposite.x - s : opposite.x, y: p.y < opposite.y ? opposite.y - s : opposite.y, w: s, h: s };
      }
      if (o.shape.type === 'rect') o.shape = { type: 'rect', ...r };
      else if (o.shape.type === 'ellipse') o.shape = { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
    }
    this.dirty();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.pivotSnap = null;
    if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type === 'marquee') {
      const r = rectFromCorners({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
      if (r.w < 2 && r.h < 2) return;
      // Objects entirely inside the box (PowerPoint style)
      const hits: number[] = [];
      this.map.objects.forEach((o, i) => {
        const b = shapeBounds(o.shape);
        if (b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h) hits.push(i);
      });
      this.selectObjects([...d.base, ...hits]);
      return;
    }
    if (d.type === 'move') {
      if (d.moved) return this.changed();
      // A click without dragging inside a multi-selection narrows it to the clicked group,
      // or from a whole group down to the clicked member
      if (d.clicked !== null && this.selIds().length > 1) {
        const unit = this.withGroups([d.clicked]);
        const ids = this.selIds();
        const same = unit.length === ids.length && unit.every((i) => ids.includes(i));
        if (same && unit.length > 1) this.selectObjects([d.clicked], true);
        else if (!same) this.selectObjects(unit, true);
      }
      return;
    }
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
      this.selectZone(tool.zone);
      return;
    }
    if (tool.kind !== 'object') return;

    if (tool.shape === 'sector') return this.addObject(tool, this.sectorFromDrag(d));
    if (tool.special === 'spike' || tool.role === 'mirror') return this.addObject(tool, this.lineShapeFromDrag(tool, d));
    if (tool.special === 'boulder') return this.addObject(tool, { type: 'poly', points: boulderShape(d.x0, d.y0, 26) });
    // Lasers 24×24 and portals 40×40, square, centered on the click
    if (tool.role === 'laser' || tool.role === 'portal') {
      const size = tool.role === 'laser' ? 24 : 40;
      r = { x: d.x0 - size / 2, y: d.y0 - size / 2, w: size, h: size };
    }
    // Coins are always 24×24, centered on the click
    if (tool.role === 'coin') r = { x: d.x0 - LIMITS.coinSize / 2, y: d.y0 - LIMITS.coinSize / 2, w: LIMITS.coinSize, h: LIMITS.coinSize };
    // A plain click drops a switch 40×40, an event zone 80×80, a door 120×20
    if (r.w < 4 && r.h < 4 && (tool.role === 'trigger' || tool.role === 'door')) {
      const [w, h] = tool.role === 'door' ? [120, 20] : isButton(tool.trigger) ? [40, 40] : [80, 80];
      r = { x: d.x0 - w / 2, y: d.y0 - h / 2, w, h };
    }
    // Grinders 48×48, saw blades 120×20, text boxes 200×50, safe zones 100×100
    if (r.w < 4 && r.h < 4 && (tool.special === 'disc' || tool.special === 'blade' || tool.role === 'text' || tool.role === 'safe')) {
      const [w, h] = tool.special === 'disc' ? [48, 48] : tool.special === 'blade' ? [120, 20] : tool.role === 'text' ? [200, 50] : [100, 100];
      r = { x: d.x0 - w / 2, y: d.y0 - h / 2, w, h };
    }
    if (tool.special === 'disc') {
      // Always round
      const s = Math.max(r.w, r.h);
      r = { x: r.x + r.w / 2 - s / 2, y: r.y + r.h / 2 - s / 2, w: s, h: s };
    }
    // A plain click (no drag) drops a default-sized shape
    if (r.w < 4 && r.h < 4) r = { x: d.x0 - 30, y: d.y0 - 30, w: 60, h: 60 };
    if (r.w < 2 || r.h < 2) return;
    const shape: Shape = tool.shape === 'ellipse'
      ? { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 }
      : { type: 'rect', ...r };
    this.addObject(tool, shape);
  }

  /** Spike: drag from the base to the tip. Mirror: drag from one end to the other */
  private lineShapeFromDrag(tool: ObjectTool, d: { x0: number; y0: number; x1: number; y1: number }): Shape {
    const a = { x: d.x0, y: d.y0 };
    let b = { x: d.x1, y: d.y1 };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 6) b = tool.special === 'spike' ? { x: a.x, y: a.y - 60 } : { x: a.x + 80, y: a.y };
    if (tool.special === 'spike') return { type: 'poly', points: spikeShape(a, b, 16) };
    // A thin plate along the line
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (-(b.y - a.y) / len) * 3;
    const ny = ((b.x - a.x) / len) * 3;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      type: 'poly',
      points: [
        { x: r(a.x + nx), y: r(a.y + ny) }, { x: r(b.x + nx), y: r(b.y + ny) },
        { x: r(b.x - nx), y: r(b.y - ny) }, { x: r(a.x - nx), y: r(a.y - ny) },
      ],
    };
  }

  /** Sector tool: drag from the apex outward; the drag direction is the middle of a 90° slice */
  private sectorFromDrag(d: { x0: number; y0: number; x1: number; y1: number }): Shape {
    let r = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
    let dir = (Math.atan2(d.y1 - d.y0, d.x1 - d.x0) * 180) / Math.PI;
    if (r < 4) {
      r = 60;
      dir = -90; // a plain click: a slice pointing up
    }
    if (this.el.snap.checked) dir = Math.round(dir / 15) * 15;
    return { type: 'sector', cx: d.x0, cy: d.y0, r: Math.round(r), start: (((dir - 45) % 360) + 360) % 360, sweep: 90 };
  }

  private closeDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft || draft.points.length < 3) return this.updateHint();
    const shape: Shape = draft.tool.shape === 'free'
      ? { type: 'poly', points: draft.points, free: true }
      : { type: 'poly', points: draft.points };
    this.addObject(draft.tool, shape);
  }

  private addObject(tool: ObjectTool, shape: Shape): void {
    if (this.map.objects.length >= LIMITS.maxObjects) return;
    const o: MapObject = { role: tool.role, shape };
    if (tool.behavior === 'rotating') o.rotation = defaultRotation(o);
    if (tool.behavior === 'moving') o.motion = { ...DEFAULT_MOTION, points: [] };
    if (tool.role === 'trigger') {
      const kind = tool.trigger ?? 'switch';
      o.trigger = { kind, color: this.lastColor };
      if (kind === 'timer') o.trigger.duration = 3000;
      if (kind === 'hold') o.trigger.duration = 1000;
    }
    if (tool.role === 'door') o.door = { mode: 'auto', color: this.lastColor, moveMs: 600, waitMs: 1000 };
    if (tool.special === 'boulder') o.boulder = true;
    if (tool.special === 'disc') o.saw = { kind: 'disc', clockwise: true, spin: 720, stroke: 0, strokeMs: 0 };
    if (tool.special === 'blade') o.saw = { kind: 'blade', clockwise: true, spin: 0, stroke: 24, strokeMs: 400 };
    if (tool.role === 'text') o.text = { text: 'Text', color: '#243450', font: 'main', size: 24, bold: true, align: 'center', outlineWidth: 3, background: '#ffffffb3' };
    if (tool.special === 'spike' && shape.type === 'poly') {
      const [tip, b1, b2] = shape.points;
      const base = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
      const reach = Math.round(Math.hypot(tip.x - base.x, tip.y - base.y));
      o.spike = { angle: Math.round((Math.atan2(tip.y - base.y, tip.x - base.x) * 180) / Math.PI), reach, thrustMs: 120, returnMs: 900, waitMs: 900, delay: 0 };
    }
    if (tool.role === 'laser') o.laser = { color: this.lastColor, angle: 0, on: true };
    if (tool.role === 'portal') {
      const same = this.map.objects.filter((m) => m.portal?.color === this.lastColor).length;
      o.portal = { color: this.lastColor, order: same, mode: 'both' };
    }
    this.edit(() => this.map.objects.push(o));
    const i = this.map.objects.length - 1;
    if (tool.behavior === 'moving') this.markerMode = i;
    this.selectObjects([i], true);
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
    if (e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    // Letters by physical key (e.code), so shortcuts also work with a non-Latin IME such as Korean
    const code = e.code;
    const letter = code.startsWith('Key') ? code.slice(3).toLowerCase() : e.key.toLowerCase();

    if (this.helpBox && !this.helpBox.hidden) {
      if (e.key === 'Escape' || e.key === '?' || code === 'Slash') {
        e.preventDefault();
        this.toggleHelp(false);
      }
      return;
    }

    const arrow = ARROWS[e.key];
    if (arrow && !mod) {
      if (this.draft || this.markerMode !== null || !this.sel) return;
      e.preventDefault();
      const step = (this.el.snap.checked ? GRID : 1) * (e.shiftKey ? 10 : 1);
      this.nudge(arrow[0] * step, arrow[1] * step);
      return;
    }

    if (mod) {
      const cmds = this.commands();
      const run = (c: Command) => {
        e.preventDefault();
        if (c.enabled) c.run();
      };
      if (code === 'BracketRight') return run(e.shiftKey ? cmds.front : cmds.forward);
      if (code === 'BracketLeft') return run(e.shiftKey ? cmds.back : cmds.backward);
      if (!['z', 'y', 'd', 'c', 'x', 'v', 'a', 'g'].includes(letter)) return;
      // Leave the browser's own copy / paste alone when there is nothing of ours to act on
      if ((letter === 'c' || letter === 'x') && !cmds.copy.enabled) return;
      if (letter === 'v' && !cmds.paste.enabled) return;
      e.preventDefault();
      if (letter === 'z') {
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (letter === 'y') this.redo();
      else if (letter === 'd') run(cmds.duplicate);
      else if (letter === 'c') run(cmds.copy);
      else if (letter === 'x') run(cmds.cut);
      else if (letter === 'v') run(cmds.paste);
      else if (letter === 'a') run(cmds.selectAll);
      else if (letter === 'g') run(e.shiftKey ? cmds.ungroup : cmds.group);
      return;
    }

    if (e.key === '?' || (code === 'Slash' && e.shiftKey)) {
      e.preventDefault();
      this.toggleHelp(true);
    } else if (e.key === 'Tab') {
      if (this.draft || this.markerMode !== null) return;
      e.preventDefault();
      this.cycleSelection(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter') {
      if (this.draft) this.closeDraft();
      else this.finishModes();
    } else if (e.key === 'Escape') {
      if (this.draft || this.markerMode !== null) this.finishModes();
      else this.clearSelection();
    } else if (e.key === 'Backspace' && this.draft) {
      this.draft.points.pop();
      if (this.draft.points.length === 0) this.draft = null;
      this.updateHint();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (e.repeat) {
      // Tool and toggle keys shouldn't fire repeatedly while held
    } else if (letter === 'v') {
      this.setTool({ kind: 'select' });
    } else if (code >= 'Digit1' && code <= 'Digit4') {
      this.setTool({ ...this.lastObjectTool, shape: SHAPES[Number(code.slice(5)) - 1][0] });
    } else if (letter === 'w') {
      const t = this.lastObjectTool;
      this.setTool({ ...t, role: t.role === 'path' ? 'wall' : 'path' });
    } else if (letter === 'm' || letter === 'r') {
      const t = this.lastObjectTool;
      const want: Behavior = letter === 'm' ? 'moving' : 'rotating';
      // Pressing again while that tool is active returns to a static object
      const active = this.tool.kind === 'object' && t.behavior === want;
      this.setTool({ ...t, behavior: active ? 'static' : want });
    } else if (letter === 's') {
      this.setTool({ kind: 'zone', zone: 'start' });
    } else if (letter === 'g') {
      this.setTool({ kind: 'zone', zone: 'goal' });
    } else if (letter === 'n') {
      this.el.snap.click();
    } else if (letter === 'p') {
      this.el.preview.click();
    } else if (letter === 't') {
      this.el.test.click();
    }
  }

  /** Move the selection by (dx, dy); a burst of nudges is one undo step */
  private nudge(dx: number, dy: number): void {
    const s = this.sel;
    if (!s) return;
    const key = JSON.stringify(s);
    const now = performance.now();
    const coalesce = this.lastNudge && this.lastNudge.key === key && now - this.lastNudge.t < 1000;
    if (!coalesce) this.snapshot();
    if (s.kind === 'objects') {
      for (const i of s.ids) this.map.objects[i] = translateObject(this.map.objects[i], dx, dy);
    } else {
      const zone = this.selectedZone()!;
      zone.x += dx;
      zone.y += dy;
    }
    this.lastNudge = { key, t: now };
    this.changed();
  }

  /** Tab / Shift+Tab: step through START, GOAL and every object */
  private cycleSelection(dir: 1 | -1): void {
    const all: Selection[] = [{ kind: 'start' }, { kind: 'goal' }, ...this.map.objects.map((_, i) => ({ kind: 'objects' as const, ids: [i] }))];
    const cur = all.findIndex((s) => JSON.stringify(s) === JSON.stringify(this.sel));
    const next = cur < 0 ? (dir > 0 ? 0 : all.length - 1) : (cur + dir + all.length) % all.length;
    if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
    this.sel = all[next];
    this.renderProps();
  }

  private copySelected(): boolean {
    const ids = [...this.selIds()].sort((a, b) => a - b);
    if (!ids.length) return false;
    this.clipboard = { objs: ids.map((i) => clone(this.map.objects[i])), pastes: 0 };
    return true;
  }

  /** Append copies of objects (offset), with fresh group ids, and select them */
  private insertCopies(objs: readonly MapObject[], off: number): void {
    const room = LIMITS.maxObjects - this.map.objects.length;
    if (room <= 0) return this.flash(`A map can have at most ${LIMITS.maxObjects} objects`);
    const fresh = new Map<number, number>();
    let next = this.nextGroupId();
    const copies = objs.slice(0, room).map((o) => {
      const c = translateObject(o, off, off);
      if (c.group !== undefined) {
        if (!fresh.has(c.group)) fresh.set(c.group, next++);
        c.group = fresh.get(c.group);
      }
      return c;
    });
    this.finishModes();
    const start = this.map.objects.length;
    this.edit(() => this.map.objects.push(...copies));
    if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
    this.selectObjects(copies.map((_, k) => start + k), true);
  }

  private paste(): void {
    const c = this.clipboard;
    if (!c) return;
    c.pastes++;
    this.insertCopies(c.objs, GRID * 2 * c.pastes);
  }

  private nextGroupId(): number {
    return this.map.objects.reduce((m, o) => Math.max(m, o.group ?? 0), 0) + 1;
  }

  // ───────────────────────── Arrange commands ─────────────────────────

  /** Everything the context menu, shortcuts and properties panel can do with the selection */
  private commands(): Record<CommandId, Command> {
    const ids = this.selIds();
    const objs = this.map.objects;
    const n = ids.length;
    const units = this.selUnits();
    const zone = this.selectedZone();
    const groupedSel = ids.some((i) => objs[i].group !== undefined);
    const oneGroup = n > 1 && objs[ids[0]].group !== undefined && ids.every((i) => objs[i].group === objs[ids[0]].group);
    const rotating = ids.filter((i) => objs[i].rotation);
    const lu = this.lastUngrouped;
    const canRegroup = !!lu && lu.count === objs.length && lu.ids.every((i) => objs[i] && objs[i].group === undefined);
    const toMap = this.alignToMap || (zone ? true : units.length < 2);
    const cmd = (label: string, enabled: boolean, run: () => void, keys?: string): Command => ({ label, enabled, run, keys });
    const align = (mode: AlignMode, label: string) => cmd(label, n > 0 || !!zone, () => this.align(mode));
    const mergeable = ids.every((i) => (objs[i].role === 'path' || objs[i].role === 'wall' || objs[i].role === 'dark') && !objs[i].spike && !objs[i].boulder && !objs[i].saw);
    const merge = (op: MergeOp, label: string) => cmd(label, n >= 2 && mergeable, () => this.merge(op));
    return {
      cut: cmd('Cut', n > 0, () => this.copySelected() && this.deleteSelected(), 'Ctrl+X'),
      copy: cmd('Copy', n > 0, () => this.copySelected(), 'Ctrl+C'),
      paste: cmd('Paste', !!this.clipboard, () => this.paste(), 'Ctrl+V'),
      duplicate: cmd('Duplicate', n > 0, () => this.duplicateSelected(), 'Ctrl+D'),
      delete: { ...cmd('Delete', n > 0, () => this.deleteSelected(), 'Del'), danger: true },

      selectAll: cmd('Select all', objs.length > 0, () => this.selectObjects(objs.map((_, i) => i), true), 'Ctrl+A'),
      selectPaths: cmd('All paths', objs.some((o) => o.role === 'path'), () => this.selectObjects(this.indicesWhere((o) => o.role === 'path'), true)),
      selectWalls: cmd('All walls', objs.some((o) => o.role === 'wall'), () => this.selectObjects(this.indicesWhere((o) => o.role === 'wall'), true)),
      selectSame: cmd('Same kind as this', n > 0, () => {
        const id = objectToolId(objs[ids[0]]);
        this.selectObjects(this.indicesWhere((o) => objectToolId(o) === id), true);
      }),

      front: cmd('Bring to front', n > 0, () => this.order('front'), 'Ctrl+Shift+]'),
      forward: cmd('Bring forward', n > 0, () => this.order('forward'), 'Ctrl+]'),
      backward: cmd('Send backward', n > 0, () => this.order('backward'), 'Ctrl+['),
      back: cmd('Send to back', n > 0, () => this.order('back'), 'Ctrl+Shift+['),

      alignLeft: align('left', 'Align left'),
      alignCenter: align('center', 'Align center'),
      alignRight: align('right', 'Align right'),
      alignTop: align('top', 'Align top'),
      alignMiddle: align('middle', 'Align middle'),
      alignBottom: align('bottom', 'Align bottom'),
      distH: cmd('Distribute horizontally', toMap ? n > 0 : units.length >= 3, () => this.distribute('x')),
      distV: cmd('Distribute vertically', toMap ? n > 0 : units.length >= 3, () => this.distribute('y')),
      alignToMap: { ...cmd('Align to map', true, () => (this.alignToMap = !this.alignToMap)), checked: this.alignToMap },

      rotCW: cmd('Rotate right 90°', n > 0, () => this.turn('cw')),
      rotCCW: cmd('Rotate left 90°', n > 0, () => this.turn('ccw')),
      flipV: cmd('Flip vertical', n > 0, () => this.turn('flipV')),
      flipH: cmd('Flip horizontal', n > 0, () => this.turn('flipH')),

      group: cmd('Group', n >= 2 && !oneGroup, () => this.groupSelected(), 'Ctrl+G'),
      ungroup: cmd('Ungroup', groupedSel, () => this.ungroupSelected(), 'Ctrl+Shift+G'),
      regroup: cmd('Regroup', canRegroup, () => this.regroup()),

      union: merge('union', 'Union'),
      combine: merge('combine', 'Combine'),
      fragment: merge('fragment', 'Fragment'),
      intersect: merge('intersect', 'Intersect'),
      subtract: merge('subtract', 'Subtract'),

      pivotCenter: cmd('Pivot to center', rotating.length > 0, () => this.setPivots(false)),
      pivotCentroid: cmd('Pivot to center of mass', rotating.length > 0 && rotating.some((i) => objs[i].shape.type === 'poly'), () => this.setPivots(true)),

      makePath: cmd('Make path', ids.some((i) => objs[i].role === 'wall' && !objs[i].saw), () => this.edit(() => ids.forEach((i) => objs[i].role === 'wall' && !objs[i].saw && (objs[i].role = 'path')))),
      makeWall: cmd('Make wall', ids.some((i) => objs[i].role === 'path'), () => this.edit(() => ids.forEach((i) => objs[i].role === 'path' && (objs[i].role = 'wall')))),
    };
  }

  private indicesWhere(f: (o: MapObject) => boolean): number[] {
    const out: number[] = [];
    this.map.objects.forEach((o, i) => f(o) && out.push(i));
    return out;
  }

  private order(op: ZOrder): void {
    const ids = this.selIds();
    if (!ids.length) return;
    const old = this.map.objects;
    const order = reorder(old.length, ids, op);
    if (order.every((k, i) => k === i)) return;
    this.edit(() => (this.map.objects = order.map((k) => old[k])));
    this.lastUngrouped = null;
    this.selectObjects(ids.map((i) => order.indexOf(i)), true);
  }

  private align(mode: AlignMode): void {
    const full: Rect = { x: 0, y: 0, w: this.map.width, h: this.map.height };
    const zone = this.selectedZone();
    if (zone) {
      const d = alignOffset(zone, full, mode);
      this.edit(() => {
        zone.x = Math.round(zone.x + d.x);
        zone.y = Math.round(zone.y + d.y);
      });
      return;
    }
    const units = this.selUnits();
    if (!units.length) return;
    const objs = this.map.objects;
    const rects = units.map((u) => objectsBounds(u.map((i) => objs[i])));
    const to = this.alignToMap || units.length < 2 ? full : unionRect(rects);
    this.edit(() => units.forEach((u, k) => {
      const d = alignOffset(rects[k], to, mode);
      for (const i of u) objs[i] = translateObject(objs[i], d.x, d.y);
    }));
  }

  private distribute(axis: 'x' | 'y'): void {
    const units = this.selUnits();
    const objs = this.map.objects;
    const rects = units.map((u) => objectsBounds(u.map((i) => objs[i])));
    const toMap = this.alignToMap || units.length < 3;
    if (!units.length || (!toMap && units.length < 3)) return;
    const offs = distributeOffsets(rects, axis, toMap ? { x: 0, y: 0, w: this.map.width, h: this.map.height } : undefined);
    this.edit(() => units.forEach((u, k) => {
      for (const i of u) objs[i] = translateObject(objs[i], offs[k].x, offs[k].y);
    }));
  }

  /** Rotate / flip each unit (a group, or a loose object) about its own center */
  private turn(t: Turn): void {
    const units = this.selUnits();
    if (!units.length) return;
    const objs = this.map.objects;
    this.edit(() => units.forEach((u) => {
      const out = turnObjects(u.map((i) => objs[i]), t);
      u.forEach((i, k) => (objs[i] = out[k]));
    }));
  }

  private groupSelected(): void {
    const ids = this.selIds();
    if (ids.length < 2) return;
    const id = this.nextGroupId();
    this.edit(() => ids.forEach((i) => (this.map.objects[i].group = id)));
    this.lastUngrouped = null;
    this.renderProps();
  }

  private ungroupSelected(): void {
    const ids = this.selIds().filter((i) => this.map.objects[i].group !== undefined);
    if (!ids.length) return;
    this.edit(() => ids.forEach((i) => delete this.map.objects[i].group));
    this.lastUngrouped = { ids, count: this.map.objects.length };
    this.renderProps();
  }

  private regroup(): void {
    const lu = this.lastUngrouped;
    if (!lu) return;
    const id = this.nextGroupId();
    this.edit(() => lu.ids.forEach((i) => (this.map.objects[i].group = id)));
    this.lastUngrouped = null;
    if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
    this.selectObjects(lu.ids, true);
  }

  private setPivots(centroid: boolean): void {
    const objs = this.map.objects;
    this.edit(() => this.selIds().forEach((i) => {
      const r = objs[i].rotation;
      if (!r) return;
      const c = centroid ? shapeCentroid(objs[i].shape) : shapeCenter(objs[i].shape);
      r.pivot = { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 };
    }));
  }

  /**
   * PowerPoint-style merge. The result takes its type, movement and rotation from the first
   * selected object, and is always a freeform shape. Several separate pieces are grouped
   * (except for Fragment, which is meant to break shapes apart).
   */
  private merge(op: MergeOp): void {
    const ids = this.selIds();
    if (ids.length < 2) return;
    const objs = this.map.objects;
    const first = objs[ids[0]];
    let results: Shape[][];
    try {
      results = mergeShapes(op, ids.map((i) => objs[i].shape), LIMITS.maxPolyPoints);
    } catch {
      return this.flash('These shapes could not be merged');
    }
    if (!results.length) return this.flash(op === 'intersect' ? 'The shapes do not overlap, so nothing is left' : 'Nothing is left after merging');
    const made: MapObject[] = [];
    let gid = this.nextGroupId();
    const oldCenter = shapeCenter(first.shape);
    for (const shapes of results) {
      const group = op !== 'fragment' && shapes.length > 1 ? gid++ : undefined;
      for (const shape of shapes) {
        const o: MapObject = { role: first.role, shape };
        // Keep the route's offsets: the anchor is the shape center, which the merge moves
        if (first.motion) {
          const c = shapeCenter(shape);
          const m = clone(first.motion);
          m.points = m.points.map((p) => ({ x: p.x + c.x - oldCenter.x, y: p.y + c.y - oldCenter.y }));
          o.motion = m;
        }
        if (first.rotation) o.rotation = clone(first.rotation);
        if (group !== undefined) o.group = group;
        made.push(o);
      }
    }
    const remove = new Set(ids);
    const kept = objs.filter((_, i) => !remove.has(i));
    if (kept.length + made.length > LIMITS.maxObjects) return this.flash(`A map can have at most ${LIMITS.maxObjects} objects`);
    // Results take the first selected object's place in the drawing order
    const at = objs.slice(0, ids[0]).filter((_, i) => !remove.has(i)).length;
    this.finishModes();
    this.edit(() => (this.map.objects = [...kept.slice(0, at), ...made, ...kept.slice(at)]));
    this.lastUngrouped = null;
    this.selectObjects(made.map((_, k) => at + k), true);
    if (op === 'fragment') this.flash(`Split into ${made.length} pieces`);
  }

  // ───────────────────────── Context menu ─────────────────────────

  private onContextMenu(e: MouseEvent): void {
    if (!this.visible) return;
    const x = e.clientX;
    const y = e.clientY;
    if (this.draft) {
      const pts = this.draft.points.length;
      return openContextMenu(x, y, [
        { label: 'Finish shape', keys: 'Enter', disabled: pts < 3, action: () => this.closeDraft() },
        { label: 'Remove last point', keys: 'Backspace', action: () => {
          this.draft?.points.pop();
          if (this.draft && !this.draft.points.length) this.draft = null;
          this.updateHint();
        } },
        { label: 'Cancel', keys: 'Esc', action: () => this.finishModes() },
      ]);
    }
    if (this.markerMode !== null) {
      return openContextMenu(x, y, [{ label: 'Done placing markers', keys: 'Enter', action: () => this.finishModes() }]);
    }

    // Right-clicking something outside the selection selects it first
    const hit = this.hitTest(this.pointer(e));
    if (hit?.kind === 'object') {
      if (!this.selIds().includes(hit.i)) {
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
        this.selectObjects([hit.i]);
      }
    } else if (hit) {
      if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
      this.selectZone(hit.kind);
    } else {
      this.clearSelection();
    }

    const c = this.commands();
    const item = (k: CommandId): MenuItem => ({
      label: c[k].label, keys: c[k].keys, disabled: !c[k].enabled, action: c[k].run, checked: c[k].checked, danger: c[k].danger,
    });
    const sub = (label: string, items: MenuItem[]): MenuItem => ({
      label, submenu: items, disabled: items.every((it) => it === 'sep' || it.disabled),
    });
    const alignMenu = sub('Align', [
      item('alignLeft'), item('alignCenter'), item('alignRight'), 'sep',
      item('alignTop'), item('alignMiddle'), item('alignBottom'), 'sep',
      item('distH'), item('distV'), 'sep', item('alignToMap'),
    ]);
    const selectMenu = sub('Select', [item('selectAll'), item('selectPaths'), item('selectWalls'), item('selectSame')]);
    const help: MenuItem = { label: 'Keyboard shortcuts', keys: '?', action: () => this.toggleHelp(true) };

    if (this.selectedZone()) {
      return openContextMenu(x, y, [alignMenu, 'sep', selectMenu, item('paste'), 'sep', help]);
    }
    if (!this.selIds().length) {
      return openContextMenu(x, y, [item('paste'), selectMenu, 'sep', help]);
    }
    openContextMenu(x, y, [
      item('cut'), item('copy'), item('paste'), item('duplicate'), 'sep',
      sub('Bring to front', [item('front'), item('forward')]),
      sub('Send to back', [item('back'), item('backward')]),
      alignMenu,
      sub('Rotate', [item('rotCW'), item('rotCCW'), 'sep', item('flipV'), item('flipH')]),
      sub('Group', [item('group'), item('ungroup'), item('regroup')]),
      sub('Merge shapes', [item('union'), item('combine'), item('fragment'), item('intersect'), item('subtract')]),
      'sep',
      sub('Rotation pivot', [item('pivotCenter'), item('pivotCentroid')]),
      sub('Type', [item('makePath'), item('makeWall')]),
      selectMenu,
      'sep',
      item('delete'),
    ]);
  }

  /** Shortcut list overlay (?); built on first use */
  private toggleHelp(show?: boolean): void {
    if (!this.helpBox) {
      if (show === false) return;
      const box = document.createElement('div');
      box.className = 'shortcut-help';
      box.hidden = true;
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Keyboard shortcuts');
      const card = document.createElement('div');
      card.className = 'shortcut-card';
      const head = document.createElement('div');
      head.className = 'shortcut-head';
      const h = document.createElement('h3');
      h.textContent = 'Keyboard shortcuts';
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.title = 'Close (Esc)';
      close.addEventListener('click', () => this.toggleHelp(false));
      head.append(h, close);
      card.append(head);
      for (const [title, rows] of SHORTCUTS) {
        const sec = document.createElement('section');
        const h4 = document.createElement('h4');
        h4.textContent = title;
        const dl = document.createElement('dl');
        for (const [keys, what] of rows) {
          const dt = document.createElement('dt');
          keys.split(' / ').forEach((k, n) => {
            if (n) dt.append(' / ');
            k.split('+').forEach((part, m) => {
              if (m) dt.append('+');
              const kbd = document.createElement('kbd');
              kbd.textContent = part;
              dt.append(kbd);
            });
          });
          const dd = document.createElement('dd');
          dd.textContent = what;
          dl.append(dt, dd);
        }
        sec.append(h4, dl);
        card.append(sec);
      }
      box.append(card);
      box.addEventListener('pointerdown', (e) => {
        if (e.target === box) this.toggleHelp(false);
      });
      (this.el.canvas.closest('.editor-view') ?? document.body).append(box);
      this.helpBox = box;
    }
    const open = show ?? this.helpBox.hidden;
    this.helpBox.hidden = !open;
    this.el.shortcuts.setAttribute('aria-pressed', String(open));
  }

  private deleteSelected(): void {
    const ids = new Set(this.selIds());
    if (!ids.size) return;
    this.finishModes();
    this.edit(() => (this.map.objects = this.map.objects.filter((_, i) => !ids.has(i))));
    this.lastUngrouped = null;
    this.clearSelection();
  }

  private duplicateSelected(): void {
    const ids = [...this.selIds()].sort((a, b) => a - b);
    if (!ids.length) return;
    this.insertCopies(ids.map((i) => this.map.objects[i]), GRID * 2);
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
      const z = this.sel?.kind === 'start' ? 'start' : 'goal';
      title.textContent = `ID ${ZONE_IDS[z]} · ${z === 'start' ? 'START area' : 'GOAL area'}`;
      box.replaceChildren(title, this.rectFields(zone));
      return;
    }
    const ids = this.selIds();
    if (ids.length > 1) {
      box.replaceChildren(...this.multiProps(ids));
      return;
    }
    const o = this.selectedObject();
    if (!o) {
      box.replaceChildren(this.note('Pick a tool from the palette, or select an object with the Select tool (V). Drag on empty space to select several.'));
      return;
    }
    const idx = ids[0];
    const title = document.createElement('h4');
    title.textContent = `#${idx + 1} · ID ${objectToolId(o)} · ${describeObject(o)}${o.group !== undefined ? ` · Group ${o.group}` : ''}`;
    const parts: HTMLElement[] = [title];

    if ((o.role === 'path' || o.role === 'wall') && !o.saw) {
      parts.push(this.group(
        this.selectField<Role>('Type', o.role, [['path', 'Path (safe floor)'], ['wall', 'Wall (deadly)']], (v) => (o.role = v), true),
      ));
    } else if (o.role === 'coin' || o.role === 'dark') {
      parts.push(this.note(o.role === 'coin'
        ? 'Touch every coin before GOAL opens. Coins can move and rotate like other objects.'
        : 'Hides the cursor and its trail while they are inside it. Shown see-through in the editor.'));
    } else if (o.role === 'safe') {
      parts.push(this.note('Nothing can hurt the cursor in here: walls, obstacles, saws and lasers passing through are harmless, and it counts as floor.'));
    }

    // Shape
    const s = o.shape;
    if (s.type === 'rect') {
      parts.push(this.group(
        this.numField('X', s.x, (v) => (s.x = Math.round(v))),
        this.numField('Y', s.y, (v) => (s.y = Math.round(v))),
        this.numField('Width', s.w, (v) => (s.w = Math.max(1, Math.round(v)))),
        this.numField('Height', s.h, (v) => (s.h = Math.max(1, Math.round(v)))),
      ));
    } else if (o.role === 'coin' && s.type === 'ellipse') {
      parts.push(this.group(
        this.numField('Center X', s.cx, (v) => (s.cx = Math.round(v))),
        this.numField('Center Y', s.cy, (v) => (s.cy = Math.round(v))),
      ));
    } else if (s.type === 'ellipse') {
      parts.push(this.group(
        this.numField('Center X', s.cx, (v) => (s.cx = Math.round(v))),
        this.numField('Center Y', s.cy, (v) => (s.cy = Math.round(v))),
        this.numField('Radius X', s.rx, (v) => (s.rx = Math.max(1, Math.round(v)))),
        this.numField('Radius Y', s.ry, (v) => (s.ry = Math.max(1, Math.round(v)))),
      ));
    } else if (s.type === 'sector') {
      parts.push(this.group(
        this.numField('Apex X', s.cx, (v) => (s.cx = Math.round(v))),
        this.numField('Apex Y', s.cy, (v) => (s.cy = Math.round(v))),
        this.numField('Radius', s.r, (v) => (s.r = Math.max(1, Math.round(v)))),
        this.numField('Start angle (°)', s.start, (v) => (s.start = ((Math.round(v) % 360) + 360) % 360), 15),
        this.numField('Sweep (°)', s.sweep, (v) => (s.sweep = Math.min(360, Math.max(1, Math.round(v)))), 15),
      ));
      parts.push(this.note('0° points right, 90° down. Drag the arc ends to change the angles, the arc middle for the radius.'));
    } else {
      const curved = s.points.filter((p) => p.smooth).length;
      parts.push(this.note(`${s.points.length} vertices (${curved} curved). Double-click a vertex to toggle curve.`));
    }

    if (o.trigger) parts.push(...this.triggerProps(o));
    if (o.door) parts.push(...this.doorProps(o));
    if (o.spike) parts.push(...this.spikeProps(o));
    if (o.saw) parts.push(...this.sawProps(o));
    if (o.text) parts.push(...this.textProps(o));
    if (o.boulder) parts.push(this.heading('Rolling boulder'), this.note(o.motion ? 'Rolls along its route: it spins by the distance it travels.' : 'Give it a route under Movement (Place markers) so it can roll.'));
    if (o.laser) parts.push(...this.laserProps(o));
    if (o.portal) parts.push(...this.portalProps(o));
    if (o.role === 'mirror') parts.push(this.heading('Mirror'), this.note('Laser beams bounce off every side. Drag its corners to angle it, or make it move or rotate.'));
    if (o.role === 'path' || o.role === 'wall' || o.role === 'coin' || o.role === 'dark' || o.role === 'mirror') parts.push(...this.linkProps(o));

    // Movement (a spike's thrust is its movement)
    if (!o.spike) {
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

    }

    // Rotation (a boulder spins by rolling, a saw by itself)
    if (!o.boulder && !o.saw) {
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

    }

    parts.push(...this.arrangeProps(false));
    parts.push(this.actions(
      this.button('Duplicate', () => this.duplicateSelected()),
      this.button('Delete', () => this.deleteSelected(), 'danger'),
    ));
    box.replaceChildren(...parts);
  }

  /** 16 color swatches */
  private colorPicker(value: number, apply: (c: number) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    wrap.setAttribute('role', 'radiogroup');
    SWITCH_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === value));
      b.addEventListener('click', () => {
        this.lastColor = i;
        this.edit(() => apply(i));
      });
      wrap.append(b);
    });
    return wrap;
  }

  private triggerProps(o: MapObject): HTMLElement[] {
    const t = o.trigger!;
    const out: HTMLElement[] = [this.heading(TRIGGER_NAMES[t.kind]), this.colorPicker(t.color, (c) => (t.color = c))];
    const fields: HTMLElement[] = [];
    if (t.kind === 'switch' || t.kind === 'timer') {
      fields.push(this.selectField('Pressed by', t.click ? 'click' : 'touch', [['touch', 'Touching it'], ['click', 'Clicking on it']], (v) => {
        if (v === 'click') t.click = true;
        else delete t.click;
      }));
    }
    if (t.kind === 'timer' || t.kind === 'hold') {
      fields.push(this.numField(t.kind === 'timer' ? 'ON for (s)' : 'Hold for (s)', (t.duration ?? 1000) / 1000,
        (v) => (t.duration = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.1));
    }
    if (fields.length) out.push(this.group(...fields));
    if (t.kind === 'switch' || t.kind === 'hold') {
      out.push(this.toggle('Starts ON', !!t.initial, (on) => {
        if (on) t.initial = true;
        else delete t.initial;
      }));
    }
    if (isButton(t.kind)) {
      out.push(this.toggle('Can be switched back', !t.once, (on) => {
        if (on) delete t.once;
        else t.once = true;
      }));
    }
    const linked = this.map.objects.filter((m) => m.link?.color === t.color || (m.door?.mode === 'switch' && m.door.color === t.color)).length;
    const what = {
      switch: 'Each press turns the color ON or OFF.',
      timer: 'Turns the color ON; it goes OFF again when the time runs out.',
      hold: 'Stay on it to switch the color ON or OFF; the wipe shows your progress.',
      startZone: 'Entering it turns the color ON.',
      stopZone: 'Entering it turns the color OFF.',
    }[t.kind];
    out.push(this.note(`${what} ${linked} object${linked === 1 ? ' is' : 's are'} linked to ${switchColor(t.color).name}.`));
    return out;
  }

  private spikeProps(o: MapObject): HTMLElement[] {
    const s = o.spike!;
    const sec = (v: number) => v / 1000;
    const ms = (v: number) => Math.round(Math.min(LIMITS.maxDelay, Math.max(0.01, v)) * 1000);
    return [
      this.heading('Spike stake'),
      this.group(
        this.numField('Direction (°)', s.angle, (v) => (s.angle = ((Math.round(v) % 360) + 360) % 360), 15),
        this.numField('Reach', s.reach, (v) => (s.reach = Math.max(1, Math.round(v))), 5),
        this.numField('Thrust (s)', sec(s.thrustMs), (v) => (s.thrustMs = ms(v)), 0.05),
        this.numField('Return (s)', sec(s.returnMs), (v) => (s.returnMs = ms(v)), 0.1),
        this.numField('Rest (s)', sec(s.waitMs), (v) => (s.waitMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0, v)) * 1000)), 0.1),
        this.numField('Start delay (s)', sec(s.delay), (v) => (s.delay = Math.round(Math.max(-LIMITS.maxDelay, Math.min(LIMITS.maxDelay, v)) * 1000)), 0.1),
      ),
      this.note('Rests, thrusts out fast, then slides back slowly. The dashed line shows how far it reaches.'),
    ];
  }

  private sawProps(o: MapObject): HTMLElement[] {
    const s = o.saw!;
    if (s.kind === 'disc') {
      return [
        this.heading('Circular grinder'),
        this.group(
          this.selectField('Spin', s.clockwise ? 'cw' : 'ccw', DIRECTION_OPTIONS, (v) => (s.clockwise = v === 'cw')),
          this.numField('Speed (°/s)', s.spin, (v) => (s.spin = Math.min(LIMITS.maxRotSpeed, Math.max(0, Math.round(v)))), 90),
        ),
        this.note('Deadly. Throws dust where it cuts into a wall. Give it a route under Movement to make it travel (#45).'),
      ];
    }
    const sec = (v: number) => v / 1000;
    return [
      this.heading('Saw blade'),
      this.group(
        this.numField('Stroke (px)', s.stroke, (v) => (s.stroke = Math.max(0, Math.round(v))), 4),
        this.numField('Stroke time (s)', sec(s.strokeMs), (v) => (s.strokeMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.05),
      ),
      this.note('Deadly. Saws back and forth along its long side and throws dust where it cuts into a wall. Give it a route under Movement to make it travel (#46).'),
    ];
  }

  private textProps(o: MapObject): HTMLElement[] {
    const t = o.text!;
    const area = document.createElement('textarea');
    area.rows = 3;
    area.maxLength = 500;
    area.value = t.text;
    area.addEventListener('change', () => this.edit(() => (t.text = area.value)));
    const colorInput = (value: string, apply: (v: string) => void) => {
      const c = document.createElement('input');
      c.type = 'color';
      c.value = value;
      c.addEventListener('change', () => this.edit(() => apply(c.value.toLowerCase())));
      return c;
    };
    const font = document.createElement('select');
    for (const [v, label] of TEXT_BASE_FONTS) font.append(new Option(label, v, false, v === t.font));
    fontPicker(font, t.font);
    font.addEventListener('change', () => this.edit(() => (t.font = font.value)));
    const out: HTMLElement[] = [
      this.heading('Text box'),
      this.field('Text', area, true),
      this.group(
        this.field('Font', font, true),
        this.numField('Size', t.size, (v) => (t.size = Math.min(200, Math.max(6, Math.round(v)))), 2),
        this.field('Color', colorInput(t.color, (v) => (t.color = v))),
        this.selectField('Align', t.align, [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], (v) => (t.align = v)),
      ),
      this.toggle('Bold', t.bold, (on) => (t.bold = on)),
      this.toggle('Outline', !!t.outline, (on) => {
        if (on) t.outline = '#ffffff';
        else delete t.outline;
      }),
    ];
    if (t.outline) {
      out.push(this.group(
        this.field('Outline color', colorInput(t.outline, (v) => (t.outline = v))),
        this.numField('Outline width', t.outlineWidth, (v) => (t.outlineWidth = Math.min(20, Math.max(0, v))), 0.5),
      ));
    }
    out.push(this.toggle('Background', !!t.background, (on) => {
      if (on) t.background = '#ffffffb3';
      else delete t.background;
    }));
    if (t.background) {
      const bg = t.background;
      const alpha = parseInt(bg.slice(7, 9), 16) / 255;
      const hex2 = (a: number) => Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0');
      out.push(this.group(
        this.field('Background', colorInput(bg.slice(0, 7), (v) => (t.background = v + bg.slice(7, 9)))),
        this.numField('Opacity (%)', Math.round(alpha * 100), (v) => (t.background = bg.slice(0, 7) + hex2(v / 100)), 5),
      ));
    }
    out.push(this.note('Only decoration: the cursor can pass over text freely. Long lines wrap to the box width.'));
    return out;
  }

  private laserProps(o: MapObject): HTMLElement[] {
    const l = o.laser!;
    const out: HTMLElement[] = [
      this.heading('Laser'),
      this.colorPicker(l.color, (c) => (l.color = c)),
      this.group(this.numField('Direction (°)', l.angle, (v) => (l.angle = ((Math.round(v) % 360) + 360) % 360), 15)),
      this.toggle('Beam on at the start', l.on, (on) => (l.on = on)),
      this.toggle('A switch flips it on / off', l.switchColor !== undefined, (on) => {
        if (on) l.switchColor = this.lastColor;
        else delete l.switchColor;
      }),
    ];
    if (l.switchColor !== undefined) {
      const sc = l.switchColor;
      out.push(this.colorPicker(sc, (c) => (l.switchColor = c)), this.note(`While the ${switchColor(sc).name} switch is ON, the beam is ${l.on ? 'off' : 'on'}.`));
    }
    out.push(this.note('Drag the orange diamond to aim. The beam bounces off mirrors and stops at walls and doors.'));
    return out;
  }

  private portalProps(o: MapObject): HTMLElement[] {
    const p = o.portal!;
    const same = this.map.objects.filter((m) => m.portal?.color === p.color).length;
    return [
      this.heading('Teleport portal'),
      this.colorPicker(p.color, (c) => (p.color = c)),
      this.group(
        this.selectField('Direction', p.mode, [['both', 'Both ways'], ['in', 'Entrance only'], ['out', 'Exit only']], (v) => (p.mode = v), true),
        this.numField('Order', p.order + 1, (v) => (p.order = Math.max(0, Math.min(9999, Math.round(v) - 1)))),
      ),
      this.note(`Touching it pulls the cursor to its center, then sends it to the next ${switchColor(p.color).name} portal by order (${same} on this map).`),
    ];
  }

  private doorProps(o: MapObject): HTMLElement[] {
    const d = o.door!;
    const out: HTMLElement[] = [
      this.heading('Auto door'),
      this.group(
        this.selectField('Opens', d.mode, [['auto', 'By itself (cycle)'], ['switch', 'While a switch is ON']], (v) => (d.mode = v), true),
        this.numField('Open / close time (s)', d.moveMs / 1000, (v) => (d.moveMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0.05, v)) * 1000)), 0.1),
        ...(d.mode === 'auto' ? [this.numField('Stays open / shut (s)', d.waitMs / 1000, (v) => (d.waitMs = Math.round(Math.min(LIMITS.maxDelay, Math.max(0, v)) * 1000)), 0.1)] : []),
      ),
    ];
    if (d.mode === 'switch') out.push(this.colorPicker(d.color, (c) => (d.color = c)));
    out.push(this.note('The door splits across its long side and both halves slide apart. Touching it is deadly, like a wall.'));
    return out;
  }

  private linkProps(o: MapObject): HTMLElement[] {
    const out: HTMLElement[] = [this.heading('Switch link'), this.toggle('Reacts to a switch', !!o.link, (on) => {
      if (on) o.link = { color: this.lastColor, action: o.motion || o.rotation ? 'start' : 'remove' };
      else delete o.link;
    })];
    const l = o.link;
    if (l) {
      out.push(
        this.colorPicker(l.color, (c) => (l.color = c)),
        this.group(this.selectField<LinkAction>('While ON', l.action, [
          ['start', 'Moves (starts moving)'],
          ['stop', 'Stops moving'],
          ['remove', 'Is removed'],
        ], (v) => (l.action = v), true)),
        this.note('"Moves" objects stay still until the color turns ON; "Stops" objects move until then.'),
      );
    }
    return out;
  }

  /** A button that runs an arrange command (disabled when it can't apply) */
  private cmdButton(c: Command, text: string): HTMLButtonElement {
    const b = this.button(text, () => c.enabled && c.run(), 'cmd-btn');
    b.title = c.keys ? `${c.label} (${c.keys})` : c.label;
    b.setAttribute('aria-label', c.label);
    b.disabled = !c.enabled;
    return b;
  }

  private arrangeProps(multi: boolean): HTMLElement[] {
    const c = this.commands();
    const row = (...b: HTMLButtonElement[]) => {
      const d = this.actions(...b);
      d.classList.add('cmd-row');
      return d;
    };
    const out: HTMLElement[] = [
      this.heading('Arrange'),
      row(this.cmdButton(c.front, '⤒ Front'), this.cmdButton(c.forward, '↑ Fwd'), this.cmdButton(c.backward, '↓ Back'), this.cmdButton(c.back, '⤓ Rear')),
      row(
        this.cmdButton(c.alignLeft, '⇤'), this.cmdButton(c.alignCenter, '⇹'), this.cmdButton(c.alignRight, '⇥'),
        this.cmdButton(c.alignTop, '⤒'), this.cmdButton(c.alignMiddle, '⇳'), this.cmdButton(c.alignBottom, '⤓'),
      ),
    ];
    if (multi) {
      out.push(row(this.cmdButton(c.distH, '↔ Distribute'), this.cmdButton(c.distV, '↕ Distribute')));
      // A view preference, not a map edit: no undo step
      const wrap = document.createElement('label');
      wrap.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.alignToMap;
      input.addEventListener('change', () => {
        this.alignToMap = input.checked;
        this.renderProps();
      });
      const span = document.createElement('span');
      span.textContent = 'Align to the map instead of the selection';
      wrap.append(input, span);
      out.push(wrap);
    } else {
      out.push(this.note('A single object aligns to the map.'));
    }
    out.push(
      row(this.cmdButton(c.rotCW, '↻ 90°'), this.cmdButton(c.rotCCW, '↺ 90°'), this.cmdButton(c.flipH, '⇋ Flip'), this.cmdButton(c.flipV, '⇵ Flip')),
    );
    return out;
  }

  private multiProps(ids: number[]): HTMLElement[] {
    const c = this.commands();
    const objs = ids.map((i) => this.map.objects[i]);
    const title = document.createElement('h4');
    const g = objs[0].group;
    title.textContent = g !== undefined && objs.every((o) => o.group === g) ? `Group ${g} · ${ids.length} objects` : `${ids.length} objects selected`;
    const b = objectsBounds(objs);
    const row = (...bs: HTMLButtonElement[]) => {
      const d = this.actions(...bs);
      d.classList.add('cmd-row');
      return d;
    };
    return [
      title,
      this.note(`${objs.filter((o) => o.role === 'path').length} paths, ${objs.filter((o) => o.role === 'wall').length} walls · ${sizeText(b.w, b.h)} · first picked: #${ids[0] + 1}`),
      ...this.arrangeProps(true),
      this.heading('Group'),
      row(this.cmdButton(c.group, 'Group'), this.cmdButton(c.ungroup, 'Ungroup'), this.cmdButton(c.regroup, 'Regroup')),
      this.heading('Merge shapes'),
      row(
        this.cmdButton(c.union, 'Union'), this.cmdButton(c.combine, 'Combine'), this.cmdButton(c.fragment, 'Fragment'),
        this.cmdButton(c.intersect, 'Intersect'), this.cmdButton(c.subtract, 'Subtract'),
      ),
      this.note('The result is a freeform shape that keeps the type, movement and rotation of the first picked object. Subtract removes the others from the first.'),
      this.heading('Type'),
      row(this.cmdButton(c.makePath, 'All paths'), this.cmdButton(c.makeWall, 'All walls')),
      this.actions(
        this.button('Duplicate', () => this.duplicateSelected()),
        this.button('Delete', () => this.deleteSelected(), 'danger'),
      ),
    ];
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
      chapterMazePresets(),
    );
  }

  /** Rebuild the level settings only when they changed, so a field being typed in keeps focus */
  private renderedLevel: string | null = null;
  private renderLevel(): void {
    const m = this.map;
    const json = JSON.stringify([m.title, m.level, m.stars, this.lastClearMs, m.darkness, m.difficulty]);
    if (json === this.renderedLevel) return;
    this.renderedLevel = json;

    const title = document.createElement('input');
    title.maxLength = LIMITS.maxText;
    title.placeholder = m.name;
    title.value = m.title ?? '';
    title.addEventListener('change', () => this.edit(() => {
      const v = title.value.trim().slice(0, LIMITS.maxText);
      if (v) m.title = v;
      else delete m.title;
    }));

    const level = document.createElement('input');
    level.type = 'number';
    level.min = '1';
    level.max = String(LIMITS.maxLevel);
    level.step = '1';
    level.placeholder = 'None';
    level.value = m.level !== undefined ? String(m.level) : '';
    level.addEventListener('change', () => this.edit(() => {
      const v = Math.round(Number(level.value));
      if (level.value.trim() && v >= 1) m.level = Math.min(LIMITS.maxLevel, v);
      else delete m.level;
    }));

    const difficulty = document.createElement('input');
    difficulty.type = 'number';
    difficulty.min = '1';
    difficulty.max = '10';
    difficulty.step = '0.25';
    difficulty.placeholder = '1.00';
    difficulty.value = m.difficulty !== undefined ? m.difficulty.toFixed(2) : '';
    difficulty.addEventListener('change', () => this.edit(() => {
      const v = Number(difficulty.value);
      if (difficulty.value.trim() && Number.isFinite(v)) m.difficulty = Math.round(Math.min(10, Math.max(1, v)) * 100) / 100;
      else delete m.difficulty;
    }));

    const parts: HTMLElement[] = [
      this.group(
        this.field('Level title', title, true),
        this.field('Level number', level),
        this.field('Difficulty (1–10)', difficulty),
      ),
      this.note('The title and number are shown in game; the file name above is used for exports.'),
    ];

    parts.push(this.toggle('Star ratings', !!m.stars, (on) => {
      if (!on) return void delete m.stars;
      // Suggest times from the last test clear, else 10 / 20 / 30 s
      const t = this.lastClearMs;
      const round = (ms: number) => Math.max(100, Math.ceil(ms / 100) * 100);
      m.stars = t !== null
        ? { three: round(t * 1.1), two: round(t * 1.5), one: round(t * 2) }
        : { three: 10_000, two: 20_000, one: 30_000 };
    }));
    const s = m.stars;
    if (s) {
      const sec = (key: 'three' | 'two' | 'one', label: string) =>
        this.numField(label, s[key] / 1000, (v) => (s[key] = Math.round(Math.min(LIMITS.maxStarTime, Math.max(0.1, v) * 1000))), 0.1);
      parts.push(
        this.group(sec('three', '★★★ within (s)'), sec('two', '★★ within (s)'), sec('one', '★ within (s)')),
        this.note(this.lastClearMs !== null
          ? `Your last test clear: ${(this.lastClearMs / 1000).toFixed(3)}s. Slower than the ★ time earns no star.`
          : 'Clear times at or under each value earn that many stars. Slower than the ★ time earns no star.'),
      );
    }
    parts.push(this.toggle('Global darkness (#42)', !!m.darkness, (on) => {
      if (on) m.darkness = { light: 60 };
      else delete m.darkness;
    }));
    const dk = m.darkness;
    if (dk) {
      parts.push(
        this.group(this.numField('Light radius', dk.light, (v) => (dk.light = Math.round(Math.min(LIMITS.maxLight, Math.max(LIMITS.minLight, v)))), 4)),
        this.note(`The map is dark during a run; only a light of this radius (at least ${LIMITS.minLight}) around the cursor shows it. The editor previews it around your mouse.`),
      );
    }
    this.el.level.replaceChildren(...parts);
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
      this.el.verify.textContent = `Link copied to clipboard (${url.length} chars)`;
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

  /** Small pill with object info, placed just above-right of (x, y) and kept inside the map */
  private drawInfoLabel(text: string, x: number, y: number, u: number): void {
    const { ctx, map } = this;
    ctx.font = `600 ${12 * u}px ${FONT_MAIN}`;
    const padX = 7 * u;
    const w = ctx.measureText(text).width + padX * 2;
    const h = 20 * u;
    const lx = Math.max(2 * u, Math.min(x + 6 * u, map.width - w - 2 * u));
    const ly = Math.max(2 * u, Math.min(y - h - 6 * u, map.height - h - 2 * u));
    ctx.save();
    ctx.shadowColor = 'rgba(36,52,80,0.25)';
    ctx.shadowBlur = 6 * u * ctx.getTransform().a;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(36,52,80,0.25)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + padX, ly + h / 2 + 0.5 * u);
  }

  private draw(): void {
    if (!this.visible) return;
    const { ctx, map } = this;
    const u = unitsPerPx(this.el.canvas, map);
    const objs = this.compiled;
    const preview = this.el.preview.checked;
    beginFrame(ctx, map);
    const t = preview ? performance.now() - this.previewStart : 0;
    this.beamCaster ??= new BeamCaster(map, objs);
    const beams = this.beamCaster.any ? this.beamCaster.beams({ timeOf: () => t, channels: initialChannels(map) }) : [];
    drawMap(ctx, map, objs, t, { gridOnTop: this.el.gridTop.checked, beams, now: performance.now() });
    // Spikes: how far they thrust
    ctx.setLineDash([4 * u, 3 * u]);
    ctx.strokeStyle = 'rgba(226,72,108,0.7)';
    ctx.lineWidth = 1.2 * u;
    for (const o of map.objects) {
      if (!o.spike || o.shape.type !== 'poly') continue;
      const tip = o.shape.points[0];
      const a = (o.spike.angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + Math.cos(a) * o.spike.reach, tip.y + Math.sin(a) * o.spike.reach);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The map is drawn as one seamless floor and one wall mass, so overlapping pieces (or a wall
    // on the wall-colored area outside the paths) would be invisible while editing. Outline each one.
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([5 * u, 4 * u]);
    const pose: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };
    for (const role of ['path', 'wall'] as const) {
      ctx.strokeStyle = role === 'path' ? COLORS.outlinePath : COLORS.outlineWall;
      ctx.beginPath();
      for (const o of objs) if (o.role === role) traceObject(ctx, o, transformAt(o, t, pose));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Darkness areas see-through, so what's under them stays editable
    drawDarkAreas(ctx, objs, t, 0.55);
    ctx.setLineDash([5 * u, 4 * u]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    for (const o of objs) if (o.role === 'dark') traceObject(ctx, o, transformAt(o, t, pose));
    ctx.stroke();
    ctx.setLineDash([]);
    // Global darkness: a light preview around the mouse
    if (map.darkness && this.hover) drawGlobalDark(ctx, map, [{ x: this.hover.x, y: this.hover.y, r: map.darkness.light }], 0.3);
    // Level number and title as they'll appear in game, in the chapter preset's badge design
    const badge = badgeFor(map);
    ctx.save();
    ctx.globalAlpha = 0.92;
    drawLevelBadge(ctx, map.level === undefined && !map.title ? { ...map, title: badgeTitle(map) } : map,
      badge?.style ?? { ...DEFAULT_BADGE, numberColor: COLORS.cursor }, badgeImage(badge?.imageUrl), performance.now());
    ctx.restore();

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

    const selIndex = this.selectedIndex();
    const selIds = new Set(this.selIds());

    // Routes and pivots of every dynamic object (faint), the selected ones highlighted
    map.objects.forEach((o, i) => {
      const selected = selIds.has(i);
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
      if (o.rotation && i !== selIndex) {
        ctx.fillStyle = COLORS.pivot;
        ctx.beginPath();
        ctx.arc(o.rotation.pivot.x, o.rotation.pivot.y, 2.5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Switch links: a colored dot at the top-left of every linked object / switch-operated door
    map.objects.forEach((o) => {
      const c = o.link?.color ?? (o.door?.mode === 'switch' ? o.door.color : undefined);
      if (c === undefined) return;
      const b = shapeBounds(o.shape);
      ctx.fillStyle = switchColor(c).hex;
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.arc(b.x + 2 * u, b.y + 2 * u, 5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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

      // "#4 · ID 5 · 120×40" at the top-right of the selection (group members: the group's box too)
      const o = this.selectedObject();
      const b = zone ?? (o ? shapeBounds(o.shape) : null);
      if (b) {
        const kind = this.sel?.kind;
        const label = o
          ? `#${selIndex + 1} · ID ${objectToolId(o)} · ${sizeText(b.w, b.h)}`
          : `${kind === 'start' ? 'START' : 'GOAL'} · ID ${ZONE_IDS[kind === 'start' ? 'start' : 'goal']} · ${sizeText(b.w, b.h)}`;
        this.drawInfoLabel(label, b.x + b.w, b.y, u);
      }
    }

    // Multi-selection: every member outlined, plus one box around them all
    if (selIds.size > 1) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.beginPath();
      for (const i of selIds) if (objs[i]) traceObject(ctx, objs[i], IDENTITY);
      ctx.stroke();
      const members = [...selIds].map((i) => map.objects[i]).filter(Boolean);
      const b = objectsBounds(members);
      const pad = 4 * u;
      ctx.setLineDash([2 * u, 3 * u]);
      ctx.lineWidth = 1 * u;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]);
      // Small squares at the box corners, like a selection frame
      ctx.fillStyle = '#fff';
      for (const c of rectCorners({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 })) {
        ctx.fillRect(c.x - 3 * u, c.y - 3 * u, 6 * u, 6 * u);
        ctx.strokeRect(c.x - 3 * u, c.y - 3 * u, 6 * u, 6 * u);
      }
      const g = members[0].group;
      const grouped = g !== undefined && members.every((o) => o.group === g);
      this.drawInfoLabel(`${grouped ? `Group ${g} · ` : ''}${members.length} objects · ${sizeText(b.w, b.h)}`, b.x + b.w + pad, b.y - pad, u);
    } else if (selIndex >= 0 && map.objects[selIndex]?.group !== undefined) {
      // A single member picked out of its group: show the group's extent faintly
      const g = map.objects[selIndex].group;
      const b = objectsBounds(map.objects.filter((o) => o.group === g));
      ctx.strokeStyle = COLORS.select;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1 * u;
      ctx.setLineDash([2 * u, 3 * u]);
      ctx.strokeRect(b.x - 4 * u, b.y - 4 * u, b.w + 8 * u, b.h + 8 * u);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Pivot snap targets while dragging a pivot: the exact center is easy to find
    const dr = this.drag;
    const so = this.selectedObject();
    if (dr?.type === 'handle' && dr.h.kind === 'pivot' && so) {
      for (const t of this.pivotTargets(so)) {
        const center = t.label !== 'Vertex' && t.label !== 'Corner' && t.label !== 'Edge middle';
        ctx.strokeStyle = center ? COLORS.pivot : 'rgba(36,52,80,0.55)';
        ctx.lineWidth = 1.2 * u;
        const r = (center ? 6 : 3.5) * u;
        ctx.beginPath();
        ctx.moveTo(t.p.x - r, t.p.y);
        ctx.lineTo(t.p.x + r, t.p.y);
        ctx.moveTo(t.p.x, t.p.y - r);
        ctx.lineTo(t.p.x, t.p.y + r);
        ctx.stroke();
      }
      if (this.pivotSnap) {
        const p = this.pivotSnap.p;
        ctx.strokeStyle = COLORS.pivot;
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 * u, 0, Math.PI * 2);
        ctx.stroke();
        this.drawInfoLabel(`${this.pivotSnap.label} (${Math.round(p.x * 10) / 10}, ${Math.round(p.y * 10) / 10})`, p.x + 8 * u, p.y - 4 * u, u);
      }
    }

    // Rubber-band selection box
    if (dr?.type === 'marquee') {
      const r = rectFromCorners({ x: dr.x0, y: dr.y0 }, { x: dr.x1, y: dr.y1 });
      ctx.fillStyle = 'rgba(58,159,240,0.1)';
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1 * u;
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
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
      } else if (h.kind === 'aim') {
        ctx.fillStyle = COLORS.routeSelected;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 7 * u);
        ctx.lineTo(p.x + 7 * u, p.y);
        ctx.lineTo(p.x, p.y + 7 * u);
        ctx.lineTo(p.x - 7 * u, p.y);
        ctx.closePath();
        ctx.fill();
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
      let label = `${r.w}×${r.h}`;
      const tl = this.tool.kind === 'object' ? this.tool : null;
      if (tl && (tl.special === 'spike' || tl.role === 'mirror')) {
        const s = this.lineShapeFromDrag(tl, d);
        if (s.type === 'poly') {
          s.points.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.closePath();
          label = `${Math.round(Math.hypot(d.x1 - d.x0, d.y1 - d.y0))}`;
        }
      } else if (this.tool.kind === 'object' && this.tool.shape === 'sector') {
        const s = this.sectorFromDrag(d);
        if (s.type === 'sector') {
          const ring = flattenShape(s).poly;
          ctx.moveTo(ring[0], ring[1]);
          for (let k = 2; k < ring.length; k += 2) ctx.lineTo(ring[k], ring[k + 1]);
          ctx.closePath();
          label = `r ${s.r}`;
        }
      } else if (this.tool.kind === 'object' && this.tool.shape === 'ellipse') {
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(r.x, r.y, r.w, r.h);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 ${12 * u}px ${FONT_MAIN}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, r.x, r.y - 3 * u);
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
