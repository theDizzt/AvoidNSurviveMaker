import { validateMap } from '../core/validate';
import { recordIdentity } from '../core/record-identity';
import { runReplay, type Replay, type ReplaySample } from '../core/simulation';
import { starsFor } from '../core/level';
import { recordTime } from '../core/time';
import type { MapData } from '../core/types';

// Bundled at deployment: client requests cannot supply maps or star thresholds.
const infos = import.meta.glob<{ id: string }>('../../themes/*/theme.json', { eager: true, import: 'default' });
const files = import.meta.glob<unknown>('../../themes/*/levels/*.json', { eager: true, import: 'default' });
const catalog = new Map<string, MapData>();
const ids = new Set<string>();
for (const [path, raw] of Object.entries(files)) {
  const prefix = path.slice(0, path.indexOf('/levels/'));
  const themeId = infos[`${prefix}/theme.json`]?.id;
  const map = validateMap(raw);
  if (!themeId || !map.id) throw new Error(`Missing stable identity: ${path}`);
  const id = `${themeId}/${map.id}`;
  if (ids.has(id)) throw new Error(`Duplicate stable identity: ${id}`);
  ids.add(id);
  catalog.set(recordIdentity(themeId, map, true), map);
}

export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const MAX_TIME = 120_000;

export function verifyReplay(key: unknown, input: unknown): { best_ms: number; stars: number; crystal: boolean } {
  const map = typeof key === 'string' ? catalog.get(key) : undefined;
  if (!map) throw new Error('UNKNOWN_LEVEL_VERSION');
  return verifyMapReplay(map, input);
}

/** Internal verifier entry for trusted maps and isolated regression tests. Never accept a request map. */
export function verifyMapReplay(map: MapData, input: unknown): { best_ms: number; stars: number; crystal: boolean } {
  if (!input || typeof input !== 'object') throw new Error('INVALID_REPLAY');
  const replay = input as Replay;
  if (replay.v !== 1 || replay.abort !== undefined) throw new Error('INVALID_REPLAY');
  const check = (value: unknown, max: number, strict: boolean): ReplaySample[] => {
    if (!Array.isArray(value) || value.length > max) throw new Error('INVALID_REPLAY');
    let prev = -1;
    for (const p of value) {
      if (!p || ![p.t, p.x, p.y].every(Number.isFinite) || p.t < 0 || p.t > MAX_TIME
        || (strict ? p.t <= prev : p.t < prev) || (strict && prev >= 0 && p.t - prev > 250)
        || Math.abs(p.x) > map.width * 2 || Math.abs(p.y) > map.height * 2) throw new Error('INVALID_REPLAY');
      prev = p.t;
    }
    return value;
  };
  const samples = check(replay.samples, 150_000, true);
  const clicks = check(replay.clicks ?? [], 10_000, false);
  if (samples.length < 2 || samples[0].t !== 0 || clicks.some(p => p.t > samples[samples.length - 1].t)) throw new Error('INVALID_REPLAY');
  const deadline = performance.now() + 1500;
  const sim = runReplay(map, { v: 1, samples, clicks }, () => {
    if (performance.now() > deadline) throw new Error('REPLAY_BUDGET_EXCEEDED');
  });
  if (performance.now() > deadline) throw new Error('REPLAY_BUDGET_EXCEEDED');
  if (sim.status !== 'cleared' || sim.endTime <= 0) throw new Error('NOT_CLEARED');
  const ms = recordTime(sim.endTime);
  return { best_ms: ms, stars: starsFor(map, ms) ?? 3, crystal: sim.crystalHeld };
}
