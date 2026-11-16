import type { Rect } from './types';

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 선분 (x0,y0)→(x1,y1)이 사각형(rx,ry,rw,rh)에 처음 닿는 지점의 비율 t ∈ [0,1].
 * 닿지 않으면 -1, 시작점이 이미 안쪽이면 0. (Liang–Barsky 클리핑)
 * 매 1ms 틱마다 수많은 벽에 대해 호출되므로 할당 없이 작성.
 */
export function segmentRectEntry(
  x0: number, y0: number, x1: number, y1: number,
  rx: number, ry: number, rw: number, rh: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tEnter = 0;
  let tExit = 1;
  for (let i = 0; i < 4; i++) {
    let p: number;
    let q: number;
    switch (i) {
      case 0: p = -dx; q = x0 - rx; break;
      case 1: p = dx; q = rx + rw - x0; break;
      case 2: p = -dy; q = y0 - ry; break;
      default: p = dy; q = ry + rh - y0; break;
    }
    if (p === 0) {
      if (q < 0) return -1;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tExit) return -1;
      if (t > tEnter) tEnter = t;
    } else {
      if (t < tEnter) return -1;
      if (t < tExit) tExit = t;
    }
  }
  return tEnter;
}
