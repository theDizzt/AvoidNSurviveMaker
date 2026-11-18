import { t as tr } from '../core/i18n';
import { levelLabel, starGoals, starsFor, starText } from '../core/level';
import { recordTime } from '../core/time';
import { DEFAULT_BADGE, type BadgeStyle } from '../core/theme-pack';
import { badgeImage, drawLevelBadge } from './badge';
import { badgeTitle } from './theme-registry';
import { COIN_PULL_MS, formatSeconds, Simulation, type Replay } from '../core/simulation';
import type { MapData } from '../core/types';
import { HighResPointer, InputStats } from './input';
import { options } from './options';
import { gameAudio } from './audio';
import { DeathBurst } from './death-burst';
import { drawFogAreas } from './fog';
import {
  beginFrame, clientToMap, COLORS, drawBanner, drawCoinPulls, drawDarkAreas, drawGlobalDark, drawMap, drawStopwatch, drawTrail, fitCanvas,
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
  /** Called when the maze ends a run (wall, moving wall, void, bounds, laser) — not for runs the
   *  browser stopped (cursor left the window, focus lost, non-mouse pointer) */
  onDeath: ((map: MapData) => void) | null = null;
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
  private deathNotified = false;
  private burst: DeathBurst | null = null;
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
    // Touch/pen lose position the moment they lift, so lifting the finger that runs is a fail.
    // Other fingers don't matter: they never move the cursor (see runPointer)
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerId === this.runPointer) this.abort('pointer');
    });
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.runPointer) this.abort('pointer');
    });
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
    this.burst = null;
    this.deathNotified = false;
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
    this.burst = null;
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
      // Clicks during a run press click-operated switches. Another finger (touch) taps where the
      // running finger is: it must never move the cursor, or a second finger could jump to GOAL
      const sim = this.sim;
      const p = e.pointerId === this.runPointer
        ? clientToMap(this.el.canvas, this.map, e.clientX, e.clientY)
        : { x: sim.x - sim.offX, y: sim.y - sim.offY };
      sim.click(e.timeStamp - this.t0, p.x, p.y);
      return;
    }
    const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
    const sim = new Simulation(this.map);
    if (!sim.start(p.x, p.y)) return;
    e.preventDefault();
    this.sim = sim;
    this.runPointer = e.pointerId;
    this.burst = null;
    this.deathNotified = false;
    this.t0 = e.timeStamp;
    this.trail = [p.x, p.y];
    this.trailTeleports = 0;
    this.notified = false;
    // Hide the system cursor right away instead of on the next frame
    this.el.root.classList.add('running');
  }

  private trailTeleports = 0;
  /** The pointer that started the current run; samples from any other pointer are ignored */
  private runPointer = -1;

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
      // Only the pointer (finger) that started the run moves the cursor
      if (ev.pointerId !== this.runPointer) continue;
      toMap(ev.clientX, ev.clientY, p);
      sim.feed(ev.timeStamp - this.t0, p.x, p.y);
      this.breakTrailOnTeleport();
      this.trail.push(sim.x, sim.y);
      if (sim.status !== 'playing') break;
    }
    if (this.trail.length > TRAIL_POINTS * 2) this.trail.splice(0, this.trail.length - TRAIL_POINTS * 2);
  }

  /** The run whose coin count `coinsLeft` was last seen in (for the coin sound) */
  private coinSim: Simulation | null = null;
  private coinsLeft = 0;

  private frame(): void {
    if (!this.visible || !this.map) return;
    const now = performance.now();
    const sim = this.sim;

    if (sim.status === 'playing') {
      const target = now - this.t0 - IDLE_MARGIN_MS;
      if (target > sim.time) sim.advanceTo(target);
      this.breakTrailOnTeleport();
    }
    // Coins are collected both here and in the pointer handler, so compare with the last frame
    if (this.coinSim !== sim) {
      this.coinSim = sim;
      this.coinsLeft = sim.coinsLeft;
    } else if (sim.coinsLeft < this.coinsLeft) {
      this.coinsLeft = sim.coinsLeft;
      gameAudio.play('coin');
    }
    const running = sim.status === 'playing';
    if (sim.status === 'dead' && !this.deathNotified) {
      this.deathNotified = true;
      this.burst = new DeathBurst(sim.x, sim.y, COLORS.cursor, now);
      if (sim.endReason !== 'blur' && sim.endReason !== 'left') gameAudio.death();
      if (sim.endReason !== 'blur' && sim.endReason !== 'left' && sim.endReason !== 'pointer') this.onDeath?.(this.map);
    }
    if (running !== this.el.root.classList.contains('running')) this.el.root.classList.toggle('running', running);
    if (sim.status === 'cleared' && !this.notified) {
      this.notified = true;
      gameAudio.play('finish');
      const key = JSON.stringify(this.map);
      const prev = this.best.get(key);
      const time = recordTime(sim.endTime);
      if (prev === undefined || time < prev) this.best.set(key, time);
      this.onClear?.(this.map, sim.getReplay(), time);
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
    if (options.showTrail) drawTrail(ctx, this.trail);
    if (sim.status !== 'ready') drawCoinPulls(ctx, sim, t, sim.x, sim.y, COIN_PULL_MS);

    if (sim.status === 'playing') {
      // The system cursor is hidden during a run (CSS .running); this dot is exactly where the
      // simulation has the cursor, so what you see is what is checked for collisions
      const u = unitsPerPx(this.el.canvas, map);
      const r = (CURSOR_PX / 2) * u;
      ctx.fillStyle = COLORS.cursor;
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

    // Fog, sand dust and darkness go over the cursor and trail; the timer and messages stay readable on top
    drawFogAreas(ctx, map, sim.objects, t, now, 1, state);
    drawDarkAreas(ctx, sim.objects, t, 1, state);
    if (map.darkness && (sim.status === 'playing' || sim.status === 'ready')) {
      const light = map.darkness.light;
      const s = map.start;
      drawGlobalDark(ctx, map, sim.status === 'playing'
        ? [{ x: sim.x, y: sim.y, r: light }]
        : [{ x: s.x + s.w / 2, y: s.y + s.h / 2, r: Math.max(light, Math.hypot(s.w, s.h) / 2 + 12) }]);
    }

    if (this.burst && !this.burst.draw(ctx, now, unitsPerPx(this.el.canvas, map))) this.burst = null;

    // Level number (large) and title (small) at the top-left; the coin count goes below it
    const style = this.badge?.style ?? { ...DEFAULT_BADGE, numberColor: COLORS.cursor };
    // Maps without a number or title (e.g. editor test play) still show their name in the badge
    const top = drawLevelBadge(ctx, map.level === undefined && !map.title ? { ...map, title: badgeTitle(map) } : map, style, badgeImage(this.badge?.imageUrl), now);

    if (options.showTimer) {
      const elapsed = sim.status === 'ready' ? 0
        : sim.status === 'playing' ? now - this.t0
          : sim.status === 'cleared' ? recordTime(sim.endTime) : sim.endTime;
      drawStopwatch(ctx, map, elapsed, now);
    }

    if (sim.status === 'playing') {
      if (sim.coinTotal) this.drawCoinCount(top);
    } else if (sim.status === 'ready') {
      // The level number / title sit at the top-left; the banner says how to start
      const goals = starGoals(map);
      const coins = sim.coinTotal ? tr(sim.coinTotal === 1 ? 'play.coinsOne' : 'play.coinsMany', { n: sim.coinTotal }) : '';
      const rule = sim.objects.some((o) => o.role === 'path')
        ? tr('play.rulePaths')
        : tr('play.ruleWalls');
      drawBanner(ctx, map, tr('play.clickStart'), [coins || (goals ? '' : rule), goals].filter(Boolean).join(' · '));
    } else if (sim.status === 'dead') {
      ctx.strokeStyle = COLORS.hit;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sim.x - 8, sim.y - 8);
      ctx.lineTo(sim.x + 8, sim.y + 8);
      ctx.moveTo(sim.x + 8, sim.y - 8);
      ctx.lineTo(sim.x - 8, sim.y + 8);
      ctx.stroke();
      drawBanner(ctx, map, tr('play.failedBanner', { time: formatSeconds(sim.endTime) }), tr('play.failedSub'), '#e2486c');
    } else {
      const best = this.best.get(JSON.stringify(map));
      const stars = starsFor(map, recordTime(sim.endTime));
      const bestStars = best !== undefined ? starsFor(map, best) : null;
      const sub = [
        best !== undefined
          ? tr('play.best', { time: formatSeconds(best) }) + (bestStars !== null ? tr(bestStars === 1 ? 'play.bestStarsOne' : 'play.bestStarsMany', { n: bestStars }) : '')
          : '',
        this.nextHint ?? tr('play.tryAgain'),
      ].filter(Boolean).join(' — ');
      drawBanner(ctx, map, `${stars !== null ? `${starText(stars)}  ` : ''}${tr('play.cleared', { time: formatSeconds(recordTime(sim.endTime)) })}`, sub, '#d48f00');
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
      sim.status === 'playing' ? tr('play.statusPlaying', { time: formatSeconds(now - this.t0) })
        : sim.status === 'ready' ? tr('play.statusReady')
          : sim.status === 'cleared' ? tr('play.statusCleared', { time: formatSeconds(recordTime(sim.endTime)) })
            : tr('play.statusFailed');
    this.el.status.textContent = `${levelLabel(this.map)}${this.map.author ? tr('play.byAuthor', { author: this.map.author }) : ''} — ${state}`;

    const s = this.stats.summary();
    const rows: [string, string][] = [
      [tr('debug.inputEvent'), `${this.input.source}${this.input.coalesced ? ' + getCoalescedEvents' : tr('debug.noCoalesced')}`],
      [tr('debug.sampleInterval'), s.medianMs !== null ? `${s.medianMs.toFixed(3)} ms` : tr('debug.keepMoving')],
      [tr('debug.pollingRate'), s.hz !== null ? `${Math.round(s.hz)} Hz` : '-'],
      [tr('debug.minInterval'), s.minMs !== null ? `${s.minMs.toFixed(3)} ms` : '-'],
      [tr('debug.samplesPerEvent'), `${s.avgPerEvent.toFixed(1)} / ${s.maxPerEvent}`],
      [tr('debug.totalSamples'), String(s.total)],
      [tr('debug.ticks'), String(sim.ticks)],
      [tr('debug.fps'), this.fps.toFixed(0)],
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
