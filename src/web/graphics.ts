import { options, type GraphicsLevel } from './options';

/**
 * Graphics quality. Only how the game is drawn changes: the simulation, collision checks and
 * records are identical at every level.
 * - high: full device resolution (sharpest on HiDPI / 4K screens)
 * - medium: at most 1.5 device px per CSS px and about 2560×1440 pixels per canvas
 * - low: at most 1 device px per CSS px and about 960×540 pixels; menu background at 15 fps;
 *   (canvas shadows are never blurred, see below)
 */
const LEVELS: Record<GraphicsLevel, { maxDpr: number; maxPixels: number; backdropFps: number }> = {
  high: { maxDpr: Infinity, maxPixels: Infinity, backdropFps: 30 },
  medium: { maxDpr: 1.5, maxPixels: 2560 * 1440, backdropFps: 30 },
  low: { maxDpr: 1, maxPixels: 960 * 540, backdropFps: 15 },
};

/** Backing pixels per CSS pixel for a canvas of this CSS size */
export function renderScale(cssW: number, cssH: number): number {
  const q = LEVELS[options.graphics];
  const dpr = window.devicePixelRatio || 1;
  const byPixels = Math.sqrt(q.maxPixels / Math.max(1, cssW * cssH));
  // Never below half a pixel per CSS px, so text and edges stay legible
  return Math.max(0.5, Math.min(dpr, q.maxDpr, byPixels));
}

/**
 * Frame limit option. Call once per animation frame with its timestamp: true when this frame
 * should be drawn. Only drawing is skipped: the simulation runs on input timestamps, so
 * collisions and records are identical at every limit. A cap above the display's refresh rate
 * has no effect (requestAnimationFrame never runs faster than the display).
 */
export class FrameLimiter {
  private next = 0;

  due(now: number): boolean {
    const fps = options.frameLimit;
    if (!fps) return true;
    const gap = 1000 / fps;
    // Small tolerance: rAF timestamps jitter around the display interval
    if (now < this.next - 1) return false;
    // Step from the scheduled time to hold the average rate; resync after a long pause
    this.next = now - this.next > gap ? now + gap : this.next + gap;
    return true;
  }
}

/** Frame rate of the animated menu background */
export function backdropFps(): number {
  return LEVELS[options.graphics].backdropFps;
}

/**
 * No canvas shadow is ever blurred, at any quality. A blurred shadow is by far the most expensive
 * 2D canvas operation without GPU acceleration (integrated graphics, software rendering), and
 * many things are redrawn every frame. Hooking the setter once covers every drawing site, even
 * ones added later; offsets and colors stay, so shadows keep their shape, only sharp.
 */
function installShadowPolicy(proto: object | undefined): void {
  const d = proto && Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
  if (!d?.set || !d.get) return;
  const { get, set } = d;
  Object.defineProperty(proto, 'shadowBlur', {
    configurable: true,
    enumerable: d.enumerable,
    get,
    set(this: CanvasRenderingContext2D, v: number) {
      void v;
      set.call(this, 0);
    },
  });
}
/**
 * Shadows option off: no canvas shadow at all (the color setter is held at transparent). The
 * shadows drawn by hand as offset shapes check `options.shadows` where they are drawn.
 */
function installShadowColorPolicy(proto: object | undefined): void {
  const d = proto && Object.getOwnPropertyDescriptor(proto, 'shadowColor');
  if (!d?.set || !d.get) return;
  const { get, set } = d;
  Object.defineProperty(proto, 'shadowColor', {
    configurable: true,
    enumerable: d.enumerable,
    get,
    set(this: CanvasRenderingContext2D, v: string) {
      set.call(this, options.shadows ? v : 'transparent');
    },
  });
}

/**
 * Antialiasing option off: every image drawn scaled (cached layers, shadows, darkness, sprites)
 * takes the nearest pixel instead of blending neighbors. Checked on each drawImage, since resizing
 * a canvas resets its context to smoothing on. Edges of shapes and text are always antialiased by
 * the browser; canvas 2D has no switch for that.
 */
const unsmoothed = new WeakSet<object>();
function installSmoothingPolicy(proto: object | undefined): void {
  const draw = proto && Object.getOwnPropertyDescriptor(proto, 'drawImage');
  const flag = proto && Object.getOwnPropertyDescriptor(proto, 'imageSmoothingEnabled');
  if (!draw || typeof draw.value !== 'function' || !flag?.set) return;
  const drawImage = draw.value as (...args: unknown[]) => void;
  const setSmoothing = flag.set;
  Object.defineProperty(proto, 'drawImage', {
    ...draw,
    value(this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (!options.antialias) {
        setSmoothing.call(this, false);
        unsmoothed.add(this);
      } else if (unsmoothed.has(this)) {
        setSmoothing.call(this, true);
        unsmoothed.delete(this);
      }
      drawImage.apply(this, args);
    },
  });
}

if (typeof window !== 'undefined') {
  for (const proto of [window.CanvasRenderingContext2D?.prototype, window.OffscreenCanvasRenderingContext2D?.prototype]) {
    installShadowPolicy(proto);
    installShadowColorPolicy(proto);
    installSmoothingPolicy(proto);
  }
}
