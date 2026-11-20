import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementProgress, levelLabel, rewardAchievement, TOTAL_STARS } from './achievements';

const def = (id: number) => ACHIEVEMENTS.find((d) => d.id === id)!;

describe('achievements', () => {
  it('numbers ids 1..16 with no gaps', () => {
    expect(ACHIEVEMENTS.map((d) => d.id)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it('counts 1056 stars over the 16 chapters', () => {
    expect(TOTAL_STARS).toBe(1056);
    expect(def(11).target).toBe(1056);
  });

  it('counts crystal stars on top of the best stars', () => {
    const records = { 'workshop/0': { best: 900, stars: 3, crystal: true }, 'workshop/1': { best: 900, stars: 2 } };
    expect(achievementProgress(def(13), records)).toBe(6);
    expect(achievementProgress(def(1), { 'custom:workshop/0': { best: 900, stars: 3 } })).toBe(0);
  });

  it('time achievements need the clear at or under the limit', () => {
    expect(achievementProgress(def(14), { 'workshop/0': { best: 35, stars: 3 } })).toBe(1);
    expect(achievementProgress(def(14), { 'workshop/0': { best: 36, stars: 3 } })).toBe(0);
  });

  it('each reward skin belongs to one achievement', () => {
    const rewards = ACHIEVEMENTS.flatMap((d) => (d.reward ? [`${d.reward.kind}${d.reward.skin}`] : []));
    expect(new Set(rewards).size).toBe(rewards.length);
    expect(rewardAchievement('trail', 9)?.id).toBe(15);
    expect(rewardAchievement('pointer', 1)).toBeUndefined();
    expect(levelLabel('workshop/1')).toBe('1-02');
  });
});
