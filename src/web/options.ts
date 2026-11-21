/** Pointer samples per second used in play; -1 = adaptive, 0 = every sample. */
export const POLLING_RATES = [-1, 0, 1000, 500, 250, 125] as const;
export type PollingRate = (typeof POLLING_RATES)[number];

/** Frames drawn per second at most; 0 = every display refresh. */
export const FRAME_LIMITS = [0, 240, 144, 120, 60, 30] as const;
export type FrameLimit = (typeof FRAME_LIMITS)[number];

/** Rendering quality: canvas resolution and menu background frame rate (see graphics.ts) */
export const GRAPHICS_LEVELS = ['ultra', 'high', 'medium', 'low'] as const;
export type GraphicsLevel = (typeof GRAPHICS_LEVELS)[number];

/** Player options, persisted per browser. */
export interface Options {
  showDebug: boolean;
  /** Frame rate counter in the corner of the play screen */
  showFps: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  pollingRate: PollingRate;
  graphics: GraphicsLevel;
  frameLimit: FrameLimit;
  /** Lower Graphics quality by itself when play runs slowly (see auto-quality.ts) */
  autoQuality: boolean;
  /** Smooth (interpolated) scaling of images and canvases; off = nearest pixel (see graphics.ts) */
  antialias: boolean;
  /** Drop shadows in the game and the menus */
  shadows: boolean;
  /** See-through menu panels and tiles; off = opaque (see .no-transparency in style.css) */
  transparency: boolean;
  cursorTrail: boolean;
  decorativeEffects: boolean;
  animatedBackground: boolean;
  interfaceEffects: boolean;
}

type VolumeKey = 'masterVolume' | 'musicVolume' | 'effectsVolume';
const VOLUME_KEYS: readonly VolumeKey[] = ['masterVolume', 'musicVolume', 'effectsVolume'];

export const DEFAULT_OPTIONS: Readonly<Options> = {
  showDebug: false,
  showFps: false,
  masterVolume: 25,
  musicVolume: 60,
  effectsVolume: 80,
  pollingRate: 0,
  graphics: 'high',
  frameLimit: 0,
  autoQuality: true,
  antialias: true,
  shadows: true,
  transparency: true,
  cursorTrail: true,
  decorativeEffects: true,
  animatedBackground: true,
  interfaceEffects: true,
};

const STORAGE_KEY = 'avoid-n-survive:options';
const listeners = new Set<(o: Readonly<Options>) => void>();

function load(): Options {
  const out = { ...DEFAULT_OPTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const k of ['showDebug', 'showFps', 'cursorTrail', 'decorativeEffects', 'animatedBackground', 'interfaceEffects', 'autoQuality', 'antialias', 'shadows', 'transparency'] as const) {
      if (typeof saved[k] === 'boolean') out[k] = saved[k];
    }
    for (const k of VOLUME_KEYS) {
      const value = saved[k];
      if (typeof value === 'number' && Number.isFinite(value)) out[k] = Math.max(0, Math.min(100, value));
    }
    if ((POLLING_RATES as readonly unknown[]).includes(saved.pollingRate)) out.pollingRate = saved.pollingRate as PollingRate;
    if ((FRAME_LIMITS as readonly unknown[]).includes(saved.frameLimit)) out.frameLimit = saved.frameLimit as FrameLimit;
    if ((GRAPHICS_LEVELS as readonly unknown[]).includes(saved.graphics)) out.graphics = saved.graphics as GraphicsLevel;
  } catch {
    /* storage unavailable or corrupted → defaults */
  }
  return out;
}

/** Live options object; read it directly, change it through setOption / resetOptions. */
export const options: Readonly<Options> = load();

function commit(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* ignore when storage is unavailable */
  }
  for (const fn of listeners) fn(options);
}

export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  if ((VOLUME_KEYS as readonly string[]).includes(key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    value = Math.max(0, Math.min(100, value)) as Options[K];
  }
  if (key === 'pollingRate' && !(POLLING_RATES as readonly unknown[]).includes(value)) return;
  if (key === 'frameLimit' && !(FRAME_LIMITS as readonly unknown[]).includes(value)) return;
  if (key === 'graphics' && !(GRAPHICS_LEVELS as readonly unknown[]).includes(value)) return;
  (options as Options)[key] = value;
  commit();
}

export function resetOptions(): void {
  Object.assign(options as Options, DEFAULT_OPTIONS);
  commit();
}

/** Options shown on the Graphics screen */
const GRAPHICS_KEYS = ['graphics', 'frameLimit', 'showFps', 'autoQuality', 'antialias', 'shadows', 'transparency', 'cursorTrail', 'decorativeEffects', 'animatedBackground', 'interfaceEffects'] as const;

/** Restore only the Graphics screen's options (one commit, so canvases refit once). */
export function resetGraphicsOptions(): void {
  for (const k of GRAPHICS_KEYS) (options as Record<string, unknown>)[k] = DEFAULT_OPTIONS[k];
  commit();
}

/** Set several options in one commit (listeners resize/repaint once); invalid values are skipped. */
export function applyOptions(patch: Partial<Options>): void {
  const next = { ...options, ...patch } as Options;
  if (!(GRAPHICS_LEVELS as readonly unknown[]).includes(next.graphics)) next.graphics = options.graphics;
  if (!(FRAME_LIMITS as readonly unknown[]).includes(next.frameLimit)) next.frameLimit = options.frameLimit;
  if (!(POLLING_RATES as readonly unknown[]).includes(next.pollingRate)) next.pollingRate = options.pollingRate;
  Object.assign(options as Options, next);
  commit();
}

/** Apply together so listeners resize/repaint only once. */
export function applyLowSpecOptions(): void {
  Object.assign(options as Options, {
    graphics: 'low', frameLimit: 60, pollingRate: -1, showDebug: false,
    cursorTrail: false, decorativeEffects: false, animatedBackground: false, interfaceEffects: false, transparency: false,
  } satisfies Partial<Options>);
  commit();
}

export function onOptionsChange(fn: (o: Readonly<Options>) => void): void {
  listeners.add(fn);
}
