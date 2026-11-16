import { pointInRect, segmentRectEntry } from './geometry';
import { compileMover, moverPos, type CompiledMover } from './mover';
import type { MapData, Point } from './types';

export type SimStatus = 'ready' | 'playing' | 'dead' | 'cleared';
export type AbortReason = 'left' | 'blur' | 'pointer';
export type EndReason = 'wall' | 'mover' | 'bounds' | AbortReason;

/** t: 게임 시작(START 클릭) 기준 ms. 소수점 이하 정밀도 그대로 보존 */
export interface ReplaySample {
  t: number;
  x: number;
  y: number;
}

export interface Replay {
  v: 1;
  samples: ReplaySample[];
  abort?: { reason: AbortReason };
}

const tmp: Point = { x: 0, y: 0 };

/**
 * 결정적 1ms 고정 틱 시뮬레이션.
 *
 * - 입력 샘플(시각+좌표) 사이의 커서 경로를 선분으로 보고, 1ms 경계마다 잘라서 검사한다.
 * - 정지된 벽: 각 조각 선분과의 교차를 정확히 계산 → 아무리 빨리 움직여도 벽을 건너뛸 수 없음.
 * - 움직이는 장애물: 틱 k와 k+1 위치 사이를 선형 보간하고, 장애물 기준 "상대 운동" 선분으로
 *   검사 → 커서와 장애물이 동시에 움직여도 스쳐 지나가는 충돌까지 잡는다.
 * - 같은 샘플 목록을 넣으면 항상 같은 결과 → 리플레이 검증/랭킹 치트 방지에 사용 가능.
 */
export class Simulation {
  readonly map: MapData;
  readonly movers: readonly CompiledMover[];

  status: SimStatus = 'ready';
  /** 여기까지 검사가 끝난 시각 (ms) */
  time = 0;
  x = 0;
  y = 0;
  endReason: EndReason | null = null;
  /** 사망/클리어가 일어난 정확한 시각 (ms, 소수점 포함) */
  endTime = 0;

  private tick = 0;
  /** 틱 k / k+1 에서의 장애물 좌표 [x0,y0,x1,y1,...] */
  private mA: Float64Array;
  private mB: Float64Array;
  private samples: ReplaySample[] = [];
  private abortReason: AbortReason | null = null;

  constructor(map: MapData) {
    this.map = map;
    this.movers = map.movers.map(compileMover);
    this.mA = new Float64Array(this.movers.length * 2);
    this.mB = new Float64Array(this.movers.length * 2);
  }

  /** 처리한 1ms 틱 수 */
  get ticks(): number {
    return this.tick;
  }

  /** START 영역 안을 클릭했을 때만 시작된다. */
  start(x: number, y: number): boolean {
    if (!pointInRect(x, y, this.map.start)) return false;
    this.status = 'playing';
    this.time = 0;
    this.tick = 0;
    this.x = x;
    this.y = y;
    this.endReason = null;
    this.endTime = 0;
    this.abortReason = null;
    this.samples = [{ t: 0, x, y }];
    this.loadMovers(0);
    // 시작 순간 이미 장애물과 겹쳐 있는지
    this.checkSegment(0, x, y, 0, x, y);
    return true;
  }

  /** 입력 샘플 하나를 넣는다. 이미 처리한 시각 이전의 샘플은 무시. */
  feed(t: number, x: number, y: number): void {
    if (this.status !== 'playing' || !(t > this.time)) return;
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.samples.push({ t, x, y });

    const st = this.time;
    const sx = this.x;
    const sy = this.y;
    const dt = t - st;

    while (this.status === 'playing') {
      const boundary = this.tick + 1;
      if (t < boundary) {
        this.checkSegment(this.time, this.x, this.y, t, x, y);
        if (this.status === 'playing') {
          this.time = t;
          this.x = x;
          this.y = y;
        }
        return;
      }
      // 다음 1ms 경계까지 잘라서 검사
      const f = (boundary - st) / dt;
      const bx = sx + (x - sx) * f;
      const by = sy + (y - sy) * f;
      this.checkSegment(this.time, this.x, this.y, boundary, bx, by);
      if (this.status !== 'playing') return;
      this.time = boundary;
      this.x = bx;
      this.y = by;
      this.tick = boundary;
      this.advanceMovers(boundary);
      if (t === boundary) return;
    }
  }

  /** 마우스가 멈춰 있어 이벤트가 없을 때, 같은 위치에 머문 것으로 보고 시간을 진행 */
  advanceTo(t: number): void {
    this.feed(t, this.x, this.y);
  }

  /** 창 밖으로 나감, 포커스 잃음 등 외부 요인으로 실패 처리 */
  abort(reason: AbortReason): void {
    if (this.status !== 'playing') return;
    this.status = 'dead';
    this.endReason = reason;
    this.endTime = this.time;
    this.abortReason = reason;
  }

  getReplay(): Replay {
    const r: Replay = { v: 1, samples: this.samples.slice() };
    if (this.abortReason) r.abort = { reason: this.abortReason };
    return r;
  }

  private loadMovers(k: number): void {
    for (let i = 0; i < this.movers.length; i++) {
      moverPos(this.movers[i], k, tmp);
      this.mA[i * 2] = tmp.x;
      this.mA[i * 2 + 1] = tmp.y;
      moverPos(this.movers[i], k + 1, tmp);
      this.mB[i * 2] = tmp.x;
      this.mB[i * 2 + 1] = tmp.y;
    }
  }

  private advanceMovers(k: number): void {
    const prev = this.mA;
    this.mA = this.mB;
    this.mB = prev;
    for (let i = 0; i < this.movers.length; i++) {
      moverPos(this.movers[i], k + 1, tmp);
      this.mB[i * 2] = tmp.x;
      this.mB[i * 2 + 1] = tmp.y;
    }
  }

  /** [ta,tb] ⊂ [tick, tick+1] 구간의 커서 이동 선분을 검사 */
  private checkSegment(ta: number, xa: number, ya: number, tb: number, xb: number, yb: number): void {
    const { map } = this;
    let best = Infinity;
    let reason: EndReason | null = null;

    for (const w of map.walls) {
      const e = segmentRectEntry(xa, ya, xb, yb, w.x, w.y, w.w, w.h);
      if (e >= 0 && e < best) {
        best = e;
        reason = 'wall';
      }
    }

    const fa = ta - this.tick;
    const fb = tb - this.tick;
    const { mA, mB } = this;
    for (let i = 0; i < this.movers.length; i++) {
      const m = this.movers[i].src;
      const ax = mA[i * 2] + (mB[i * 2] - mA[i * 2]) * fa;
      const ay = mA[i * 2 + 1] + (mB[i * 2 + 1] - mA[i * 2 + 1]) * fa;
      const bx = mA[i * 2] + (mB[i * 2] - mA[i * 2]) * fb;
      const by = mA[i * 2 + 1] + (mB[i * 2 + 1] - mA[i * 2 + 1]) * fb;
      // 장애물 기준 상대 좌표로 변환 → 장애물은 원점에 고정된 사각형
      const e = segmentRectEntry(xa - ax, ya - ay, xb - bx, yb - by, 0, 0, m.w, m.h);
      if (e >= 0 && e < best) {
        best = e;
        reason = 'mover';
      }
    }

    // 맵 경계 밖으로 나가는 지점
    let exit = Infinity;
    if (xb < 0) exit = Math.min(exit, xa / (xa - xb));
    if (xb > map.width) exit = Math.min(exit, (map.width - xa) / (xb - xa));
    if (yb < 0) exit = Math.min(exit, ya / (ya - yb));
    if (yb > map.height) exit = Math.min(exit, (map.height - ya) / (yb - ya));
    if (exit < best) {
      best = Math.max(0, exit);
      reason = 'bounds';
    }

    const g = map.goal;
    const goal = segmentRectEntry(xa, ya, xb, yb, g.x, g.y, g.w, g.h);
    // 같은 지점이면 사망 판정이 우선
    if (goal >= 0 && goal < best) {
      this.finish('cleared', null, goal, ta, xa, ya, tb, xb, yb);
    } else if (reason) {
      this.finish('dead', reason, best, ta, xa, ya, tb, xb, yb);
    }
  }

  private finish(
    status: 'dead' | 'cleared', reason: EndReason | null, f: number,
    ta: number, xa: number, ya: number, tb: number, xb: number, yb: number,
  ): void {
    this.status = status;
    this.endReason = reason;
    this.endTime = ta + (tb - ta) * f;
    this.time = this.endTime;
    this.x = xa + (xb - xa) * f;
    this.y = ya + (yb - ya) * f;
  }
}

/** 리플레이를 처음부터 다시 실행 (서버 측 기록 검증용) */
export function runReplay(map: MapData, replay: Replay): Simulation {
  const sim = new Simulation(map);
  const [first, ...rest] = replay.samples;
  if (!first || first.t !== 0 || !sim.start(first.x, first.y)) return sim;
  for (const s of rest) sim.feed(s.t, s.x, s.y);
  if (replay.abort) sim.abort(replay.abort.reason);
  return sim;
}

/** ms → "12.345" (1ms 단위, 버림) */
export function formatTime(ms: number): string {
  return (Math.floor(Math.max(0, ms)) / 1000).toFixed(3);
}
