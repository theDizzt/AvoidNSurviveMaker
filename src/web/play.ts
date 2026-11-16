import { formatTime, Simulation, type EndReason, type Replay } from '../core/simulation';
import type { MapData } from '../core/types';
import { HighResPointer, InputStats } from './input';
import { options } from './options';
import { beginFrame, clientToMap, COLORS, drawBanner, drawMap, drawTrail, fitCanvas, mapPointer } from './render';

/**
 * When the mouse is idle and no events arrive, the simulation advances "in place",
 * but only up to this far behind the current time, so input that hasn't arrived yet isn't overwritten.
 */
const IDLE_MARGIN_MS = 40;
const TRAIL_POINTS = 800;

const REASON_TEXT: Record<EndReason, string> = {
  wall: 'Touched a wall',
  mover: 'Hit a moving obstacle',
  void: 'Fell off the path',
  bounds: 'Left the map',
  left: 'Cursor left the window',
  blur: 'Window lost focus',
  pointer: 'Pointer input was interrupted',
};

export interface PlayElements {
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  debug: HTMLElement;
}

export class PlayController {
  /** Called on clear (used to verify editor test plays) */
  onClear: ((map: MapData, replay: Replay, time: number) => void) | null = null;
  /** Called when the player presses Esc */
  onExit: (() => void) | null = null;

  private map!: MapData;
  private sim!: Simulation;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: HighResPointer;
  private readonly stats = new InputStats();
  private t0 = 0;
  private trail: number[] = [];
  private readonly point = { x: 0, y: 0 };
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
    // Cursor left the browser window
    window.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget) this.abort('left');
    });
    window.addEventListener('blur', () => this.abort('blur'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.abort('blur');
    });
    // Touch/pen lose position the moment they lift, so treat that as a fail
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') this.abort('pointer');
    });
    window.addEventListener('pointercancel', () => this.abort('pointer'));
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.target instanceof HTMLInputElement) return;
      if (e.key === 'r' || e.key === 'R') this.reset();
      else if (e.key === 'Escape') this.onExit?.();
    });
    const refit = () => this.map && fitCanvas(el.canvas, this.map);
    new ResizeObserver(refit).observe(el.canvas.parentElement!);
    window.addEventListener('resize', refit);

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
    const toMap = mapPointer(this.el.canvas, this.map);
    const p = this.point;
    for (const ev of list) {
      toMap(ev.clientX, ev.clientY, p);
      sim.feed(ev.timeStamp - this.t0, p.x, p.y);
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
    drawMap(ctx, map, sim.objects, sim.status === 'ready' ? 0 : sim.time);
    if (options.showTrail) drawTrail(ctx, this.trail);

    if (sim.status === 'playing') {
      ctx.fillStyle = COLORS.cursor;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, 3, 0, Math.PI * 2);
      ctx.fill();
      if (options.showTimer) {
        const elapsed = Math.max(0, now - this.t0);
        ctx.fillStyle = COLORS.ink;
        ctx.font = '600 16px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`${formatTime(elapsed)}s`, map.width - 10, 8);
      }
    } else if (sim.status === 'ready') {
      drawBanner(
        ctx, map, 'Click the START area to begin',
        sim.objects.some((o) => o.role === 'path')
          ? 'Stay on the paths and reach GOAL without touching walls'
          : 'Reach GOAL without touching walls, obstacles, or the map edge',
      );
    } else if (sim.status === 'dead') {
      ctx.strokeStyle = COLORS.hit;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sim.x - 8, sim.y - 8);
      ctx.lineTo(sim.x + 8, sim.y + 8);
      ctx.moveTo(sim.x + 8, sim.y - 8);
      ctx.lineTo(sim.x - 8, sim.y + 8);
      ctx.stroke();
      drawBanner(ctx, map, `Failed · ${formatTime(sim.endTime)}s`, `${REASON_TEXT[sim.endReason!]} — click START to retry`, '#e2486c');
    } else {
      const best = this.best.get(JSON.stringify(map));
      drawBanner(ctx, map, `Cleared! ${formatTime(sim.endTime)}s`, best !== undefined ? `Best ${formatTime(best)}s — click START to try again` : '', '#d48f00');
    }
  }

  private updateText(now: number): void {
    const sim = this.sim;
    const state =
      sim.status === 'playing' ? `Playing · ${formatTime(now - this.t0)}s`
        : sim.status === 'ready' ? 'Ready'
          : sim.status === 'cleared' ? `Cleared · ${formatTime(sim.endTime)}s`
            : `Failed · ${REASON_TEXT[sim.endReason!]}`;
    this.el.status.textContent = `${this.map.name}${this.map.author ? ` (by ${this.map.author})` : ''} — ${state}`;

    const s = this.stats.summary();
    const rows: [string, string][] = [
      ['Input event', `${this.input.source}${this.input.coalesced ? ' + getCoalescedEvents' : ' (no coalesced events)'}`],
      ['Sample interval (median)', s.medianMs !== null ? `${s.medianMs.toFixed(3)} ms` : 'Keep moving the mouse'],
      ['Estimated polling rate', s.hz !== null ? `${Math.round(s.hz)} Hz` : '-'],
      ['Min interval', s.minMs !== null ? `${s.minMs.toFixed(3)} ms` : '-'],
      ['Samples per event (avg/max)', `${s.avgPerEvent.toFixed(1)} / ${s.maxPerEvent}`],
      ['Total samples', String(s.total)],
      ['Simulation ticks (1ms)', String(sim.ticks)],
      ['Render FPS', this.fps.toFixed(0)],
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
