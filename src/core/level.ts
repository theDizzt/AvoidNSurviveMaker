import { t } from './i18n';
import type { MapData } from './types';

/** Stars earned for a clear time (ms): 0–3, or null when the map has no star times */
export function starsFor(map: MapData, ms: number): number | null {
  const s = map.stars;
  if (!s) return null;
  if (ms <= s.three) return 3;
  if (ms <= s.two) return 2;
  if (ms <= s.one) return 1;
  return 0;
}

/** "★★☆" */
export function starText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/** Chapter level code, the same in every language: chapter 1 level 1 → "1-01", chapter 11 level 16 → "11-16" */
export function chapterLevelCode(chapter: number, level: number): string {
  return `${chapter}-${String(level).padStart(2, '0')}`;
}

/** In-game title: "Level 3 · Title", falling back to the file name */
export function levelLabel(map: MapData): string {
  const title = map.title || map.name;
  return map.level !== undefined ? t('level.label', { n: map.level, title }) : title;
}

/** Star goals in seconds, e.g. "★★★ 12.0s · ★★ 20.0s · ★ 30.0s" */
export function starGoals(map: MapData): string {
  const s = map.stars;
  if (!s) return '';
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return `★★★ ${sec(s.three)} · ★★ ${sec(s.two)} · ★ ${sec(s.one)}`;
}

/**
 * The parts of a map that affect play. A clear verified in test play stays valid while only
 * names, level settings, the theme or editor grouping change.
 */
export function gameplayKey(map: MapData): string {
  return JSON.stringify({
    v: map.v,
    width: map.width,
    height: map.height,
    start: map.start,
    goal: map.goal,
    objects: map.objects.map(({ group: _group, ...rest }) => rest),
    darkness: map.darkness ?? null,
  });
}
