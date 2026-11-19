import type { MessageKey } from './i18n';

export interface AchievementRecord { best: number; stars: number; crystal?: boolean }

/** A skin an achievement unlocks */
export interface AchievementReward { kind: 'pointer' | 'trail'; skin: number }

/**
 * stars: stars (plus crystal stars) over `levels` reach `target`.
 * time: a clear of `levels[0]` in `maxMs` or less.
 * discord: visited the Discord server (claimed by the client; nothing to verify).
 */
export type AchievementKind = 'stars' | 'time' | 'discord';

export interface AchievementDefinition {
  /** Fixed number from 1; never reused or renumbered (the server rules use the same ids) */
  id: number;
  name: MessageKey;
  category: 'stars' | 'chapter' | 'special';
  kind: AchievementKind;
  target: number;
  levels: readonly string[];
  /** kind 'time': the slowest clear that counts */
  maxMs?: number;
  /** null: to be announced */
  reward: AchievementReward | null;
}

/** Official chapters in order (theme ids); the server's refresh_achievements() uses the same list */
export const CHAPTER_IDS = [
  'workshop', 'desert', 'wood', 'botany', 'frost', 'factory', 'sky', 'magma',
  'optics', 'ocean', 'cavern', 'galaxy', 'chapter-13', 'chapter-14', 'cyberfunk', 'chapter-16',
] as const;
export const LEVELS_PER_CHAPTER = 21;

const chapterLevels = (id: string) => Array.from({ length: LEVELS_PER_CHAPTER }, (_, i) => `${id}/${i}`);
const chapter1 = chapterLevels('workshop');
const allLevels = CHAPTER_IDS.flatMap(chapterLevels);
/** 3 stars per level plus 3 crystal stars per chapter */
export const TOTAL_STARS = allLevels.length * 3 + CHAPTER_IDS.length * 3;

const stars = (id: number, target: number, reward: AchievementReward | null): AchievementDefinition =>
  ({ id, name: `ach.${id}` as MessageKey, category: 'stars', kind: 'stars', target, levels: allLevels, reward });
const pointer = (skin: number): AchievementReward => ({ kind: 'pointer', skin });
const trail = (skin: number): AchievementReward => ({ kind: 'trail', skin });

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  stars(1, 16, pointer(2)),
  stars(2, 66, pointer(3)),
  stars(3, 132, trail(2)),
  stars(4, 264, pointer(6)),
  stars(5, 339, trail(3)),
  stars(6, 420, trail(4)),
  stars(7, 528, trail(5)),
  stars(8, 666, pointer(7)),
  stars(9, 777, pointer(8)),
  stars(10, 884, trail(6)),
  stars(11, TOTAL_STARS, null),
  { id: 12, name: 'ach.12', category: 'special', kind: 'discord', target: 1, levels: [], reward: trail(7) },
  { id: 13, name: 'ach.13', category: 'chapter', kind: 'stars', target: 33, levels: chapter1, reward: pointer(4) },
  { id: 14, name: 'ach.14', category: 'chapter', kind: 'time', target: 1, levels: ['workshop/0'], maxMs: 35, reward: pointer(9) },
  { id: 15, name: 'ach.15', category: 'chapter', kind: 'time', target: 1, levels: ['workshop/1'], maxMs: 61, reward: trail(9) },
  { id: 16, name: 'ach.16', category: 'chapter', kind: 'stars', target: 66, levels: chapter1, reward: trail(8) },
];

/** The achievement whose reward is this skin, if it is a reward at all */
export function rewardAchievement(kind: 'pointer' | 'trail', skin: number): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((d) => d.reward?.kind === kind && d.reward.skin === skin);
}

/** Stars a record counts for: its best stars (0–3) plus 1 for a crystal star */
export function recordStars(record: AchievementRecord | undefined): number {
  if (!record || !Number.isFinite(record.best) || record.best <= 0) return 0;
  const s = Number.isFinite(record.stars) ? Math.max(0, Math.min(3, Math.floor(record.stars))) : 0;
  return s + (record.crystal ? 1 : 0);
}

/** "1-01" for "workshop/0" */
export function levelLabel(key: string): string {
  const [theme, index] = key.split('/');
  const chapter = CHAPTER_IDS.indexOf(theme as (typeof CHAPTER_IDS)[number]) + 1;
  return `${chapter || '?'}-${String(Number(index) + 1).padStart(2, '0')}`;
}

/** Progress toward `def.target`; a discord achievement only counts once unlocked */
export function achievementProgress(def: AchievementDefinition, records: Readonly<Record<string, AchievementRecord>>): number {
  if (def.kind === 'discord') return 0;
  if (def.kind === 'time') {
    const r = records[def.levels[0]];
    return Number(!!r && Number.isFinite(r.best) && r.best > 0 && r.best <= (def.maxMs ?? 0));
  }
  let count = 0;
  for (const key of new Set(def.levels)) count += recordStars(records[key]);
  return Math.min(def.target, count);
}
