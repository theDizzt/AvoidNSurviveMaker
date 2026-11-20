import { describe, expect, it } from 'vitest';
import { recordIdentity, uniqueLevelIds } from './record-identity';
import type { MapData } from './types';
import { createEmptyMap, validateMap, validatePack } from './validate';

describe('level ids', () => {
  it('every level file of a theme has its own record key', () => {
    const infos = import.meta.glob<{ id: string }>(['../../themes/*/theme.json', '../../custom-themes/*/theme.json'], { eager: true, import: 'default' });
    const files = import.meta.glob<unknown>(['../../themes/*/levels/*.json', '../../custom-themes/*/levels/*.json'], { eager: true, import: 'default' });
    expect(Object.keys(infos).length).toBeGreaterThan(0);
    for (const [path, info] of Object.entries(infos)) {
      const folder = path.slice(0, -'theme.json'.length);
      const official = path.startsWith('../../themes/');
      const keys = Object.keys(files).filter((p) => p.startsWith(`${folder}levels/`)).sort()
        .map((p) => recordIdentity(info.id, validateMap(files[p]), official));
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(dupes, folder).toEqual([]);
    }
  });

  it('a repeated id is replaced on the later levels only', () => {
    const map = (id: string, x: number): MapData => ({ ...createEmptyMap(), id, start: { x, y: 0, w: 50, h: 50 } });
    const out = uniqueLevelIds([map('5', 0), map('5', 10), map('6', 20), map('5', 30)]);
    expect(out[0].id).toBe('5');
    expect(out[2].id).toBe('6');
    expect(new Set(out.map((m) => m.id)).size).toBe(4);
    // Unchanged lists come back as they are
    const ok = [map('a', 0), map('b', 0)];
    expect(uniqueLevelIds(ok)).toBe(ok);
    // Ids already in use elsewhere count too
    expect(uniqueLevelIds([map('a', 0)], ['a'])[0].id).not.toBe('a');
  });

  it('a shared map pack with repeated ids gets unique ones', () => {
    const level = { ...createEmptyMap(), id: 'same' };
    const pack = validatePack({ pack: 1, name: 'p', author: 'a', levels: [level, level] });
    expect(pack.levels[0].id).not.toBe(pack.levels[1].id);
  });
});
