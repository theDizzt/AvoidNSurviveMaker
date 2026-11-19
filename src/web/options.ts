/** Pointer samples per second used in play; 0 = every sample the mouse sends */
export const POLLING_RATES = [0, 1000, 500, 250, 125] as const;
export type PollingRate = (typeof POLLING_RATES)[number];

/** Rendering quality: canvas resolution and menu background frame rate (see graphics.ts) */
export const GRAPHICS_LEVELS = ['high', 'medium', 'low'] as const;
export type GraphicsLevel = (typeof GRAPHICS_LEVELS)[number];

/** Player options, persisted per browser. */
export interface Options {
  showDebug: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  pollingRate: PollingRate;
  graphics: GraphicsLevel;
}

type VolumeKey = 'masterVolume' | 'musicVolume' | 'effectsVolume';
const VOLUME_KEYS: readonly VolumeKey[] = ['masterVolume', 'musicVolume', 'effectsVolume'];

export const DEFAULT_OPTIONS: Readonly<Options> = {
  showDebug: false,
  masterVolume: 80,
  musicVolume: 60,
  effectsVolume: 80,
  pollingRate: 0,
  graphics: 'high',
};

const STORAGE_KEY = 'avoid-n-survive:options';
const listeners = new Set<(o: Readonly<Options>) => void>();

function load(): Options {
  const out = { ...DEFAULT_OPTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const k of ['showDebug'] as const) {
      if (typeof saved[k] === 'boolean') out[k] = saved[k];
    }
    for (const k of VOLUME_KEYS) {
      const value = saved[k];
      if (typeof value === 'number' && Number.isFinite(value)) out[k] = Math.max(0, Math.min(100, value));
    }
    if ((POLLING_RATES as readonly unknown[]).includes(saved.pollingRate)) out.pollingRate = saved.pollingRate as PollingRate;
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
  if (key === 'graphics' && !(GRAPHICS_LEVELS as readonly unknown[]).includes(value)) return;
  (options as Options)[key] = value;
  commit();
}

export function resetOptions(): void {
  Object.assign(options as Options, DEFAULT_OPTIONS);
  commit();
}

export function onOptionsChange(fn: (o: Readonly<Options>) => void): void {
  listeners.add(fn);
}
