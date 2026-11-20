import { options, type GraphicsLevel } from './options';

/**
 * Graphics quality. Only how the game is drawn changes: the simulation, collision checks and
 * records are identical at every level.
 * - high: full device resolution (sharpest on HiDPI / 4K screens)
 * - medium: at most 1.5 device px per CSS px and about 2560×1440 pixels per canvas
 * - low: at most 1 device px per CSS px and about 960×540 pixels; menu background at 15 fps;
 *   canvas shadows drawn without blur (see below)
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

/** Frame rate of the animated menu background */
export function backdropFps(): number {
  return LEVELS[options.graphics].backdropFps;
}

/**
 * Low quality: every canvas shadow is drawn without blur. A blurred shadow is by far the most
 * expensive 2D canvas operation without GPU acceleration (software rendering, virtual machines),
 * and coins, saws, bullets, glows and the wall mass set one every frame. Hooking the setter once
 * covers every drawing site; offsets and colors stay, so shadows keep their shape, only sharp.
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
      set.call(this, options.graphics === 'low' ? 0 : v);
    },
  });
}
if (typeof window !== 'undefined') {
  installShadowPolicy(window.CanvasRenderingContext2D?.prototype);
  installShadowPolicy(window.OffscreenCanvasRenderingContext2D?.prototype);
}
