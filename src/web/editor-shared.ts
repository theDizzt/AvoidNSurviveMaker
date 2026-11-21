import { t as tr } from './i18n';

import { type Transform } from '../core/object';

import type { Easing, FogKind, MapObject, Motion, MotionType, Point, Rect, Repeat, Role, Shape, TriggerKind, ZoneShape } from '../core/types';
import { switchColor } from './localized/colors';

import { DEFAULT_BOULDER_WAVE, DEFAULT_MOTION } from './localized/validate';

export type { EditorSelection as Selection } from '../core/editor-document';

export type ShapeKind = 'rect' | 'ellipse' | 'poly' | 'free' | 'sector';

/** blinking: appears and disappears on a cycle (#75–82) */
export type Behavior = 'static' | 'moving' | 'rotating' | 'blinking';

export interface ObjectTool {
  kind: 'object';
  role: Role;
  behavior: Behavior;
  shape: ShapeKind;
  /** role 'trigger': which kind of switch / zone */
  trigger?: TriggerKind;
  /** Walls with a built-in behavior */
  special?: 'spike' | 'boulder' | 'disc' | 'blade' | 'fall';
  /** role 'fog': fog or sand dust */
  fog?: FogKind;
  /** shape 'sector': a ring sector (#53/#54) */
  ring?: boolean;
  /** role 'torch': the carryable kind (#58) */
  carry?: boolean;
  /** role 'turret': gun turret (#60) or missile launcher (#61) */
  turret?: 'gun' | 'missile';
  /** role 'path': ice floor (#71–74) */
  ice?: boolean;
}

/** START / GOAL tool: a rectangle (#9 / #10), or a circle, polygon or freeform (#63–68) */
export interface ZoneTool {
  kind: 'zone';
  zone: 'start' | 'goal';
  shape?: 'ellipse' | 'poly' | 'free';
}

export type Tool = { kind: 'select' } | ZoneTool | ObjectTool;

export const SHAPES: [ShapeKind, string][] = [
  ['rect', tr('ed.rectangle')],
  ['ellipse', tr('common.circle')],
  ['poly', tr('ed.polygon')],
  ['free', tr('ed.freeform')],
];

export const GROUPS: ({ title: string; role: Role; behavior: Behavior; first: number } | { title: string; zones: true })[] = [
  { title: tr('common.paths'), role: 'path', behavior: 'static', first: 1 },
  { title: tr('ed.walls'), role: 'wall', behavior: 'static', first: 5 },
  { title: tr('ed.zones'), zones: true },
  { title: tr('ed.movingPaths'), role: 'path', behavior: 'moving', first: 11 },
  { title: tr('ed.rotatingPaths'), role: 'path', behavior: 'rotating', first: 15 },
  { title: tr('ed.movingWalls'), role: 'wall', behavior: 'moving', first: 19 },
  { title: tr('ed.rotatingWalls'), role: 'wall', behavior: 'rotating', first: 23 },
  { title: tr('ed.blinkingPaths'), role: 'path', behavior: 'blinking', first: 75 },
  { title: tr('ed.blinkingWalls'), role: 'wall', behavior: 'blinking', first: 79 },
];

export const ICONS: Record<ShapeKind, string> = {
  rect: '<rect x="3" y="6" width="18" height="12" rx="1"/>',
  ellipse: '<circle cx="12" cy="12" r="8"/>',
  poly: '<polygon points="12,3 21,10 17.5,20 6.5,20 3,10"/>',
  free: '<path d="M4 18 C3 9 9 3 13 7 S 21 8 20 15 S 9 21 4 18 Z"/>',
  sector: '<path d="M5 19 L5 5 A14 14 0 0 1 19 19 Z"/>',
};

export const SPECIAL_IDS = {
  sectorPath: 27, sectorWall: 28, spike: 29, boulder: 30, coin: 31, laser: 37, mirror: 38, portal: 39, door: 40, dark: 41, globalDark: 42,
  disc: 43, blade: 44, movingDisc: 45, movingBlade: 46, text: 47, safe: 48, fog: 49, sand: 50,
  fall: 51, pulley: 52, ringPath: 53, ringWall: 54, secret: 55, secretFree: 56, torch: 57, carryTorch: 58, crystal: 59, turret: 60, missile: 61, rotatingSaw: 62, conveyor: 69, luggage: 70,
} as const;

export const TRIGGER_IDS: Record<TriggerKind, number> = { switch: 32, timer: 33, hold: 34, startZone: 35, stopZone: 36 };

export const TRIGGER_NAMES: Record<TriggerKind, string> = {
  switch: tr('ed.nameSwitch'), timer: tr('ed.nameTimer'), hold: tr('ed.nameHold'), startZone: tr('ed.nameStartZone'), stopZone: tr('ed.nameStopZone'),
};

export const isButton = (k: TriggerKind | undefined) => k === 'switch' || k === 'timer' || k === 'hold';

export const ROLE_NAMES: Record<Role, string> = {
  path: tr('ed.namePath'), wall: tr('ed.nameWall'), coin: tr('ed.nameCoin'), dark: tr('ed.nameDark'), trigger: tr('ed.nameSwitch'), door: tr('ed.nameDoor'), laser: tr('ed.laser'), mirror: tr('ed.mirror'), portal: tr('ed.namePortal'),
  text: tr('ed.textBox2'), safe: tr('ed.nameSafe'), fog: tr('ed.nameFog'), torch: tr('ed.nameTorch'), secret: tr('ed.nameSecret'), crystal: tr('ed.nameCrystal'), pulley: tr('ed.namePulley'), turret: tr('ed.nameTurret'),
  conveyor: tr('ed.nameConveyor'), luggage: tr('ed.nameLuggage'),
};

export const fogName = (kind: FogKind | undefined) => tr(kind === 'sand' ? 'ed.nameSand' : 'ed.nameFog');

export const isSquare = (o: { role: Role; trigger?: { kind: TriggerKind }; saw?: { kind: string } }) => o.role === 'pulley' || o.role === 'portal' || o.role === 'laser' || isButton(o.trigger?.kind) || o.saw?.kind === 'disc';

export function withBehavior(beh: Behavior, name: string): string {
  return beh === 'moving' ? tr('ed.nameMoving', { name }) : beh === 'rotating' ? tr('ed.nameRotating', { name }) : beh === 'blinking' ? tr('ed.nameBlinking', { name }) : name;
}

export function toolLabel(t: ObjectTool): string {
  if (t.role === 'trigger') return TRIGGER_NAMES[t.trigger ?? 'switch'];
  if (t.special === 'spike') return tr('ed.nameSpike');
  if (t.special === 'boulder') return tr('ed.nameBoulder');
  if (t.special === 'fall') return tr('ed.nameFall');
  if (t.role === 'fog') return fogName(t.fog);
  if (t.role === 'torch') return tr(t.carry ? 'ed.nameCarryTorch' : 'ed.nameTorch');
  if (t.role === 'turret') return tr(t.turret === 'missile' ? 'ed.nameMissile' : 'ed.nameTurret');
  if (t.special === 'disc' || t.special === 'blade') return withBehavior(t.behavior === 'moving' || t.behavior === 'rotating' ? t.behavior : 'static', tr(t.special === 'disc' ? 'ed.nameDisc' : 'ed.nameBlade'));
  if (t.role !== 'path' && t.role !== 'wall') return ROLE_NAMES[t.role];
  if (t.ice) return tr('ed.shapeRole', { shape: SHAPES.find(([k]) => k === t.shape)![1], role: tr('ed.nameIce') });
  const shape = t.shape === 'sector' ? tr(t.ring ? 'ed.shapeRing' : 'ed.shapeSector') : SHAPES.find(([k]) => k === t.shape)![1];
  return withBehavior(t.behavior, tr('ed.shapeRole', { shape, role: ROLE_NAMES[t.role] }));
}

export function isFreeform(s: Shape): boolean {
  return s.type === 'poly' && (!!s.free || s.points.some((p) => p.smooth));
}

export function describeObject(o: MapObject): string {
  const shape = tr(
    o.shape.type === 'rect' ? 'ed.rectangle'
      : o.shape.type === 'ellipse' ? 'common.circle'
        : o.shape.type === 'sector' ? (o.shape.inner ? 'ed.shapeRing' : 'ed.shapeSector')
          : isFreeform(o.shape) ? 'ed.freeform' : 'ed.polygon');
  const beh: Behavior = o.blink ? 'blinking' : o.rotation ? 'rotating' : o.motion ? 'moving' : 'static';
  if (o.role === 'trigger') return withBehavior(beh, tr('ed.colorName', { color: switchColor(o.trigger?.color ?? 0).name, name: TRIGGER_NAMES[o.trigger?.kind ?? 'switch'] }));
  if (o.spike) return tr('ed.nameSpike');
  if (o.boulder) return tr('ed.nameBoulder');
  if (o.fall) return tr('ed.nameFall');
  if (o.role === 'pulley') return tr('ed.colorName', { color: switchColor(o.pulley?.color ?? 0).name, name: tr('ed.namePulley') });
  if (o.role === 'fog') return withBehavior(beh, fogName(o.fog?.kind));
  if (o.role === 'turret') return withBehavior(beh, tr(o.turret?.kind === 'missile' ? 'ed.nameMissile' : 'ed.nameTurret'));
  if (o.role === 'torch') return withBehavior(beh, tr(o.torch?.carry ? 'ed.nameCarryTorch' : 'ed.nameTorch'));
  if (o.saw) return withBehavior(o.rotation ? 'rotating' : o.motion ? 'moving' : 'static', tr(o.saw.kind === 'disc' ? 'ed.nameDisc' : 'ed.nameBlade'));
  if (o.role === 'laser' || o.role === 'portal') return withBehavior(beh, tr('ed.colorName', { color: switchColor((o.laser ?? o.portal)!.color).name, name: ROLE_NAMES[o.role] }));
  if (o.role !== 'path' && o.role !== 'wall') return withBehavior(beh, ROLE_NAMES[o.role]);
  return withBehavior(beh, tr('ed.shapeRole', { shape, role: o.ice ? tr('ed.nameIce') : ROLE_NAMES[o.role] }));
}

export function objectToolId(o: MapObject): number {
  if (o.role === 'coin') return SPECIAL_IDS.coin;
  if (o.role === 'dark') return SPECIAL_IDS.dark;
  if (o.role === 'door') return SPECIAL_IDS.door;
  if (o.role === 'laser') return SPECIAL_IDS.laser;
  if (o.role === 'mirror') return SPECIAL_IDS.mirror;
  if (o.role === 'portal') return SPECIAL_IDS.portal;
  if (o.spike) return SPECIAL_IDS.spike;
  if (o.boulder) return SPECIAL_IDS.boulder;
  if (o.saw && o.rotation) return SPECIAL_IDS.rotatingSaw;
  if (o.saw) return o.saw.kind === 'disc' ? (o.motion ? SPECIAL_IDS.movingDisc : SPECIAL_IDS.disc) : o.motion ? SPECIAL_IDS.movingBlade : SPECIAL_IDS.blade;
  if (o.role === 'text') return SPECIAL_IDS.text;
  if (o.role === 'safe') return SPECIAL_IDS.safe;
  if (o.role === 'fog') return o.fog?.kind === 'sand' ? SPECIAL_IDS.sand : SPECIAL_IDS.fog;
  if (o.role === 'torch') return o.torch?.carry ? SPECIAL_IDS.carryTorch : SPECIAL_IDS.torch;
  if (o.role === 'secret') return isFreeform(o.shape) ? SPECIAL_IDS.secretFree : SPECIAL_IDS.secret;
  if (o.role === 'crystal') return SPECIAL_IDS.crystal;
  if (o.role === 'conveyor') return SPECIAL_IDS.conveyor;
  if (o.role === 'luggage') return SPECIAL_IDS.luggage;
  if (o.role === 'pulley') return SPECIAL_IDS.pulley;
  if (o.role === 'turret') return o.turret?.kind === 'missile' ? SPECIAL_IDS.missile : SPECIAL_IDS.turret;
  if (o.fall) return SPECIAL_IDS.fall;
  if (o.role === 'trigger') return TRIGGER_IDS[o.trigger?.kind ?? 'switch'];
  if (o.ice && o.shape.type !== 'sector') return 71 + (o.shape.type === 'rect' ? 0 : o.shape.type === 'ellipse' ? 1 : isFreeform(o.shape) ? 3 : 2);
  if (o.shape.type === 'sector' && o.shape.inner) return o.role === 'path' ? SPECIAL_IDS.ringPath : SPECIAL_IDS.ringWall;
  if (o.shape.type === 'sector') return o.role === 'path' ? SPECIAL_IDS.sectorPath : SPECIAL_IDS.sectorWall;
  const shape = o.shape.type === 'rect' ? 0 : o.shape.type === 'ellipse' ? 1 : isFreeform(o.shape) ? 3 : 2;
  const group = GROUPS.find(
    (g) => 'role' in g && g.role === o.role && g.behavior === (o.blink ? 'blinking' : o.rotation ? 'rotating' : o.motion ? 'moving' : 'static'),
  );
  return group && 'first' in group ? group.first + shape : 0;
}

export const ZONE_IDS = { start: 9, goal: 10 } as const;

/** Palette number of a START / GOAL zone by its shape: 9/10, circles 63/64, polygons 65/66, freeforms 67/68 */
export function zoneToolId(zone: 'start' | 'goal', shape: ZoneShape | undefined): number {
  const k = zone === 'start' ? 0 : 1;
  if (!shape) return ZONE_IDS[zone];
  if (shape.type === 'ellipse') return 63 + k;
  return (shape.free ? 67 : 65) + k;
}

export function sizeText(w: number, h: number): string {
  return `${Math.round(w)}×${Math.round(h)}`;
}

export type Hit = { kind: 'object'; i: number } | { kind: 'start' } | { kind: 'goal' } | null;

export type Handle =
  | { kind: 'corner'; j: number }
  | { kind: 'vertex'; j: number }
  | { kind: 'marker'; j: number }
  | { kind: 'pivot' }
  /** Sector: the two arc ends (angles) and the arc middle (radius) */
  | { kind: 'arc'; part: 'start' | 'end' | 'radius' | 'inner' }
  /** Laser: beam direction */
  | { kind: 'aim' }
  /** Conveyor belt (#69): a point of its centerline */
  | { kind: 'belt'; j: number }
  /** Tilt: turns the object about its center */
  | { kind: 'rotate' };

export type Drag =
  | { type: 'box'; x0: number; y0: number; x1: number; y1: number; square: boolean }
  | {
    type: 'move'; p0: Point; before: string; moved: boolean;
    /** Zone being moved, or the selected objects as they were */
    zone?: Rect; objs?: { i: number; o: MapObject }[];
    /** Object clicked inside the current selection: picked alone if released without moving */
    clicked: number | null;
  }
  | { type: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean; base: number[] }
  | {
    type: 'handle'; h: Handle; before: string; moved: boolean; orig: MapObject | Rect; /** rotate: pointer angle at the start (deg) */ a0?: number;
    /** Rotating a multi-selection: the objects as they were, the fixed center, the handle's distance from it and the angle turned so far */
    group?: { objs: { i: number; o: MapObject }[]; c: Point; r: number; deg: number };
  };




export const MAP_SIZES: [number, number][] = [[640, 360], [960, 540], [1280, 720], [1600, 900], [1920, 1080]];

export const GRID = 10;

export const HANDLE_PX = 7;

export const PIVOT_SNAP_PX = 10;
/** How far above an object its tilt handle sits (screen px) */
export const ROTATE_HANDLE_PX = 26;

export const MIN_ZOOM = 0.25;

export const MAX_ZOOM = 8;

export const ZOOM_STEP = 1.25;

export const IDENTITY: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

/** Repeat modes of a rotation */
export const REPEAT_OPTIONS: [Repeat, string][] = [['loop', tr('ed.loop')], ['pingpong', tr('ed.pingPong')], ['restart', tr('ed.restart')], ['once', tr('ed.once')]];
/** Repeat modes of a route: those of a rotation, plus slamming into the end */
export const ROUTE_REPEAT_OPTIONS: [Repeat, string][] = [...REPEAT_OPTIONS.slice(0, 3), ['slam', tr('ed.slam')], REPEAT_OPTIONS[3]];

export const EASING_OPTIONS: [Easing, string][] = [['none', tr('common.none')], ['in', tr('ed.easeIn')], ['out', tr('ed.easeOut')], ['inOut', tr('ed.easeInOut')]];

export const ROUTE_OPTIONS: [MotionType, string][] = [['linear', tr('ed.straight')], ['curve', tr('ed.curve')], ['circle', tr('ed.circleOrbit')]];

export const DIRECTION_OPTIONS: [string, string][] = [['cw', tr('ed.clockwise')], ['ccw', tr('ed.counterClockwise')]];

export function newMotion(o: MapObject): Motion {
  return o.boulder ? { ...DEFAULT_MOTION, points: [], wave: { ...DEFAULT_BOULDER_WAVE } } : { ...DEFAULT_MOTION, points: [] };
}

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
  /** Center lines overlay */
  center: HTMLInputElement;
  /** Symmetry check mode */
  symmetry: HTMLSelectElement;
  /** Symmetry check result */
  symmetryStatus: HTMLElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  shortcuts: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomReset: HTMLButtonElement;
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

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type CommandId =
  | 'cut' | 'copy' | 'paste' | 'duplicate' | 'delete'
  | 'selectAll' | 'selectPaths' | 'selectWalls' | 'selectSame'
  | 'front' | 'forward' | 'backward' | 'back'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignTop' | 'alignMiddle' | 'alignBottom' | 'distH' | 'distV' | 'alignToMap'
  | 'rotCW' | 'rotCCW' | 'flipV' | 'flipH'
  | 'group' | 'ungroup' | 'regroup'
  | 'union' | 'combine' | 'fragment' | 'intersect' | 'subtract'
  | 'pivotCenter' | 'pivotCentroid'
  | 'makePath' | 'makeWall';

export interface Command {
  label: string;
  enabled: boolean;
  run: () => void;
  keys?: string;
  checked?: boolean;
  danger?: boolean;
}

export const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export const SHORTCUTS: [string, [string, string][]][] = [
  [tr('common.tools'), [
    ['V', tr('ed.selectEdit')],
    ['1 / 2 / 3 / 4', tr('ed.scRectangleCirclePolygonFreeform')],
    ['W', tr('ed.switchBetweenPathAndWall')],
    ['M', tr('ed.movingObjectPressAgainFor')],
    ['R', tr('ed.rotatingObjectPressAgainFor')],
    ['S / G', tr('ed.scStartAreaGoalArea')],
  ]],
  [tr('ed.scGroupEdit'), [
    ['Ctrl+Z', tr('common.undo')],
    ['Ctrl+Y / Ctrl+Shift+Z', tr('common.redo')],
    ['Ctrl+C / Ctrl+X / Ctrl+V', tr('ed.scCopyCutPaste')],
    ['Ctrl+D', tr('common.duplicate')],
    ['Delete', tr('common.delete')],
    ['Ctrl+A', tr('common.selectAll')],
    ['Shift+Click / Ctrl+Click', tr('ed.scAddToRemoveFromSelection')],
    ['Drag', tr('ed.onEmptySpaceSelectEverything')],
    ['Ctrl+G / Ctrl+Shift+G', tr('ed.scGroupUngroup')],
    ['Ctrl+] / Ctrl+[', tr('ed.scBringForwardSendBackward')],
    ['Ctrl+Shift+] / Ctrl+Shift+[', tr('ed.scBringToFrontSendToBack')],
    ['Alt', tr('ed.whileDraggingAPivotPlace')],
    ['Arrows', tr('ed.moveSelectionGridStepWhen')],
    ['Shift+Arrows', tr('ed.scMoveSelection10')],
    ['Tab / Shift+Tab', tr('ed.scSelectNextPrevious')],
    ['Esc', tr('ed.cancelDrawingDeselect')],
    ['Enter', tr('ed.closePolygonFinishMarkers')],
    ['Backspace', tr('ed.removeLastPointWhileDrawing')],
  ]],
  [tr('ed.scGroupView'), [
    ['Wheel', tr('ed.scWheelZoom')],
    ['+ / −', tr('ed.scZoomInOut')],
    ['0', tr('ed.scZoomReset')],
    ['Space+Drag / Middle-drag', tr('ed.scPan')],
    ['N', tr('ed.toggleSnapToGrid')],
    ['P', tr('ed.toggleMotionPreview')],
    ['C', tr('ed.toggleCenterLines')],
    ['Y', tr('ed.cycleSymmetry')],
    ['T', tr('ed.testPlay')],
    ['H', tr('ed.hideShowPanels')],
    ['F', tr('common.fullscreen')],
    ['Right-click', tr('ed.arrangeAlignRotateGroupAnd')],
    ['?', tr('ed.scShowThisList')],
  ]],
];

export function rectFromCorners(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}
