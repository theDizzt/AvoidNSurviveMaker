/**
 * Every date/time shown in the game is in UTC, whatever the player's time zone:
 * "2026-11-17 08:05:09 UTC". Use this instead of toLocaleString() for timestamps.
 */
export function formatUtc(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Today's date in UTC, "2026-11-17" */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Millisecond precision shared by the leaderboard, saved records and result UI. */
export const recordTime = (ms: number): number => Math.max(1, Math.round(ms));

/** Ready/running timers may display zero; completed clears use recordTime. */
export const displayTime = (ms: number): number => Math.max(0, Math.round(ms));
