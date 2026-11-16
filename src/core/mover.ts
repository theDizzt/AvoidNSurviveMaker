import type { Mover, Point } from './types';

export interface CompiledMover {
  readonly src: Mover;
  /** loop 모드면 첫 지점을 끝에 한 번 더 붙인 경로 */
  readonly pts: readonly Point[];
  /** 각 지점까지의 누적 거리 */
  readonly cum: Float64Array;
  readonly total: number;
}

export function compileMover(m: Mover): CompiledMover {
  const pts = m.mode === 'loop' && m.path.length > 1 ? [...m.path, m.path[0]] : m.path.slice();
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return { src: m, pts, cum, total: pts.length > 0 ? cum[pts.length - 1] : 0 };
}

/**
 * 시각 tMs(게임 시작 기준 ms)에서 장애물의 왼쪽 위 좌표.
 * 누적 상태 없이 시간만으로 계산되는 닫힌 식이라 항상 같은 입력 → 같은 결과(결정적).
 */
export function moverPos(cm: CompiledMover, tMs: number, out: Point): Point {
  const m = cm.src;
  const { pts, cum, total } = cm;
  if (pts.length < 2 || total <= 0 || m.speed <= 0) {
    out.x = pts[0].x - m.w / 2;
    out.y = pts[0].y - m.h / 2;
    return out;
  }
  let d = (m.speed * (tMs + m.offset)) / 1000;
  if (m.mode === 'pingpong') {
    const period = total * 2;
    d %= period;
    if (d > total) d = period - d;
  } else {
    d %= total;
  }
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1];
  const f = seg > 0 ? (d - cum[i - 1]) / seg : 0;
  out.x = a.x + (b.x - a.x) * f - m.w / 2;
  out.y = a.y + (b.y - a.y) * f - m.h / 2;
  return out;
}
