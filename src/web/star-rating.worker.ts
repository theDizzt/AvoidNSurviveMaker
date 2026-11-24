import { rateStars, type SkillId, type StarTier } from '../core/star-solver';
import type { MapData, StarTimes } from '../core/types';

export interface StarRatingRequest {
  map: MapData;
  tier: StarTier;
  observedMs: number | null;
}

export type StarRatingMessage =
  | { type: 'progress'; skill: SkillId; ms: number }
  | { type: 'done'; stars: StarTimes; times: Record<SkillId, number>; found: Record<SkillId, boolean> }
  | { type: 'error'; message: string };

const post = (m: StarRatingMessage) => self.postMessage(m);

self.onmessage = (event: MessageEvent<StarRatingRequest>) => {
  const { map, tier, observedMs } = event.data;
  let last = 0;
  try {
    const r = rateStars(map, tier, {
      observedMs,
      progress: (skill, ms) => {
        const now = performance.now();
        if (now - last < 120) return;
        last = now;
        post({ type: 'progress', skill, ms });
      },
    });
    const found = Object.fromEntries(r.skills.map((s) => [s.id, s.ms !== null])) as Record<SkillId, boolean>;
    if (!r.skills.some((s) => s.ms !== null) && !observedMs) throw new Error('no route');
    post({ type: 'done', stars: r.stars, times: r.times, found });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
