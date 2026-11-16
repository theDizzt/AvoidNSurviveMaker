import { formatTime, Simulation, type EndReason, type Replay } from '../core/simulation';
import type { MapData } from '../core/types';
import { HighResPointer, InputStats } from './input';
import { beginFrame, clientToMap, COLORS, drawBanner, drawMap, drawTrail, fitCanvas } from './render';

/**
 * 마우스가 멈춰 이벤트가 없을 때 시뮬레이션을 "제자리"로 진행시키는데,
 * 아직 도착하지 않은 입력을 덮어쓰지 않도록 현재 시각보다 이만큼 뒤까지만 진행.
 */
const IDLE_MARGIN_MS = 40;
const TRAIL_POINTS = 800;

const REASON_TEXT: Record<EndReason, string> = {
  wall: '벽에 닿았습니다',
  mover: '움직이는 장애물에 닿았습니다',
  bounds: '맵 밖으로 나갔습니다',
  left: '커서가 창 밖으로 나갔습니다',
  blur: '창 포커스를 잃었습니다',
  pointer: '포인터 입력이 끊겼습니다',
};

export interface PlayElements {
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  debug: HTMLElement;
}

export class PlayController {
  /** 클리어 시 호출 (에디터 테스트 플레이 검증용) */
  onClear: ((map: MapData, replay: Replay, time: number) => void) | null = null;

  private map!: MapData;
  private sim!: Simulation;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: HighResPointer;
  private readonly stats = new InputStats();
  private t0 = 0;
  private trail: number[] = [];
  private notified = false;
  private visible = false;
  private best = new Map<string, number>();
  private lastDebug = 0;
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;

  constructor(private readonly el: PlayElements) {
    this.ctx = el.canvas.getContext('2d')!;
    this.input = new HighResPointer((list) => this.onSamples(list));

    el.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    // 커서가 브라우저 창 밖으로 나감
    window.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget) this.abort('left');
    });
    window.addEventListener('blur', () => this.abort('blur'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.abort('blur');
    });
    // 터치/펜은 손을 떼는 순간 위치가 끊기므로 실패 처리
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') this.abort('pointer');
    });
    window.addEventListener('pointercancel', () => this.abort('pointer'));
    window.addEventListener('keydown', (e) => {
      if (this.visible && (e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLInputElement)) this.reset();
    });
    new ResizeObserver(() => this.map && fitCanvas(el.canvas, this.map)).observe(el.canvas.parentElement!);

    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  load(map: MapData): void {
    this.map = map;
    this.reset();
    fitCanvas(this.el.canvas, map);
  }

  reset(): void {
    this.sim = new Simulation(this.map);
    this.trail = [];
    this.notified = false;
  }

  show(): void {
    this.visible = true;
    this.input.attach();
    if (this.map) fitCanvas(this.el.canvas, this.map);
  }

  hide(): void {
    this.abort('blur');
    this.visible = false;
    this.input.detach();
  }

  private abort(reason: 'left' | 'blur' | 'pointer'): void {
    if (this.sim?.status === 'playing') this.sim.abort(reason);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || this.sim.status === 'playing') return;
    const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
    const sim = new Simulation(this.map);
    if (!sim.start(p.x, p.y)) return;
    e.preventDefault();
    this.sim = sim;
    this.t0 = e.timeStamp;
    this.trail = [p.x, p.y];
    this.notified = false;
  }

  private onSamples(list: readonly PointerEvent[]): void {
    this.stats.record(list);
    const sim = this.sim;
    if (!sim || sim.status !== 'playing') return;
    const r = this.el.canvas.getBoundingClientRect();
    const sx = this.map.width / (r.width || 1);
    const sy = this.map.height / (r.height || 1);
    for (const ev of list) {
      sim.feed(ev.timeStamp - this.t0, (ev.clientX - r.left) * sx, (ev.clientY - r.top) * sy);
      this.trail.push(sim.x, sim.y);
      if (sim.status !== 'playing') break;
    }
    if (this.trail.length > TRAIL_POINTS * 2) this.trail.splice(0, this.trail.length - TRAIL_POINTS * 2);
  }

  private frame(): void {
    if (!this.visible || !this.map) return;
    const now = performance.now();
    const sim = this.sim;

    if (sim.status === 'playing') {
      const target = now - this.t0 - IDLE_MARGIN_MS;
      if (target > sim.time) sim.advanceTo(target);
    }
    if (sim.status === 'cleared' && !this.notified) {
      this.notified = true;
      const key = JSON.stringify(this.map);
      const prev = this.best.get(key);
      if (prev === undefined || sim.endTime < prev) this.best.set(key, sim.endTime);
      this.onClear?.(this.map, sim.getReplay(), sim.endTime);
    }

    this.draw(now);

    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsAt);
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.lastDebug > 200) {
      this.lastDebug = now;
      this.updateText(now);
    }
  }

  private draw(now: number): void {
    const { ctx, map, sim } = this;
    beginFrame(ctx, map);
    drawMap(ctx, map, sim.movers, sim.status === 'ready' ? 0 : sim.time);
    drawTrail(ctx, this.trail);

    if (sim.status === 'playing') {
      ctx.fillStyle = COLORS.cursor;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, 3, 0, Math.PI * 2);
      ctx.fill();
      const elapsed = Math.max(0, now - this.t0);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 16px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(`${formatTime(elapsed)}s`, map.width - 10, 8);
    } else if (sim.status === 'ready') {
      drawBanner(ctx, map, 'START 영역을 클릭하면 시작', '벽·장애물·맵 밖에 닿지 않고 GOAL까지 가세요');
    } else if (sim.status === 'dead') {
      ctx.strokeStyle = COLORS.hit;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sim.x - 8, sim.y - 8);
      ctx.lineTo(sim.x + 8, sim.y + 8);
      ctx.moveTo(sim.x + 8, sim.y - 8);
      ctx.lineTo(sim.x - 8, sim.y + 8);
      ctx.stroke();
      drawBanner(ctx, map, `실패 · ${formatTime(sim.endTime)}s`, `${REASON_TEXT[sim.endReason!]} — START를 다시 클릭`, '#ff8090');
    } else {
      const best = this.best.get(JSON.stringify(map));
      drawBanner(ctx, map, `클리어! ${formatTime(sim.endTime)}s`, best !== undefined ? `최고 기록 ${formatTime(best)}s — START를 클릭해 재도전` : '', '#ffd166');
    }
  }

  private updateText(now: number): void {
    const sim = this.sim;
    const state =
      sim.status === 'playing' ? `진행 중 · ${formatTime(now - this.t0)}s`
        : sim.status === 'ready' ? '대기 중'
          : sim.status === 'cleared' ? `클리어 · ${formatTime(sim.endTime)}s`
            : `실패 · ${REASON_TEXT[sim.endReason!]}`;
    this.el.status.textContent = `${this.map.name}${this.map.author ? ` (by ${this.map.author})` : ''} — ${state}`;

    const s = this.stats.summary();
    const rows: [string, string][] = [
      ['입력 이벤트', `${this.input.source}${this.input.coalesced ? ' + getCoalescedEvents' : ' (coalesced 미지원)'}`],
      ['샘플 간격 (중앙값)', s.medianMs !== null ? `${s.medianMs.toFixed(3)} ms` : '마우스를 계속 움직여 보세요'],
      ['추정 폴링 레이트', s.hz !== null ? `${Math.round(s.hz)} Hz` : '-'],
      ['최소 간격', s.minMs !== null ? `${s.minMs.toFixed(3)} ms` : '-'],
      ['이벤트당 샘플 (평균/최대)', `${s.avgPerEvent.toFixed(1)} / ${s.maxPerEvent}`],
      ['누적 샘플', String(s.total)],
      ['시뮬레이션 틱 (1ms)', String(sim.ticks)],
      ['렌더링 FPS', this.fps.toFixed(0)],
    ];
    this.el.debug.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
  }
}
