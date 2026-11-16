import type { Mover, Point } from './types';

export interface CompiledMover {
  readonly src: Mover;
  /** In loop mode, the path with the first waypoint appended again at the end */
  readonly pts: readonly Point[];
  /** Cumulative distance up to each waypoint */
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
 * Top-left position of the obstacle at time tMs (ms since the run started).
 * A closed-form function of time with no accumulated state, so the same input
 * always gives the same result (deterministic).
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
