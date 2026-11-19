import type { MessageKey } from './i18n';

export interface AchievementRecord { best: number; stars: number }
export interface AchievementDefinition {
  id: string;
  name: MessageKey;
  category: 'clear' | 'stars' | 'chapter';
  kind: 'clear' | 'stars' | 'perfect';
  target: number;
  levels: readonly string[];
}

// Release v1 targets are fixed: adding levels must not move an existing goalpost.
const workshop = Array.from({ length: 21 }, (_, i) => `workshop/${i}`);
const desert = Array.from({ length: 10 }, (_, i) => `desert/${i}`);
const levels = [...workshop, ...desert];
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  ...[1, 5, 10, 20].map(target => ({ id: `clear.${target}`, name: `ach.clear${target}` as MessageKey, category: 'clear' as const, kind: 'clear' as const, target, levels })),
  ...[3, 15, 30, 60].map(target => ({ id: `stars.${target}`, name: `ach.stars${target}` as MessageKey, category: 'stars' as const, kind: 'stars' as const, target, levels })),
  ...[1, 5].map(target => ({ id: `perfect.${target}`, name: `ach.perfect${target}` as MessageKey, category: 'stars' as const, kind: 'perfect' as const, target, levels })),
  { id: 'chapter.workshop.clear.v1', name: 'ach.workshop', category: 'chapter', kind: 'clear', target: workshop.length, levels: workshop },
  { id: 'chapter.desert.clear.v1', name: 'ach.desert', category: 'chapter', kind: 'clear', target: desert.length, levels: desert },
];

export function achievementProgress(def: AchievementDefinition, records: Readonly<Record<string, AchievementRecord>>): number {
  let count = 0;
  for (const key of new Set(def.levels)) {
    const record = records[key];
    if (!record || !Number.isFinite(record.best) || record.best <= 0) continue;
    const stars = Number.isFinite(record.stars) ? Math.max(0, Math.min(3, Math.floor(record.stars))) : 0;
    count += def.kind === 'stars' ? stars : def.kind === 'perfect' ? Number(stars === 3) : 1;
  }
  return Math.min(def.target, count);
}
