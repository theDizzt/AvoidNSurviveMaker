import { t as tr } from './i18n';
import { levelLabel, starGoals, starsFor, starText } from './localized/level';
import { recordTime } from '../core/time';
import { pointInRect } from '../core/geometry';
import { objectLights } from '../core/lighting';
import { toWorld, transformAt, type Transform } from '../core/object';
import { DEFAULT_BADGE, type BadgeStyle } from './localized/theme-pack';
import { drawPointer, drawSkinTrail, skin } from './skin';
import { badgeImage, drawLevelBadge } from './badge';
import { badgeTitle } from './theme-registry';
import { COIN_PULL_MS, formatSeconds, Simulation, type Replay } from '../core/simulation';
import type { MapData } from '../core/types';
import { HighResPointer, InputStats } from './input';
import { AutoPolling } from './auto-polling';
import { onOptionsChange, options } from './options';
import { gameAudio } from './audio';
import { DeathBurst } from './death-burst';
import { drawFogAreas } from './fog';
import {
  beginFrame, clientToMap, COLORS, drawBanner, drawCoinPulls, drawCrystalAt, drawDarkAreas, drawGlobalDark, drawMap, drawSecretWalls, drawStopwatch, drawTorchAt, fitCanvas,
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
/** A carryable torch (#58) is picked up when the cursor comes this close to its edge (map units) */
const TORCH_PICKUP = 6;
const poseTmp: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

export interface PlayElements {
  /** The play screen; gets the `running` class while a run is in progress */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  debug: HTMLElement;
}

export class PlayController {
  /** Called on clear (used to verify editor test plays) */
  /** `crystal`: the run carried the map's crystal star (#59) to GOAL */
  onClear: ((map: MapData, replay: Replay, time: number, crystal: boolean) => void) | null = null;
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
  private mapKey = '';
  private sim!: Simulation;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: HighResPointer;
  private readonly stats = new InputStats();
  private readonly usedStats = new InputStats();
  private readonly autoPolling = new AutoPolling();
  private t0 = 0;
  private trail: number[] = [];
  /** Per map object: 1 while the cursor carries that torch (#58); cosmetic, reset every run */
  private carried = new Uint8Array(0);
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
    let measuredRate = options.pollingRate;
    onOptionsChange(next => {
      if (next.pollingRate === measuredRate) return;
      measuredRate = next.pollingRate;
      this.autoPolling.resetMeasurement();
      this.stats.reset();
      this.usedStats.reset();
    });

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
    this.mapKey = JSON.stringify(map);
    this.reset(true);
    fitCanvas(this.el.canvas, map);
  }

  reset(recompile = false): void {
    this.autoPolling.resetMeasurement();
    this.stats.reset();
    this.usedStats.reset();
    this.burst = null;
    this.deathNotified = false;
    this.sim = new Simulation(this.map, recompile ? undefined : this.sim.objects);
    this.trail = [];
    this.carried = new Uint8Array(this.map.objects.length);
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
    if (!pointInRect(p.x, p.y, this.map.start)) return;
    const sim = new Simulation(this.map, this.sim.objects);
    if (!sim.start(p.x, p.y)) return;
    e.preventDefault();
    this.sim = sim;
    this.runPointer = e.pointerId;
    this.lastSampleAt = e.timeStamp;
    this.autoPolling.resetMeasurement();
    this.stats.reset();
    this.usedStats.reset();
    this.burst = null;
    this.deathNotified = false;
    this.t0 = e.timeStamp;
    this.trail = [p.x, p.y];
    this.carried = new Uint8Array(this.map.objects.length);
    this.trailTeleports = 0;
    this.notified = false;
    // Hide the system cursor right away instead of on the next frame
    this.el.root.classList.add('running');
  }

  private trailTeleports = 0;
  /** The pointer that started the current run; samples from any other pointer are ignored */
  private runPointer = -1;
  /** Timestamp of the last pointer sample used, for the polling rate option */
  private lastSampleAt = -Infinity;

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
    const automatic = options.pollingRate === -1;
    const workStarted = automatic ? performance.now() : 0;
    const toMap = mapPointer(this.el.canvas, this.map);
    const p = this.point;
    // Polling rate option: use at most this many samples per second. The simulation still runs in
    // 1 ms steps on each sample's own timestamp, so records keep their 1 ms precision.
    const rate = automatic ? this.autoPolling.rate : options.pollingRate;
    const gap = rate > 0 ? 1000 / rate : 0;
    for (const ev of list) {
      // Only the pointer (finger) that started the run moves the cursor
      if (ev.pointerId !== this.runPointer) continue;
      // Small tolerance: hardware timestamps jitter around the nominal interval
      if (gap && ev.timeStamp - this.lastSampleAt < gap * 0.9) continue;
      this.lastSampleAt = ev.timeStamp;
      toMap(ev.clientX, ev.clientY, p);
      // feed ignores samples already overtaken by idle advancement or click handling.
      const accepted = ev.timeStamp - this.t0 > sim.time;
      sim.feed(ev.timeStamp - this.t0, p.x, p.y);
      if (accepted) this.usedStats.recordSample(ev.timeStamp);
      this.breakTrailOnTeleport();
      this.trail.push(sim.x, sim.y);
      if (sim.status !== 'playing') break;
    }
    if (this.trail.length > TRAIL_POINTS * 2) this.trail.splice(0, this.trail.length - TRAIL_POINTS * 2);
    if (automatic) this.autoPolling.addInputWork(performance.now() - workStarted);
  }

  /** The run whose coin count `coinsLeft` was last seen in (for the coin sound) */
  private coinSim: Simulation | null = null;
  private coinsLeft = 0;
  /** Whether that run already held its crystal star (for the star sound) */
  private crystalHeld = false;

  private frame(): void {
    if (!this.visible || !this.map) return;
    const now = performance.now();
    const sim = this.sim;
    const measure = options.pollingRate === -1 && sim.status === 'playing';

    if (sim.status === 'playing') {
      const target = now - this.t0 - IDLE_MARGIN_MS;
      if (target > sim.time) sim.advanceTo(target);
      this.breakTrailOnTeleport();
      this.pickUpTorches();
    }
    // Coins are collected both here and in the pointer handler, so compare with the last frame
    if (this.coinSim !== sim) {
      this.coinSim = sim;
      this.coinsLeft = sim.coinsLeft;
      this.crystalHeld = sim.crystalHeld;
    } else {
      if (sim.coinsLeft < this.coinsLeft) {
        this.coinsLeft = sim.coinsLeft;
        gameAudio.play('coin');
      }
      // The crystal star (#59) was just picked up
      if (sim.crystalHeld && !this.crystalHeld) gameAudio.play('star');
      this.crystalHeld = sim.crystalHeld;
    }
    const running = sim.status === 'playing';
    if (sim.status === 'dead' && !this.deathNotified) {
      this.deathNotified = true;
      this.burst = new DeathBurst(sim.x, sim.y, skin.primary, now);
      if (sim.endReason !== 'blur' && sim.endReason !== 'left') gameAudio.death();
      if (sim.endReason !== 'blur' && sim.endReason !== 'left' && sim.endReason !== 'pointer') this.onDeath?.(this.map);
    }
    if (running !== this.el.root.classList.contains('running')) this.el.root.classList.toggle('running', running);
    const native = skin.pointer === 0;
    if (native !== this.el.root.classList.contains('native-cursor')) this.el.root.classList.toggle('native-cursor', native);
    if (sim.status === 'cleared' && !this.notified) {
      this.notified = true;
      gameAudio.play('finish');
      const key = this.mapKey;
      const prev = this.best.get(key);
      const time = recordTime(sim.endTime);
      if (prev === undefined || time < prev) this.best.set(key, time);
      this.onClear?.(this.map, sim.getReplay(), time, sim.crystalHeld);
    }

    this.draw(now);
    if (measure && sim.status === 'playing' && this.autoPolling.frame(now, performance.now() - now)) {
      this.usedStats.reset();
    }

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

  /** The picked-up crystal star has finished flying into the cursor */
  private crystalFlownIn(t: number): boolean {
    const i = this.sim.objects.findIndex((o) => o.role === 'crystal');
    return i < 0 || t - this.sim.collectedAt[i] >= COIN_PULL_MS;
  }

  /** Carryable torches (#58) the cursor touches are picked up and carried for the rest of the run */
  private pickUpTorches(): void {
    const { sim, map, carried } = this;
    map.objects.forEach((m, i) => {
      if (!m.torch?.carry || carried[i] || sim.hidden[i]) return;
      const o = sim.objects[i];
      const c = toWorld(o, transformAt(o, sim.clock[i], poseTmp), o.cx, o.cy, { x: 0, y: 0 });
      const reach = Math.max(o.box.maxX - o.box.minX, o.box.maxY - o.box.minY) / 2 + TORCH_PICKUP;
      if (Math.hypot(sim.x - c.x, sim.y - c.y) <= reach) carried[i] = 1;
    });
  }

  private draw(now: number): void {
    const { ctx, map, sim } = this;
    const t = sim.status === 'ready' ? 0 : sim.time;
    beginFrame(ctx, map);
    const state = sim.status === 'ready' ? {} : { hidden: sim.hidden, clock: sim.clock, doorOpen: sim.doorOpen, channels: sim.channels, progress: sim.progress, pulleyAngle: sim.pulleyAngle };
    const playing = sim.status === 'playing';
    const carried = playing ? this.carried : undefined;
    drawMap(ctx, map, sim.objects, t, { ...state, coinsLeft: sim.coinsLeft, beams: sim.beams, now, carried,
      secretCursor: playing ? { x: sim.x, y: sim.y } : null });
    drawSkinTrail(ctx, skin, this.trail, unitsPerPx(this.el.canvas, map));
    if (sim.status !== 'ready') drawCoinPulls(ctx, sim, t, sim.x, sim.y, COIN_PULL_MS);
    // Secret walls cover the floor, obstacles and trail under them, except right around the cursor
    drawSecretWalls(ctx, map, sim.objects, t, playing ? { x: sim.x, y: sim.y } : null, 1, state);

    if (playing) {
      const u = unitsPerPx(this.el.canvas, map);
      // The system cursor is hidden during a run (CSS .running); this dot is exactly where the
      // simulation has the cursor, so what you see is what is checked for collisions
      // (pointer skin #0 draws nothing: the system cursor stays visible instead, see .native-cursor)
      drawPointer(ctx, skin, sim.x, sim.y, u, CURSOR_PX);
      // A held crystal star circles the cursor once it has flown in
      if (sim.crystalHeld && this.crystalFlownIn(t)) {
        const a = now / 380;
        drawCrystalAt(ctx, sim.x + Math.cos(a) * 15 * u, sim.y + Math.sin(a) * 15 * u, 13 * u, now);
      }
      // Carried torches ride just up and to the right of the cursor
      map.objects.forEach((_, i) => {
        if (!this.carried[i]) return;
        const o = sim.objects[i];
        const w = o.box.maxX - o.box.minX;
        const h = o.box.maxY - o.box.minY;
        drawTorchAt(ctx, sim.x + w * 0.5 + 6 * u, sim.y - h * 0.35, w, h, now, i);
      });
    }

    // Fog, sand dust and darkness go over the cursor and trail; the timer and messages stay readable on top
    drawFogAreas(ctx, map, sim.objects, t, now, 1, state);
    drawDarkAreas(ctx, sim.objects, t, 1, state);
    if (map.darkness && (sim.status === 'playing' || sim.status === 'ready')) {
      const light = map.darkness.light;
      const s = map.start;
      const lights = objectLights(sim.objects, t, playing ? { ...state, carried: this.carried, cursor: { x: sim.x, y: sim.y } } : state);
      if (light > 0) lights.push(sim.status === 'playing'
        ? { x: sim.x, y: sim.y, r: light }
        : { x: s.x + s.w / 2, y: s.y + s.h / 2, r: Math.max(light, Math.hypot(s.w, s.h) / 2 + 12) });
      drawGlobalDark(ctx, map, lights);
    }

    if (this.burst && !this.burst.draw(ctx, now, unitsPerPx(this.el.canvas, map))) this.burst = null;

    // Level number (large) and title (small) at the top-left; the coin count goes below it
    const style = this.badge?.style ?? { ...DEFAULT_BADGE, numberColor: COLORS.cursor };
    // Maps without a number or title (e.g. editor test play) still show their name in the badge
    const top = drawLevelBadge(ctx, map.level === undefined && !map.title ? { ...map, title: badgeTitle(map) } : map, style, badgeImage(this.badge?.imageUrl), now);

    const elapsed = sim.status === 'ready' ? 0
      : sim.status === 'playing' ? now - this.t0
        : sim.status === 'cleared' ? recordTime(sim.endTime) : sim.endTime;
    drawStopwatch(ctx, map, elapsed, now);

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
      const best = this.best.get(this.mapKey);
      const stars = starsFor(map, recordTime(sim.endTime));
      const bestStars = best !== undefined ? starsFor(map, best) : null;
      const sub = [
        best !== undefined
          ? tr('play.best', { time: formatSeconds(best) }) + (bestStars !== null ? tr(bestStars === 1 ? 'play.bestStarsOne' : 'play.bestStarsMany', { n: bestStars }) : '')
          : '',
        this.nextHint ?? tr('play.tryAgain'),
      ].filter(Boolean).join(' — ');
      const crystal = sim.hasCrystal ? (sim.crystalHeld ? tr('play.crystalGot') : tr('play.crystalMissed')) : '';
      drawBanner(ctx, map, `${stars !== null ? `${starText(stars)}${sim.crystalHeld ? ' ✦' : ''}  ` : ''}${tr('play.cleared', { time: formatSeconds(recordTime(sim.endTime)) })}`, [crystal, sub].filter(Boolean).join(' — '), '#d48f00');
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

    if (!options.showDebug) return;
    const s = this.stats.summary();
    const used = this.usedStats.summary();
    const rows: [string, string][] = [
      [tr('debug.inputEvent'), `${this.input.source}${this.input.coalesced ? ' + getCoalescedEvents' : tr('debug.noCoalesced')}`],
      [tr('debug.sampleInterval'), s.medianMs !== null ? `${s.medianMs.toFixed(3)} ms` : tr('debug.keepMoving')],
      [tr('debug.rawPollingRate'), s.hz !== null ? `${Math.round(s.hz)} Hz` : '-'],
      [tr('options.polling'), options.pollingRate === -1
        ? `${tr('options.pollingAuto')} (${this.autoPolling.rate} Hz)`
        : options.pollingRate ? `${options.pollingRate} Hz` : tr('options.pollingMax')],
      [tr('debug.usedPollingRate'), used.hz !== null ? `${Math.round(used.hz)} Hz` : tr('debug.usedPending')],
      [tr('debug.usedInterval'), used.medianMs !== null ? `${used.medianMs.toFixed(3)} ms` : '-'],
      [tr('debug.usedSamples'), String(used.total)],
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
