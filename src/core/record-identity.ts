import { gameplayKey } from './level';
import type { MapData } from './types';

/** Increment whenever simulation rules change, even if the map files do not. */
export const REPLAY_RULES = 1;

// Synchronous SHA-256 keeps record lookups synchronous in rendering and offline play.
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(data.length - 4, bytes.length * 8);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Int32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + (r(x, 7) ^ r(x, 18) ^ (x >>> 3)) + w[i - 7] + (r(y, 17) ^ r(y, 19) ^ (y >>> 10));
    }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) {
      const t = (j + (r(e,6)^r(e,11)^r(e,25)) + ((e&f)^(~e&g)) + k[i] + w[i]) | 0;
      const u = ((r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c))) | 0;
      j=g; g=f; f=e; e=(d+t)|0; d=c; c=b; b=a; a=(t+u)|0;
    }
    [a,b,c,d,e,f,g,j].forEach((v, i) => h[i] = (h[i] + v) | 0);
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Sorting keys makes hashes independent of JSON property insertion order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => [k, canonical(v)]));
  return value;
}

export function contentHash(map: MapData): string {
  return sha256(JSON.stringify(canonical({ rules: REPLAY_RULES, gameplay: JSON.parse(gameplayKey(map)), stars: map.stars ?? null })));
}

/**
 * Record key of a level: "<theme>/<level id>" ("custom:" in front for custom packs). The same
 * level keeps its key, and its records, when its map is updated. Older saves added
 * "@<content hash>"; progress.ts and the server drop that suffix.
 */
export function recordIdentity(themeId: string, map: MapData, official: boolean): string {
  // Older custom maps have no stable ID; their content identity avoids index collisions.
  return `${official ? '' : 'custom:'}${themeId}/${map.id ?? contentHash(map).slice(0, 32)}`;
}

/**
 * Record keys several official levels shared by mistake (level files copied with the same id),
 * moved to the level they mostly belong to. Chapter 3 had only level 1 under "wood/5" until
 * levels 2–7 were added with the same id; chapter 2 levels 11–13 shared one id from the start, so
 * their records go to level 11. Those levels now have ids "level − 1" like the other chapters
 * ("wood/0"…"wood/6", "desert/10"…"desert/12"). The server moves them too: migrations
 * 20261121050000_split_shared_level_keys.sql and 20261121060000_misfiled_wood_records.sql.
 *
 * `below`: "wood/5" is level 6's own key now, so only records faster than any level 6 clear
 * (3-star time 7.5 s) move; those are chapter 3 level 1 times (3-star time 1 s). Applied to every
 * record that comes in (saves, the upload queue, the server), so an old record downloaded from the
 * server or sent by an older client never settles on level 6 again.
 */
export const SHARED_LEVEL_KEYS: ReadonlyMap<string, { to: string; below?: number }> = new Map([
  ['wood/5', { to: 'wood/0', below: 3000 }],
  ['desert/74030fc3f293a41f1025f88e725018ff', { to: 'desert/10' }],
]);

/** The key a record belongs under, given its key (an "@<hash>" suffix is dropped) and best time */
export function sharedKeyTarget(key: string, best: number): string | null {
  const shared = SHARED_LEVEL_KEYS.get(key.split('@')[0]);
  return shared && (shared.below === undefined || best < shared.below) ? shared.to : null;
}

/**
 * Give every level of one theme / pack its own id. A level's id is the key its records are saved
 * under, so two levels sharing one (a map copied into the next level keeps the id of the first)
 * would share their records and leaderboard. The first level keeps a repeated id; each later one
 * gets a fresh id from its content and position. Returns the same array when nothing repeats.
 */
export function uniqueLevelIds<T extends MapData>(levels: readonly T[], taken: Iterable<string> = []): T[] {
  const seen = new Set<string>(taken);
  let changed = false;
  const out = levels.map((m, i) => {
    let id = m.id ?? '';
    if (id && !seen.has(id)) {
      seen.add(id);
      return m;
    }
    // Fresh and stable for the same level at the same position
    for (let n = 0; !id || seen.has(id); n++) id = sha256(`${contentHash(m)}:${i}:${n}`).slice(0, 32);
    seen.add(id);
    changed = true;
    return { ...m, id };
  });
  return changed ? out : (levels as T[]);
}
