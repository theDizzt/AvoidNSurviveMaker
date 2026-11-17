import { levelLabel, starGoals, starsFor, starText } from '../core/level';
import { DEFAULT_BADGE, type BadgeStyle } from '../core/theme-pack';
import { badgeImage, drawLevelBadge } from './badge';
import { formatTime, Simulation, type EndReason, type Replay } from '../core/simulation';
import type { MapData } from '../core/types';
import { HighResPointer, InputStats } from './input';
import { options } from './options';
import {
  beginFrame, clientToMap, COLORS, drawBanner, drawDarkAreas, drawGlobalDark, drawMap, drawStopwatch, drawTrail, fitCanvas,
  FONT_MAIN, mapPointer, unitsPerPx,
} from './render';

/**
 * When the mouse is idle and no events arrive, the simulation advances "in place",
 * but only up to this far behind the current time, so input that hasn't arrived yet isn't overwritten.
 */
const IDLE_MARGIN_MS = 40;
const TRAIL_POINTS = 800;
/** On-screen size (CSS px) of the virtual cursor that replaces the system cursor during a run */
const CURSOR_PX = 8;

const REASON_TEXT: Record<EndReason, string> = {
  wall: 'Touched a wall',
  mover: 'Hit a moving obstacle',
  void: 'Touched a wall',
  bounds: 'Left the map',
  laser: 'Hit a laser',
  left: 'Cursor left the window',
  blur: 'Window lost focus',
  pointer: 'Pointer input was interrupted',
};

export interface PlayElements {
  /** The play screen; gets the `running` class while a run is in progress */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  debug: HTMLElement;
}

export class PlayController {
  /** Called on clear (used to verify editor test plays) */
  onClear: ((map: MapData, replay: Replay, time: number) => void) | null = null;
  /** Called when the player presses Esc */
  onExit: (() => void) | null = null;
  /** Level badge design of the theme being played (null = the default look) */
  badge: { style: BadgeStyle; imageUrl?: string } | null = null;
  /** Shown after a clear when there is a next level, e.g. "N: next level" */
  nextHint: string | null = null;

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

  get status(): Simulation['status'] {
    return this.sim?.status ?? 'ready';
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
    if (e.button !== 0) return;
    if (this.sim.status === 'playing') {
      // Clicks during a run press click-operated switches
      const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
      this.sim.click(e.timeStamp - this.t0, p.x, p.y);
      return;
    }
    const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
    const sim = new Simulation(this.map);
    if (!sim.start(p.x, p.y)) return;
    e.preventDefault();
    this.sim = sim;
    this.t0 = e.timeStamp;
    this.trail = [p.x, p.y];
    this.trailTeleports = 0;
    this.notified = false;
    // Hide the system cursor right away instead of on the next frame
    this.el.root.classList.add('running');
  }

  private trailTeleports = 0;

  /** No trail line across a teleport */
  private breakTrailOnTeleport(): void {
    if (this.sim.teleports === this.trailTeleports) return;
    this.trailTeleports = this.sim.teleports;
    this.trail.push(NaN, NaN, this.sim.x, this.sim.y);
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
      this.breakTrailOnTeleport();
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
      this.breakTrailOnTeleport();
    }
    const running = sim.status === 'playing';
    if (running !== this.el.root.classList.contains('running')) this.el.root.classList.toggle('running', running);
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
    const t = sim.status === 'ready' ? 0 : sim.time;
    beginFrame(ctx, map);
    const state = sim.status === 'ready' ? {} : { hidden: sim.hidden, clock: sim.clock, doorOpen: sim.doorOpen, channels: sim.channels, progress: sim.progress };
    drawMap(ctx, map, sim.objects, t, { ...state, coinsLeft: sim.coinsLeft, beams: sim.beams, now });
    if (options.showTrail) drawTrail(ctx, this.trail, map.cursorColor);

    if (sim.status === 'playing') {
      // The system cursor is hidden during a run (CSS .running); this dot is exactly where the
      // simulation has the cursor, so what you see is what is checked for collisions
      const u = unitsPerPx(this.el.canvas, map);
      const r = (CURSOR_PX / 2) * u;
      ctx.fillStyle = map.cursorColor ?? COLORS.cursor;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Thin light rim so the dot stays visible on dark walls and floors
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = u;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, r - u / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Darkness goes over the cursor and trail; the timer and messages stay readable on top
    drawDarkAreas(ctx, sim.objects, t, 1, state);
    if (map.darkness && (sim.status === 'playing' || sim.status === 'ready')) {
      const light = map.darkness.light;
      const s = map.start;
      drawGlobalDark(ctx, map, sim.status === 'playing'
        ? [{ x: sim.x, y: sim.y, r: light }]
        : [{ x: s.x + s.w / 2, y: s.y + s.h / 2, r: Math.max(light, Math.hypot(s.w, s.h) / 2 + 12) }]);
    }

    // Level number (large) and title (small) at the top-left; the coin count goes below it
    const style = this.badge?.style ?? { ...DEFAULT_BADGE, numberColor: map.cursorColor ?? COLORS.cursor };
    const top = drawLevelBadge(ctx, map, style, badgeImage(this.badge?.imageUrl), now);

    if (sim.status === 'playing') {
      if (options.showTimer) drawStopwatch(ctx, map, now - this.t0, now);
      if (sim.coinTotal) this.drawCoinCount(top);
    } else if (sim.status === 'ready') {
      // The level number / title sit at the top-left; the banner says how to start
      const goals = starGoals(map);
      const coins = sim.coinTotal ? `Collect all ${sim.coinTotal} coin${sim.coinTotal === 1 ? '' : 's'}, then reach GOAL` : '';
      const rule = sim.objects.some((o) => o.role === 'path')
        ? 'Stay on the paths and reach GOAL without touching walls'
        : 'Reach GOAL without touching walls, obstacles, or the map edge';
      drawBanner(ctx, map, 'Click the START area to begin', [coins || (goals ? '' : rule), goals].filter(Boolean).join(' · '));
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
      const stars = starsFor(map, sim.endTime);
      const bestStars = best !== undefined ? starsFor(map, best) : null;
      const sub = [
        best !== undefined ? `Best ${formatTime(best)}s${bestStars !== null ? ` (${bestStars} star${bestStars === 1 ? '' : 's'})` : ''}` : '',
        this.nextHint ?? 'click START to try again',
      ].filter(Boolean).join(' — ');
      drawBanner(ctx, map, `${stars !== null ? `${starText(stars)}  ` : ''}Cleared! ${formatTime(sim.endTime)}s`, sub, '#d48f00');
    }
  }

  /** "● 2 / 5" pill at the top-left (below the level label) while coins remain to be found */
  private drawCoinCount(y: number): void {
    const { ctx, sim } = this;
    const text = `${sim.coinTotal - sim.coinsLeft} / ${sim.coinTotal}`;
    ctx.save();
    ctx.font = `700 15px ${FONT_MAIN}`;
    const w = ctx.measureText(text).width + 40;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.roundRect(12, y, w, 28, 14);
    ctx.fill();
    ctx.fillStyle = COLORS.coin;
    ctx.strokeStyle = COLORS.coinEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(28, y + 14, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = sim.coinsLeft ? COLORS.ink : '#1b9a72';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 42, y + 15);
    ctx.restore();
  }

  private updateText(now: number): void {
    const sim = this.sim;
    const state =
      sim.status === 'playing' ? `Playing · ${formatTime(now - this.t0)}s`
        : sim.status === 'ready' ? 'Ready'
          : sim.status === 'cleared' ? `Cleared · ${formatTime(sim.endTime)}s`
            : `Failed · ${REASON_TEXT[sim.endReason!]}`;
    this.el.status.textContent = `${levelLabel(this.map)}${this.map.author ? ` (by ${this.map.author})` : ''} — ${state}`;

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
