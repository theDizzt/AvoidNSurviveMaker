import { compileMap, type CompiledObject } from '../core/object';
import { COIN_PULL_MS, Simulation, type ReplaySample } from '../core/simulation';
import { levelSlots, themedLevel, type ThemeEntry } from './localized/theme-pack';
import type { MapData } from '../core/types';
import { DeathBurst } from './death-burst';
import { demoPlayable, planDemoRun } from './demo-pilot';
import { COLORS, drawCoinPulls, drawMap, drawTrail } from './render';
import { OFFICIAL_THEMES } from './theme-registry';

/**
 * Page background behind the menus:
 * - 'demo'  a random chapter level played by the autopilot (main menu and most screens)
 * - 'grid'  a soft grid (world select, map editor, theme editor)
 * - 'theme' the selected theme's colors (level select)
 * - 'none'  nothing extra (gameplay draws its own frame)
 */
export type BackdropMode = 'demo' | 'grid' | 'theme' | 'none';

const FPS = 30;
/** Decorative background: bound fill-rate and offscreen shadow memory on HiDPI/4K displays. */
const MAX_BACKGROUND_PIXELS = 1280 * 720;
const CURSOR_PX = 9;
/** Pause on START before the run, and after it ends (ms) */
const LEAD_MS = 700;
const HOLD_MS = 1600;
/** Planning time per frame (ms) */
const PLAN_BUDGET_MS = 6;
const TRAIL_POINTS = 90;

interface Run {
  map: MapData;
  objects: readonly CompiledObject[];
  planner: Generator<void, ReplaySample[] | null> | null;
  samples: ReplaySample[] | null;
  sim: Simulation | null;
  /** performance.now() when the run started (after the lead-in) */
  t0: number;
  fed: number;
  trail: number[];
  burst: DeathBurst | null;
  endedAt: number;
  /** Plain showcase when no route was found: the map just animates for a while */
  showcaseUntil: number;
}

export class Backdrop {
  private readonly ctx: CanvasRenderingContext2D;
  private mode: BackdropMode = 'none';
  private run: Run | null = null;
  private raf = 0;
  private last = 0;
  private pausedAt: number | null = null;
  private lastMap: MapData | null = null;
  private readonly pool: MapData[];
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly root: HTMLElement, private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.pool = OFFICIAL_THEMES.flatMap((t) => Array.from({ length: levelSlots(t) }, (_, i) => themedLevel(t, i))
      .filter((m): m is MapData => !!m && demoPlayable(m)));
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.schedule());
    this.resize();
  }

  /** Switch the background; `theme` gives the colors for 'theme' mode */
  set(mode: BackdropMode, theme?: ThemeEntry | null): void {
    this.root.dataset.mode = mode;
    if (mode === 'theme') {
      const bg = theme?.info.screens?.select?.background;
      const [a, b] = bg ? [bg.color, bg.color2 ?? bg.color] : theme?.info.colors ?? ['#9fe2ff', '#c3b5ff'];
      this.root.style.setProperty('--bg-a', a);
      this.root.style.setProperty('--bg-b', b);
      // A designed background is drawn as designed (style.css .bg-designed): image, fit and dim
      this.root.classList.toggle('bg-designed', !!bg);
      const img = bg?.image && theme?.assets[bg.image];
      if (img) this.root.style.setProperty('--bg-img', `url("${img}")`);
      else this.root.style.removeProperty('--bg-img');
      this.root.style.setProperty('--bg-size', bg?.fit === 'contain' ? 'contain' : bg?.fit === 'tile' ? 'auto' : 'cover');
      this.root.style.setProperty('--bg-repeat', bg?.fit === 'tile' ? 'repeat' : 'no-repeat');
      this.root.style.setProperty('--bg-dim', String(bg?.dim ?? 0));
    }
    if (mode === this.mode) return;
    this.mode = mode;
    this.schedule();
  }

  private schedule(): void {
    const active = this.mode === 'demo' && !document.hidden && this.pool.length > 0;
    if (!active && this.run && this.pausedAt === null) this.pausedAt = performance.now();
    if (active && this.pausedAt !== null) {
      const gap = performance.now() - this.pausedAt;
      if (this.run) {
        // Resume where the background stopped instead of simulating the entire hidden gap.
        this.run.t0 += gap;
        if (this.run.endedAt) this.run.endedAt += gap;
        if (this.run.showcaseUntil) this.run.showcaseUntil += gap;
      }
      this.pausedAt = null;
    }
    if (active && !this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    if (!active && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1,
      Math.sqrt(MAX_BACKGROUND_PIXELS / Math.max(1, window.innerWidth * window.innerHeight)));
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    if (this.run) this.draw(performance.now());
  }

  private nextRun(now: number): Run {
    const choices = this.pool.length > 1 ? this.pool.filter((m) => m !== this.lastMap) : this.pool;
    const map = choices[Math.floor(Math.random() * choices.length)];
    this.lastMap = map;
    const objects = compileMap(map);
    return {
      map,
      objects,
      // Reduced motion: a still level, no autopilot
      planner: this.reduced ? null : planDemoRun(map, objects),
      samples: null,
      sim: null,
      t0: now,
      fed: 0,
      trail: [],
      burst: null,
      endedAt: 0,
      showcaseUntil: this.reduced ? Infinity : 0,
    };
  }

  private frame(now: number): void {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    if (now - this.last < 1000 / FPS - 2) return;
    this.last = now;
    this.run ??= this.nextRun(now);
    const run = this.run;

    // Plan a slice at a time
    if (run.planner) {
      const until = performance.now() + PLAN_BUDGET_MS;
      let step = run.planner.next();
      while (!step.done && performance.now() < until) step = run.planner.next();
      if (step.done) {
        run.planner = null;
        run.samples = step.value;
        if (run.samples) {
          run.sim = new Simulation(run.map, run.objects);
          run.sim.start(run.samples[0].x, run.samples[0].y);
          run.t0 = now + LEAD_MS;
          run.trail = [run.samples[0].x, run.samples[0].y];
        } else run.showcaseUntil = now + 6000; // no route: just show the level moving
      }
    }

    const sim = run.sim;
    if (sim && sim.status === 'playing' && now >= run.t0) {
      const t = now - run.t0;
      const samples = run.samples!;
      while (run.fed < samples.length && samples[run.fed].t <= t) {
        const s = samples[run.fed++];
        if (s.t > 0) sim.feed(s.t, s.x, s.y);
        run.trail.push(sim.x, sim.y);
        if (sim.status !== 'playing') break;
      }
      if (sim.status === 'playing') sim.advanceTo(Math.min(t, samples[samples.length - 1].t));
      if (sim.status === 'playing' && run.fed >= samples.length) sim.abort('left');
      if (run.trail.length > TRAIL_POINTS * 2) run.trail.splice(0, run.trail.length - TRAIL_POINTS * 2);
      if (sim.status !== 'playing') {
        run.endedAt = now;
        if (sim.status === 'dead') run.burst = new DeathBurst(sim.x, sim.y, COLORS.cursor, now);
      }
    }

    this.draw(now);

    if (this.reduced) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }

    const over = (run.endedAt && now - run.endedAt > HOLD_MS) || (run.showcaseUntil && now > run.showcaseUntil);
    if (over) this.run = null;
  }

  private draw(now: number): void {
    const run = this.run;
    if (!run) return;
    const { ctx, canvas } = this;
    const { map, sim } = run;
    // Cover the window (cropping the map's edges rather than letterboxing)
    const s = Math.max(canvas.width / map.width, canvas.height / map.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.letterbox;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, (canvas.width - map.width * s) / 2, (canvas.height - map.height * s) / 2);

    const playing = sim && sim.status !== 'ready' && now >= run.t0;
    const t = sim ? (playing ? sim.time : 0) : run.showcaseUntil === Infinity ? 0 : now % 60_000;
    const state = sim && playing ? { hidden: sim.hidden, clock: sim.clock, doorOpen: sim.doorOpen, channels: sim.channels, progress: sim.progress } : {};
    drawMap(ctx, map, run.objects, t, { ...state, coinsLeft: sim?.coinsLeft, beams: sim?.beams, now });
    if (!sim) return;
    const unit = (canvas.width / Math.max(1, window.innerWidth)) / s;
    drawTrail(ctx, run.trail);
    if (playing) drawCoinPulls(ctx, sim, t, sim.x, sim.y, COIN_PULL_MS);
    if (sim.status === 'playing' || sim.status === 'cleared') {
      const r = (CURSOR_PX / 2) * unit;
      ctx.fillStyle = COLORS.cursor;
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = unit;
      ctx.stroke();
    }
    if (run.burst && !run.burst.draw(ctx, now, unit)) run.burst = null;
  }
}
