/** Player options, persisted per browser. */
export interface Options {
  showTrail: boolean;
  showTimer: boolean;
  showDebug: boolean;
}

export const DEFAULT_OPTIONS: Readonly<Options> = {
  showTrail: true,
  showTimer: true,
  showDebug: false,
};

const STORAGE_KEY = 'avoid-n-survive:options';
const listeners = new Set<(o: Readonly<Options>) => void>();

function load(): Options {
  const out = { ...DEFAULT_OPTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const k of Object.keys(out) as (keyof Options)[]) {
      if (typeof saved[k] === 'boolean') out[k] = saved[k];
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
