/** Player options, persisted per browser. */
export interface Options {
  showTimer: boolean;
  showDebug: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
}

export const DEFAULT_OPTIONS: Readonly<Options> = {
  showTimer: true,
  showDebug: false,
  masterVolume: 80,
  musicVolume: 60,
  effectsVolume: 80,
};

const STORAGE_KEY = 'avoid-n-survive:options';
const listeners = new Set<(o: Readonly<Options>) => void>();

function load(): Options {
  const out = { ...DEFAULT_OPTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const k of ['showTimer', 'showDebug'] as const) {
      if (typeof saved[k] === 'boolean') out[k] = saved[k];
    }
    for (const k of ['masterVolume', 'musicVolume', 'effectsVolume'] as const) {
      const value = saved[k];
      if (typeof value === 'number' && Number.isFinite(value)) out[k] = Math.max(0, Math.min(100, value));
    }
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
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return;
    value = Math.max(0, Math.min(100, value)) as Options[K];
  }
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
