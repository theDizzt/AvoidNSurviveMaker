import { moverPos, type CompiledMover } from '../core/mover';
import type { MapData, Point, Rect } from '../core/types';

export const COLORS = {
  bg: '#10141b',
  grid: 'rgba(255,255,255,0.045)',
  wall: '#56667d',
  wallEdge: '#7f93ad',
  mover: '#ff5468',
  start: 'rgba(64,196,120,0.28)',
  startEdge: '#46c878',
  goal: 'rgba(255,196,60,0.28)',
  goalEdge: '#ffc43c',
  trail: 'rgba(110,196,255,0.75)',
  cursor: '#8fd3ff',
  hit: '#ff2d45',
  select: '#ffffff',
  path: 'rgba(255,84,104,0.55)',
};

const tmp: Point = { x: 0, y: 0 };

/** 맵 비율에 맞춰 캔버스 CSS 크기와 devicePixelRatio 반영한 실제 해상도를 설정 */
export function fitCanvas(canvas: HTMLCanvasElement, map: MapData): void {
  const avail = canvas.parentElement?.clientWidth ?? map.width;
  const cssW = Math.max(100, Math.min(avail, map.width));
  const cssH = (cssW * map.height) / map.width;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

/** 이후 그리기를 맵 좌표계로 */
export function beginFrame(ctx: CanvasRenderingContext2D, map: MapData): void {
  const s = ctx.canvas.width / map.width;
  ctx.setTransform(s, 0, 0, s, 0, 0);
}

/** 화면 1 CSS px이 맵 좌표로 몇 단위인지 */
export function unitsPerPx(canvas: HTMLCanvasElement, map: MapData): number {
  const w = canvas.getBoundingClientRect().width;
  return w > 0 ? map.width / w : 1;
}

export function clientToMap(canvas: HTMLCanvasElement, map: MapData, clientX: number, clientY: number): Point {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) * map.width) / (r.width || 1),
    y: ((clientY - r.top) * map.height) / (r.height || 1),
  };
}

function zone(ctx: CanvasRenderingContext2D, r: Rect, fill: string, edge: string, label: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.fillStyle = edge;
  ctx.font = `700 ${Math.max(8, Math.min(14, r.h * 0.3, r.w * 0.2))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

export function drawMap(
  ctx: CanvasRenderingContext2D, map: MapData, movers: readonly CompiledMover[], t: number,
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, map.width, map.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 50; x < map.width; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, map.height);
  }
  for (let y = 50; y < map.height; y += 50) {
    ctx.moveTo(0, y);
    ctx.lineTo(map.width, y);
  }
  ctx.stroke();

  zone(ctx, map.start, COLORS.start, COLORS.startEdge, 'START');
  zone(ctx, map.goal, COLORS.goal, COLORS.goalEdge, 'GOAL');

  ctx.fillStyle = COLORS.wall;
  ctx.strokeStyle = COLORS.wallEdge;
  ctx.lineWidth = 1;
  for (const w of map.walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
  }

  ctx.fillStyle = COLORS.mover;
  for (const cm of movers) {
    moverPos(cm, t, tmp);
    ctx.fillRect(tmp.x, tmp.y, cm.src.w, cm.src.h);
  }
}

export function drawTrail(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  if (pts.length < 4) return;
  ctx.strokeStyle = COLORS.trail;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

export function drawBanner(ctx: CanvasRenderingContext2D, map: MapData, title: string, sub = '', color = '#fff'): void {
  const w = Math.min(map.width - 40, 460);
  const h = sub ? 76 : 50;
  const x = (map.width - w) / 2;
  const y = 16;
  ctx.fillStyle = 'rgba(8,10,14,0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillText(title, map.width / 2, y + (sub ? 26 : h / 2));
  if (sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(sub, map.width / 2, y + 54);
  }
}
