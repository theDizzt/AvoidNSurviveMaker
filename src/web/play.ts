import { t as tr } from './i18n';
import { FrameLimiter } from './graphics';
import { AutoQuality } from './auto-quality';
import { canvasUsage, formatBytes, gpuName, jsHeap } from './resource-monitor';
import { shortGpuName } from './device-profile';
import { levelLabel, starGoals, starsFor, starText } from './localized/level';
import { recordTime } from '../core/time';
import { ZoneArea } from '../core/zone';
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
import { onOptionsChange, options, type GraphicsLevel } from './options';
import { gameAudio } from './audio';
import { DeathBurst } from './death-burst';
import { drawFogAreas } from './fog';
import {
  beginFrame, clientToMap, COLORS, drawBanner, drawCoinPulls, drawShots, drawCrystalAt, drawDarkAreas, drawGlobalDark, drawMap, drawSecretWalls, drawStopwatch, drawTorchAt, fitCanvas,
  FONT_MAIN, mapPointer, releaseRenderCaches, unitsPerPx,
} from './render';

/**
 * When the mouse is idle and no events arrive, the simulation advances "in place",
 * but only up to this far behind the current time, so input that hasn't arrived yet isn't overwritten.
 */
const IDLE_MARGIN_MS = 40;
const TRAIL_POINTS = 800;
/** Smallest gap between trail points, in screen pixels (closer samples only move the head) */
const TRAIL_STEP_PX = 1.5;
/** On-screen size (CSS px) of the virtual cursor that replaces the system cursor during a run */
const CURSOR_PX = 8;
/** Room for the arrow/sword extending from the hotspot, including antialiasing padding. */
const CURSOR_SPRITE_PX = 64;
/** A carryable torch (#58) is picked up when the cursor comes this close to its edge (map units) */
const TORCH_PICKUP = 6;
const poseTmp: Transform = { dx: 0, dy: 0, cos: 1, sin: 0 };

export interface PlayElements {
  /** The play screen; gets the `running` class while a run is in progress */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  debug: HTMLElement;
  /** Frame rate counter (Show FPS option) */
  fps: HTMLElement;
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
  /** Graphics quality was lowered automatically (told once the run is over) */
  onAutoQuality: ((level: GraphicsLevel) => void) | null = null;
  private readonly autoQuality = new AutoQuality();
  private loweredTo: GraphicsLevel | null = null;
  /** Level badge design of the theme being played (null = the default look) */
  badge: { style: BadgeStyle; imageUrl?: string } | null = null;
  /** Shown after a clear when there is a next level, e.g. "N: next level" */
  nextHint: string | null = null;

  private map!: MapData;
  /** The map can move the cursor away from the mouse (ice, portals) */
  private drifts = false;
  /**
   * The mouse position fed to the run, in map units. On maps where the cursor drifts, the run
   * locks the pointer: the real mouse can't leave the window (steering against a slide often
   * takes the hand far away), and moves this position by its relative motion instead.
   */
  private readonly mouse = { x: 0, y: 0 };
  private get locked(): boolean {
    return document.pointerLockElement === this.el.canvas;
  }
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
  /** Time between drawn frames: shows hitches the draw time can't (GPU work, GC, layout) */
  private lastFrameAt = 0;
  private gapSum = 0;
  private gapMax = 0;
  private gapMs = 0;
  private gapMaxMs = 0;
  /** Hit-detection work (sim.feed / advanceTo) per second, and the longest single call */
  private simSum = 0;
  private simMax = 0;
  private simMsPerSec = 0;
  private simMaxMs = 0;
  private simAt = 0;

  private addSimTime(ms: number): void {
    this.simSum += ms;
    this.simMax = Math.max(this.simMax, ms);
  }

  /** Canvas memory is summed once a second, not on every debug refresh */
  private canvasStats: ReturnType<typeof canvasUsage> | null = null;
  private canvasStatsAt = 0;
  private frames = 0;
  private fps = 0;
  /** Average and worst draw time over the last second (ms) */
  private drawMs = 0;
  private drawMaxMs = 0;
  private drawSum = 0;
  private drawMax = 0;
  private readonly limiter = new FrameLimiter();
  private fpsAt = 0;
  /**
   * The drawn cursor has a tiny cached canvas over the game: it moves as soon as mouse samples
   * arrive instead of with the next full frame. (Not a `desynchronized` context: on
   * many GPUs that draws straight to the screen without transparency, covering the game in white.)
   */
  private readonly cursorLayer: HTMLCanvasElement;
  private readonly cursorCtx: CanvasRenderingContext2D;
  /** Map units → device pixels of the game canvas, as of the last frame */
  private mapTransform: DOMMatrix | null = null;
  /** Something is drawn on the cursor layer */
  private cursorShown = false;
  private cursorSpriteKey = '';
  private cursorScaleX = 1;
  private cursorScaleY = 1;
  private cursorLeft = 0;
  private cursorTop = 0;
  private cursorPosition = '';
  /**
   * Fog, dark areas or global darkness can cover the cursor: on such maps it stays in the game
   * canvas under them (hiding it is part of the challenge), not on the layer above
   */
  private coveredCursor = false;
  /**
   * The letterbox and the static floor / walls, under the game canvas: painted only when they
   * change (map, size, quality), so a frame clears and draws just what moves (render.ts paintBackground)
   */
  private readonly bgLayer: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  /** Where the background canvas was last placed (CSS size and offset of the game canvas) */
  private bgPlace = '';

  constructor(private readonly el: PlayElements) {
    this.ctx = el.canvas.getContext('2d')!;
    // Static layer: one canvas under the game canvas, made once and reused for every map
    this.bgLayer = document.createElement('canvas');
    this.bgLayer.className = 'play-bg';
    this.bgLayer.setAttribute('aria-hidden', 'true');
    this.bgCtx = this.bgLayer.getContext('2d')!;
    el.canvas.before(this.bgLayer);
    this.cursorLayer = document.createElement('canvas');
    this.cursorLayer.className = 'play-cursor';
    this.cursorLayer.style.visibility = 'hidden';
    this.cursorLayer.style.width = `${CURSOR_SPRITE_PX}px`;
    this.cursorLayer.style.height = `${CURSOR_SPRITE_PX}px`;
    this.cursorLayer.setAttribute('aria-hidden', 'true');
    this.cursorCtx = this.cursorLayer.getContext('2d')!;
    el.canvas.parentElement?.append(this.cursorLayer);
    this.input = new HighResPointer((list) => this.onSamples(list));
    let measuredRate = options.pollingRate;
    onOptionsChange(next => {
      if (!next.cursorTrail) this.trail.length = 0;
      if (!next.decorativeEffects) this.burst = null;
      if (next.pollingRate === measuredRate) return;
      measuredRate = next.pollingRate;
      this.autoPolling.resetMeasurement();
      this.stats.reset();
      this.usedStats.reset();
    });

    el.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    // Cursor left the browser window
    window.addEventListener('pointerout', (e) => {
      // (not while the pointer is locked, or being locked: the mouse can't leave then)
      if (!e.relatedTarget && !this.locked && !this.lockPending) this.abort('left');
    });
    window.addEventListener('blur', () => this.abort('blur'));
    document.addEventListener('pointerlockerror', () => (this.lockPending = false));
    document.addEventListener('pointerlockchange', () => {
      this.lockPending = false;
      if (!this.locked && this.lockedRun) this.abort('pointer');
      this.lockedRun = this.locked;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.abort('blur');
    });
    // Touch/pen lose position the moment they lift, so lifting the finger that runs is a fail.
    // Other fingers don't matter: they never move the cursor (see runPointer)
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerId === this.runPointer) this.abort('pointer');
      else if (e.button === 0) this.onUp(e);
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
    this.drifts = map.objects.some((o) => !!o.ice || o.role === 'portal' || o.role === 'conveyor');
    this.coveredCursor = !!map.darkness || map.objects.some((o) => o.role === 'fog' || o.role === 'dark');
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
    this.unlock();
    this.visible = false;
    this.input.detach();
    // Offscreen layers are rebuilt on the next draw; don't hold them while other screens show
    releaseRenderCaches(this.ctx, this.sim?.objects);
  }

  private abort(reason: 'left' | 'blur' | 'pointer'): void {
    if (this.sim?.status === 'playing') this.sim.abort(reason);
  }

  /** The pointer lock of this run, while it holds */
  private lockedRun = false;
  /** A pointer lock was asked for and the browser hasn't answered yet */
  private lockPending = false;

  private unlock(): void {
    this.lockedRun = false;
    if (this.locked) document.exitPointerLock();
  }

  /** Letting go of the button (or the second finger) during a run lets go of a held pulley */
  private onUp(e: PointerEvent): void {
    const sim = this.sim;
    if (!sim || sim.status !== 'playing' || sim.grabbed < 0) return;
    const p = e.pointerId !== this.runPointer ? { x: sim.x - sim.offX, y: sim.y - sim.offY }
      : this.locked ? { ...this.mouse } : clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
    sim.release(e.timeStamp - this.t0, p.x, p.y);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.sim.status === 'playing') {
      // Clicks during a run press click-operated switches. Another finger (touch) taps where the
      // running finger is: it must never move the cursor, or a second finger could jump to GOAL
      const sim = this.sim;
      const p = e.pointerId !== this.runPointer ? { x: sim.x - sim.offX, y: sim.y - sim.offY }
        : this.locked ? { ...this.mouse } : clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
      sim.click(e.timeStamp - this.t0, p.x, p.y);
      return;
    }
    const p = clientToMap(this.el.canvas, this.map, e.clientX, e.clientY);
    if (!new ZoneArea(this.map.start, this.map.startShape).contains(p.x, p.y)) return;
    const sim = new Simulation(this.map, this.sim.objects);
    if (!sim.start(p.x, p.y)) return;
    e.preventDefault();
    this.sim = sim;
    this.runPointer = e.pointerId;
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    // Drifting cursor (ice, portals) with a drawn cursor skin: keep the mouse in the game for the
    // whole run. The system cursor (skin #0) is never locked: a lock would hide it, and players
    // choose it because the OS draws it without the drawn cursor's frame of delay
    if (this.drifts && skin.pointer !== 0 && e.pointerType === 'mouse' && this.el.canvas.requestPointerLock) {
      try {
        this.lockPending = true;
        void Promise.resolve(this.el.canvas.requestPointerLock()).catch(() => (this.lockPending = false));
      } catch {
        this.lockPending = false; // not available: the run goes on with the normal pointer
      }
    }
    this.lastSampleAt = e.timeStamp;
    this.autoPolling.resetMeasurement();
    this.stats.reset();
    this.usedStats.reset();
    this.burst = null;
    this.deathNotified = false;
    this.t0 = e.timeStamp;
    this.trail = options.cursorTrail ? [p.x, p.y] : [];
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

  private addTrailPoint(x: number, y: number, step: number): void {
    const t = this.trail;
    const n = t.length;
    // Keep the point before the head: the head moves until it is a step away from it
    if (n >= 4 && !Number.isNaN(t[n - 4]) && !Number.isNaN(t[n - 2])
      && Math.abs(x - t[n - 4]) < step && Math.abs(y - t[n - 3]) < step) {
      t[n - 2] = x;
      t[n - 1] = y;
      return;
    }
    t.push(x, y);
  }

  /** No trail line across a teleport */
  private breakTrailOnTeleport(): void {
    if (this.sim.teleports === this.trailTeleports) return;
    this.trailTeleports = this.sim.teleports;
    if (options.cursorTrail) this.trail.push(NaN, NaN, this.sim.x, this.sim.y);
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
    // Trail points closer than this (about 1.5 screen px) only move the trail's head: a 1000 Hz+
    // mouse otherwise piles up points the eye can't see, and the trail skins redraw every point
    // every frame
    const trailStep = options.cursorTrail ? TRAIL_STEP_PX * unitsPerPx(this.el.canvas, this.map) : 0;
    for (const ev of list) {
      // Only the pointer (finger) that started the run moves the cursor
      if (ev.pointerId !== this.runPointer) continue;
      // Small tolerance: hardware timestamps jitter around the nominal interval
      if (gap && ev.timeStamp - this.lastSampleAt < gap * 0.9) continue;
      this.lastSampleAt = ev.timeStamp;
      if (this.locked) {
        // Locked: the mouse moves by its relative motion (CSS px → map units)
        const upp = unitsPerPx(this.el.canvas, this.map);
        this.mouse.x += ev.movementX * upp;
        this.mouse.y += ev.movementY * upp;
        p.x = this.mouse.x;
        p.y = this.mouse.y;
      } else {
        toMap(ev.clientX, ev.clientY, p);
        this.mouse.x = p.x;
        this.mouse.y = p.y;
      }
      // feed ignores samples already overtaken by idle advancement or click handling.
      const accepted = ev.timeStamp - this.t0 > sim.time;
      const simStart = performance.now();
      sim.feed(ev.timeStamp - this.t0, p.x, p.y);
      this.addSimTime(performance.now() - simStart);
      if (accepted) this.usedStats.recordSample(ev.timeStamp);
      this.breakTrailOnTeleport();
      if (options.cursorTrail) this.addTrailPoint(sim.x, sim.y, trailStep);
      if (sim.status !== 'playing') break;
    }
    if (this.trail.length > TRAIL_POINTS * 2) this.trail.splice(0, this.trail.length - TRAIL_POINTS * 2);
    // The cursor moves now, not with the next frame
    this.drawCursorLayer();
    if (automatic) this.autoPolling.addInputWork(performance.now() - workStarted);
  }

  /**
   * Cache the skin in a small canvas. Only frames measure layout; mouse batches move the
   * cached image via transform without repainting or reading layout.
   */
  private drawCursorLayer(refresh = false): void {
    const layer = this.cursorLayer;
    const st = layer.style;
    const sim = this.sim;
    const show = this.visible && !!sim && sim.status === 'playing' && skin.pointer !== 0 && !this.coveredCursor && !!this.mapTransform;
    if (!show) {
      if (this.cursorShown) st.visibility = 'hidden';
      this.cursorShown = false;
      return;
    }
    if (refresh) {
      const canvas = this.el.canvas;
      this.cursorScaleX = canvas.clientWidth / canvas.width;
      this.cursorScaleY = canvas.clientHeight / canvas.height;
      this.cursorLeft = canvas.offsetLeft;
      this.cursorTop = canvas.offsetTop;
      const pixels = Math.ceil(CURSOR_SPRITE_PX * (window.devicePixelRatio || 1));
      const key = `${pixels}:${skin.pointer}:${skin.primary}:${skin.accent}`;
      if (key !== this.cursorSpriteKey) {
        layer.width = layer.height = pixels;
        const scale = pixels / CURSOR_SPRITE_PX;
        this.cursorCtx.setTransform(scale, 0, 0, scale, 0, 0);
        drawPointer(this.cursorCtx, skin, CURSOR_SPRITE_PX / 2, CURSOR_SPRITE_PX / 2, 1, CURSOR_PX);
        this.cursorSpriteKey = key;
      }
    }
    if (!this.cursorSpriteKey) return;
    const m = this.mapTransform!;
    const x = this.cursorLeft + (m.a * sim.x + m.c * sim.y + m.e) * this.cursorScaleX - CURSOR_SPRITE_PX / 2;
    const y = this.cursorTop + (m.b * sim.x + m.d * sim.y + m.f) * this.cursorScaleY - CURSOR_SPRITE_PX / 2;
    const position = `translate3d(${x}px, ${y}px, 0)`;
    if (position !== this.cursorPosition) {
      st.transform = position;
      this.cursorPosition = position;
    }
    if (!this.cursorShown) st.visibility = 'visible';
    this.cursorShown = true;
  }

  /** The run whose coin count `coinsLeft` was last seen in (for the coin sound) */
  private coinSim: Simulation | null = null;
  private coinsLeft = 0;
  /** Whether that run already held its crystal star (for the star sound) */
  private crystalHeld = false;

  private frame(): void {
    if (!this.visible || !this.map) {
      this.drawCursorLayer();
      return;
    }
    const now = performance.now();
    // Frame limit option: skip drawing this display refresh (pointer input still runs the game)
    if (!this.limiter.due(now)) return;
    // Gaps over 250 ms are pauses (hidden tab, screen change), not hitches
    const gap = now - this.lastFrameAt;
    if (gap < 250) {
      this.gapSum += gap;
      this.gapMax = Math.max(this.gapMax, gap);
    }
    this.lastFrameAt = now;
    const sim = this.sim;
    const measure = options.pollingRate === -1 && sim.status === 'playing';
    // Automatic quality: judged only while a run is played; the notice waits until it is over
    if (sim.status === 'playing') {
      const lowered = this.autoQuality.frame(now, gap);
      if (lowered) this.loweredTo = lowered;
    } else {
      this.autoQuality.reset(now);
      if (this.loweredTo) {
        this.onAutoQuality?.(this.loweredTo);
        this.loweredTo = null;
      }
    }

    if (sim.status === 'playing') {
      const target = now - this.t0 - IDLE_MARGIN_MS;
      if (target > sim.time) {
        const simStart = performance.now();
        sim.advanceTo(target);
        this.addSimTime(performance.now() - simStart);
      }
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
      this.burst = options.decorativeEffects ? new DeathBurst(sim.x, sim.y, skin.primary, now) : null;
      if (sim.endReason !== 'blur' && sim.endReason !== 'left') gameAudio.death();
      if (sim.endReason !== 'blur' && sim.endReason !== 'left' && sim.endReason !== 'pointer') this.onDeath?.(this.map);
    }
    if (running !== this.el.root.classList.contains('running')) this.el.root.classList.toggle('running', running);
    if (!running && this.lockedRun) this.unlock();
    // Pointer skin #0 keeps the system cursor (drawn by the OS, it has no frame of delay); where
    // the cursor can drift from the mouse a marker shows where it really is (see drawSlideMarker)
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

    const drawStart = performance.now();
    this.draw(now);
    const drawTime = performance.now() - drawStart;
    this.drawSum += drawTime;
    this.drawMax = Math.max(this.drawMax, drawTime);
    if (measure && sim.status === 'playing' && this.autoPolling.frame(now, performance.now() - now)) {
      this.usedStats.reset();
    }

    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsAt);
      this.drawMs = this.frames ? this.drawSum / this.frames : 0;
      this.drawMaxMs = this.drawMax;
      this.drawSum = this.drawMax = 0;
      this.gapMs = this.frames ? this.gapSum / this.frames : 0;
      this.gapMaxMs = this.gapMax;
      this.gapSum = this.gapMax = 0;
      this.simMsPerSec = (this.simSum * 1000) / (now - this.simAt || 1);
      this.simMaxMs = this.simMax;
      this.simSum = this.simMax = 0;
      this.simAt = now;
      this.frames = 0;
      this.fpsAt = now;
      if (options.showFps) this.el.fps.textContent = `${Math.round(this.fps)} FPS`;
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

  /** Sim time for turret shots and explosions: the run's time, then wall time so a last blast plays out */
  private shotClock(now: number): number {
    return this.sim.status === 'playing' ? this.sim.time : now - this.t0;
  }

  /** Keep the background canvas exactly under the game canvas (its backing size follows in paintBackground) */
  private placeBackground(): void {
    const c = this.el.canvas;
    const place = `${c.style.width}|${c.style.height}|${c.offsetLeft}|${c.offsetTop}`;
    if (place === this.bgPlace) return;
    this.bgPlace = place;
    const s = this.bgLayer.style;
    s.width = c.style.width;
    s.height = c.style.height;
    s.transform = `translate(${c.offsetLeft}px, ${c.offsetTop}px)`;
  }

  private draw(now: number): void {
    const { ctx, map, sim } = this;
    const t = sim.status === 'ready' ? 0 : sim.time;
    this.placeBackground();
    beginFrame(ctx, map, true);
    this.mapTransform = ctx.getTransform();
    const state = sim.status === 'ready' ? {} : { hidden: sim.hidden, clock: sim.clock, doorOpen: sim.doorOpen, channels: sim.channels, progress: sim.progress, pulleyAngle: sim.pulleyAngle, turretAim: sim.guns.aim, power: sim.power };
    const playing = sim.status === 'playing';
    const carried = playing ? this.carried : undefined;
    drawMap(ctx, map, sim.objects, t, { ...state, coinsLeft: sim.coinsLeft, beams: sim.beams, now, carried,
      secretCursor: playing ? { x: sim.x, y: sim.y } : null, background: this.bgCtx });
    if (options.cursorTrail) drawSkinTrail(ctx, skin, this.trail, unitsPerPx(this.el.canvas, map));
    // Bullets, missiles and explosions
    if (sim.status !== 'ready' && sim.guns.any) drawShots(ctx, sim.guns.shots, sim.guns.blasts, this.shotClock(now));
    if (options.decorativeEffects && sim.status !== 'ready') drawCoinPulls(ctx, sim, t, sim.x, sim.y, COIN_PULL_MS);
    // Secret walls cover the floor, obstacles and trail under them, except right around the cursor
    drawSecretWalls(ctx, map, sim.objects, t, playing ? { x: sim.x, y: sim.y } : null, 1, state);

    if (playing) {
      const u = unitsPerPx(this.el.canvas, map);
      // The system cursor is hidden during a run (CSS .running); the pointer skin is exactly where
      // the simulation has the cursor, so what you see is what is checked for collisions. It is
      // drawn on its own low-latency layer (drawCursorLayer), or here when fog or darkness may
      // cover it. Pointer skin #0 draws nothing: the system cursor stays visible (.native-cursor)
      if (skin.pointer !== 0 && this.coveredCursor) drawPointer(ctx, skin, sim.x, sim.y, u, CURSOR_PX);
      if (skin.pointer === 0 && this.drifts) drawSlideMarker(ctx, sim.x - sim.offX, sim.y - sim.offY, sim.x, sim.y, u);
      // A held crystal star circles the cursor once it has flown in
      if (sim.crystalHeld && (!options.decorativeEffects || this.crystalFlownIn(t))) {
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
    // Darkness stays after the run ends too (death, clear): the light stays where the cursor stopped
    if (map.darkness) {
      const light = map.darkness.light;
      const s = map.start;
      const started = sim.status !== 'ready';
      const circuit = { power: sim.power, wired: sim.circuit?.isTarget, channels: sim.channels };
      const lights = objectLights(sim.objects, t, started ? { ...state, ...circuit, carried: this.carried, cursor: { x: sim.x, y: sim.y } } : { ...state, ...circuit });
      if (light > 0) lights.push(started
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
      const why = sim.endReason ? tr(`play.why.${sim.endReason}` as 'play.why.wall') : '';
      drawBanner(ctx, map, tr('play.statusFailed'), [why, tr('play.failedSub')].filter(Boolean).join(' — '), '#e2486c');
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
    this.drawCursorLayer(true);
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
    // Compact: related numbers share a row, so the panel stays small over the map
    const ms = (v: number | null, digits = 2) => (v !== null ? `${v.toFixed(digits)} ms` : '-');
    const rows: [string, string][] = [
      [tr('debug.inputEvent'), `${this.input.source}${this.input.coalesced ? ' + coalesced' : tr('debug.noCoalesced')}`],
      [tr('debug.rawPollingRate'), s.hz !== null ? `${Math.round(s.hz)} Hz · ${ms(s.medianMs, 3)}` : tr('debug.keepMoving')],
      [tr('options.polling'), options.pollingRate === -1
        ? `${tr('options.pollingAuto')} (${this.autoPolling.rate} Hz)`
        : options.pollingRate ? `${options.pollingRate} Hz` : tr('options.pollingMax')],
      [tr('debug.usedPollingRate'), used.hz !== null ? `${Math.round(used.hz)} Hz · ${ms(used.medianMs, 3)} · ${used.total}` : tr('debug.usedPending')],
      [tr('debug.samplesPerEvent'), `${s.avgPerEvent.toFixed(1)} / ${s.maxPerEvent} · ${tr('debug.min')} ${ms(s.minMs, 3)}`],
      [tr('debug.ticks'), `${sim.simulationStepMs} ms · ${sim.ticks}`],
      [tr('debug.simTime'), `${this.simMsPerSec.toFixed(2)} ms/s · ${tr('debug.simMax')} ${ms(this.simMaxMs)}`],
      [tr('debug.fps'), this.fps.toFixed(0)],
      [tr('debug.drawTime'), `${this.drawMs.toFixed(2)} / ${ms(this.drawMaxMs)}`],
      [tr('debug.frameGap'), `${this.gapMs.toFixed(2)} / ${ms(this.gapMaxMs)}`],
    ];
    if (!this.canvasStats || now - this.canvasStatsAt >= 1000) {
      this.canvasStats = canvasUsage();
      this.canvasStatsAt = now;
    }
    const canvases = this.canvasStats;
    rows.push([tr('debug.canvasMemory'), `${formatBytes(canvases.bytes)} · ${tr('debug.canvasCount', { n: canvases.count })}`]);
    // The biggest users, by where they are or what made them
    for (const g of canvases.groups.slice(0, DEBUG_CANVAS_GROUPS)) {
      const label = g.label.replace(/ \([\w.-]+\.ts\)/, '').replace(/ · (offscreen|hidden)$/, '');
      rows.push([`↳ ${label}${g.count > 1 ? ` ×${g.count}` : ''}`, `${formatBytes(g.bytes)} · ${g.w}×${g.h}`]);
    }
    const heap = jsHeap();
    rows.push([tr('debug.jsHeap'), heap ? `${formatBytes(heap.used)} / ${formatBytes(heap.limit)}` : tr('debug.unavailable')]);
    rows.push([tr('debug.gpu'), shortGpuName(gpuName()) ?? tr('debug.unavailable')]);
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    rows.push([tr('debug.device'), `${navigator.hardwareConcurrency || '?'} ${tr('debug.cores')}${deviceMemory ? ` · ${deviceMemory} GB` : ''}`]);
    // Shown during runs too: update the rows in place instead of rebuilding them every 200 ms
    const list = this.el.debug;
    if (list.children.length !== rows.length * 2) {
      list.replaceChildren(...rows.flatMap(() => [document.createElement('dt'), document.createElement('dd')]));
    }
    rows.forEach(([k, v], i) => {
      const dt = list.children[i * 2];
      const dd = list.children[i * 2 + 1];
      if (dt.textContent !== k) dt.textContent = k;
      if (dd.textContent !== v) dd.textContent = v;
    });
  }
}

/** Canvas memory groups listed in the debug panel */
const DEBUG_CANVAS_GROUPS = 4;

/**
 * With the system cursor (pointer skin #0) on a map where the cursor drifts (ice, portals): a ring
 * where the cursor really is, tied to the mouse by a faint line, only while the two are apart.
 * The system cursor itself stays as it is (no added delay).
 */
function drawSlideMarker(ctx: CanvasRenderingContext2D, mx: number, my: number, x: number, y: number, u: number): void {
  const apart = Math.hypot(x - mx, y - my);
  if (apart < 2 * u) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, apart / (12 * u));
  ctx.setLineDash([4 * u, 4 * u]);
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = 'rgba(20, 30, 50, 0.45)';
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 6 * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = '#e2486c';
  ctx.stroke();
  ctx.fillStyle = '#e2486c';
  ctx.beginPath();
  ctx.arc(x, y, 1.6 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
