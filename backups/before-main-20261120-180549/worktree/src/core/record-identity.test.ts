import { expect, it } from 'vitest';
import { contentHash, recordIdentity, sha256 } from './record-identity';
import { createEmptyMap, validateMap } from './validate';

it('matches standard SHA-256 vectors including multiblock input', () => {
  expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

it("keeps a level's identity across slots, labels and map updates", () => {
  const map = { ...createEmptyMap(), id: 'stable', level: 1 };
  const key = recordIdentity('world', map, true);
  expect(recordIdentity('world', { ...map, level: 8, name: 'Renamed' }, true)).toBe(key);
  expect(recordIdentity('world', { ...map, goal: { ...map.goal, x: 1000 } }, true)).toBe(key);
  expect(key).toBe('world/stable');
  expect(contentHash({ ...map, stars: { one: 3000, two: 2000, three: 1000 } })).not.toBe(contentHash(map));
  expect(recordIdentity('world', map, false)).not.toBe(key);
  expect(validateMap(map).id).toBe('stable');
});

it('keys custom levels by pack and level id, not by slot or content', () => {
  const map = createEmptyMap();
  const key = recordIdentity('same-pack', map, false);
  expect(key.startsWith('custom:same-pack/')).toBe(true);
  expect(recordIdentity('same-pack', { ...map, width: 1800 }, false)).toBe(key);
  expect(recordIdentity('same-pack', { ...map, level: 5 }, false)).toBe(key);
});

it('fills an absent ID from the level number, with a deterministic content fallback', () => {
  const input = { ...createEmptyMap(), id: undefined, level: 4 };
  expect(validateMap(input).id).toBe('3');
  const numbered = validateMap(input);
  expect(validateMap({ ...numbered, level: 9 }).id).toBe('3');
  expect(validateMap({ ...input, id: 'my-level' }).id).toBe('my-level');
  const unnumbered = { ...input, level: undefined };
  expect(validateMap(unnumbered).id).toMatch(/^[a-f0-9]{32}$/);
  expect(validateMap({ ...unnumbered, name: 'Renamed' }).id).toBe(validateMap(unnumbered).id);
});
