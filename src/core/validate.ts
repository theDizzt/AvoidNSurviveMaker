import { compileMover, moverPos } from './mover';
import { rectsOverlap } from './geometry';
import { MAP_VERSION, type MapData, type Mover, type Point, type Rect } from './types';

export const LIMITS = {
  minSize: 200,
  maxSize: 4000,
  maxWalls: 1000,
  maxMovers: 200,
  maxPathPoints: 64,
  maxSpeed: 5000,
  maxOffset: 600_000,
  maxText: 60,
} as const;

export class MapValidationError extends Error {}

function fail(msg: string): never {
  throw new MapValidationError(msg);
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${name}: 객체가 아닙니다`);
  return v as Record<string, unknown>;
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${name}: 숫자가 아닙니다`);
  if (v < min || v > max) fail(`${name}: ${min} ~ ${max} 범위여야 합니다 (현재 ${v})`);
  return v;
}

function text(v: unknown, name: string): string {
  if (v === undefined) return '';
  if (typeof v !== 'string') fail(`${name}: 문자열이 아닙니다`);
  return v.slice(0, LIMITS.maxText);
}

function arr(v: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(`${name}: 배열이 아닙니다`);
  if (v.length > max) fail(`${name}: 최대 ${max}개까지 가능합니다`);
  return v;
}

function rect(v: unknown, name: string, W: number, H: number): Rect {
  const o = obj(v, name);
  return {
    x: num(o.x, `${name}.x`, -W, W),
    y: num(o.y, `${name}.y`, -H, H),
    w: num(o.w, `${name}.w`, 1, W),
    h: num(o.h, `${name}.h`, 1, H),
  };
}

function point(v: unknown, name: string, W: number, H: number): Point {
  const o = obj(v, name);
  return { x: num(o.x, `${name}.x`, -W, W * 2), y: num(o.y, `${name}.y`, -H, H * 2) };
}

function mover(v: unknown, name: string, W: number, H: number): Mover {
  const o = obj(v, name);
  const path = arr(o.path, `${name}.path`, LIMITS.maxPathPoints).map((p, i) => point(p, `${name}.path[${i}]`, W, H));
  if (path.length === 0) fail(`${name}.path: 지점이 최소 1개 필요합니다`);
  const mode = o.mode === 'loop' ? 'loop' : o.mode === 'pingpong' ? 'pingpong' : fail(`${name}.mode: pingpong 또는 loop`);
  return {
    w: num(o.w, `${name}.w`, 1, W),
    h: num(o.h, `${name}.h`, 1, H),
    path,
    speed: num(o.speed, `${name}.speed`, 0, LIMITS.maxSpeed),
    mode,
    offset: o.offset === undefined ? 0 : num(o.offset, `${name}.offset`, 0, LIMITS.maxOffset),
  };
}

/**
 * 외부에서 들어온 맵(공유 링크, 파일, 추후 서버 업로드)을 검증하고
 * 알 수 없는 필드를 제거한 깨끗한 객체로 돌려준다.
 */
export function validateMap(input: unknown): MapData {
  const o = obj(input, '맵');
  if (o.v !== MAP_VERSION) fail(`지원하지 않는 맵 버전입니다 (${String(o.v)})`);
  const W = num(o.width, 'width', LIMITS.minSize, LIMITS.maxSize);
  const H = num(o.height, 'height', LIMITS.minSize, LIMITS.maxSize);
  return {
    v: MAP_VERSION,
    name: text(o.name, 'name') || '이름 없는 맵',
    author: text(o.author, 'author'),
    width: W,
    height: H,
    start: rect(o.start, 'start', W, H),
    goal: rect(o.goal, 'goal', W, H),
    walls: arr(o.walls, 'walls', LIMITS.maxWalls).map((w, i) => rect(w, `walls[${i}]`, W, H)),
    movers: arr(o.movers, 'movers', LIMITS.maxMovers).map((m, i) => mover(m, `movers[${i}]`, W, H)),
  };
}

/** 문법적으로는 맞지만 플레이에 문제가 될 수 있는 부분 */
export function mapWarnings(map: MapData): string[] {
  const out: string[] = [];
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= map.width && r.y + r.h <= map.height;
  if (!inside(map.start)) out.push('START 영역이 맵 밖으로 벗어나 있습니다.');
  if (!inside(map.goal)) out.push('GOAL 영역이 맵 밖으로 벗어나 있습니다.');
  if (rectsOverlap(map.start, map.goal)) out.push('START와 GOAL이 겹쳐 있습니다.');
  map.walls.forEach((w, i) => {
    if (rectsOverlap(w, map.start)) out.push(`벽 #${i + 1}이 START와 겹칩니다.`);
    if (rectsOverlap(w, map.goal)) out.push(`벽 #${i + 1}이 GOAL과 겹칩니다.`);
  });
  const p = { x: 0, y: 0 };
  map.movers.forEach((m, i) => {
    moverPos(compileMover(m), 0, p);
    if (rectsOverlap({ x: p.x, y: p.y, w: m.w, h: m.h }, map.start)) {
      out.push(`장애물 #${i + 1}이 시작 순간 START와 겹칩니다.`);
    }
  });
  return out;
}

export function createEmptyMap(): MapData {
  return {
    v: MAP_VERSION,
    name: '새 맵',
    author: '',
    width: 800,
    height: 500,
    start: { x: 20, y: 220, w: 60, h: 60 },
    goal: { x: 720, y: 220, w: 60, h: 60 },
    walls: [],
    movers: [],
  };
}
