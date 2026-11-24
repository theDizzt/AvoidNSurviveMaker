import { applyOptions, graphicsPreset, GRAPHICS_LEVELS, options, type GraphicsLevel } from './options';

/** Frames are judged over windows this long (ms) */
const WINDOW_MS = 3000;
/** After a change, wait this long (ms): canvases are rebuilt and the first frames are slow */
const SETTLE_MS = 4000;
/** Gaps longer than this (ms) are pauses (tab switch, screen change), not slow frames */
const PAUSE_MS = 250;

/**
 * Automatic graphics quality: while a run is being played, if the frame rate stays well under
 * what it should be for a few seconds, step the Graphics quality down (ultra → high → medium → low).
 * Only lowers, never raises, so it can't flip back and forth; the player can raise it again.
 */
export class AutoQuality {
  private start = 0;
  private frames = 0;
  private total = 0;
  private settleUntil = 0;

  /** Forget the current window (new run, screen shown again) */
  reset(now: number): void {
    this.start = now;
    this.frames = 0;
    this.total = 0;
  }

  /** One drawn frame `gap` ms after the previous one. Returns the new level when it lowered it. */
  frame(now: number, gap: number): GraphicsLevel | null {
    if (!options.autoQuality || options.graphics === 'low' || now < this.settleUntil) {
      this.reset(now);
      return null;
    }
    if (!Number.isFinite(gap) || gap <= 0 || gap >= PAUSE_MS) {
      this.reset(now);
      return null;
    }
    this.frames++;
    this.total += gap;
    if (now - this.start < WINDOW_MS) return null;
    const fps = (this.frames * 1000) / this.total;
    // Expected: the frame limit if one is set, else at least 60 (every display refreshes that fast)
    const expected = Math.min(options.frameLimit || 60, 60);
    this.reset(now);
    if (fps >= expected * 0.75) return null;
    const next = GRAPHICS_LEVELS[GRAPHICS_LEVELS.indexOf(options.graphics) + 1];
    if (!next) return null;
    const preset = graphicsPreset(next);
    // Automatic downshifts must not re-enable effects the player disabled or raise existing caps.
    applyOptions({
      graphics: next,
      renderScale: Math.min(options.renderScale, preset.renderScale) as typeof options.renderScale,
      frameLimit: Math.min(options.frameLimit || Infinity, preset.frameLimit) as typeof options.frameLimit,
      backgroundFps: Math.min(options.backgroundFps || Infinity, preset.backgroundFps) as typeof options.backgroundFps,
      antialias: options.antialias && preset.antialias,
      shadows: options.shadows && preset.shadows,
      transparency: options.transparency && preset.transparency,
      cursorTrail: options.cursorTrail && preset.cursorTrail,
      decorativeEffects: options.decorativeEffects && preset.decorativeEffects,
      animatedBackground: options.animatedBackground && preset.animatedBackground,
      interfaceEffects: options.interfaceEffects && preset.interfaceEffects,
    });
    this.settleUntil = now + SETTLE_MS;
    return next;
  }
}
