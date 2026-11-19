import { expect, it } from 'vitest';
import { createEmptyMap } from '../core/validate';
import { verifyMapReplay, verifyReplay } from './verifier';

const replay = { v: 1, samples: [{ t: 0, x: 120, y: 540 }, { t: 100, x: 1800, y: 540 }] };

it('computes clear time and stars from the authoritative map instead of claimed results', () => {
  const result = verifyMapReplay({ ...createEmptyMap(), stars: { one: 120, two: 110, three: 100 } },
    { ...replay, best_ms: 1, stars: 0, crystal: true });
  expect(result.best_ms).toBeGreaterThan(1);
  expect(result.best_ms).toBeLessThanOrEqual(100);
  expect(result.stars).toBe(3);
  expect(result.crystal).toBe(false);
});

it('rejects unknown versions, aborted runs, unordered time, excessive duration and nonfinite input', () => {
  expect(() => verifyReplay('workshop/0', replay)).toThrow('UNKNOWN_LEVEL_VERSION');
  expect(() => verifyMapReplay(createEmptyMap(), { ...replay, abort: { reason: 'blur' } })).toThrow();
  for (const sample of [{ t: 0, x: 1800, y: 540 }, { t: 120001, x: 1800, y: 540 }, { t: 100, x: NaN, y: 540 }]) {
    expect(() => verifyMapReplay(createEmptyMap(), { v: 1, samples: [replay.samples[0], sample] })).toThrow();
  }
  expect(() => verifyMapReplay(createEmptyMap(), { v: 1, samples: [replay.samples[0], { t: 100, x: 130, y: 540 }] })).toThrow('NOT_CLEARED');
});
