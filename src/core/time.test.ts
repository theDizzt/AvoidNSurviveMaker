import { describe, expect, it } from 'vitest';
import { displayTime, recordTime } from './time';
import { formatTime } from './simulation';

describe('leaderboard millisecond precision', () => {
  it('shows the same time before and after a server round trip', () => {
    for (const ms of [7918.49, 7918.5, 7918.99, 999.999]) {
      expect(formatTime(ms)).toBe(formatTime(recordTime(ms)));
      expect(displayTime(ms)).toBe(recordTime(ms));
    }
    expect(formatTime(7918.7)).toBe('7.919');
  });
  it('preserves zero for the ready timer and the server minimum for clears', () => {
    expect(displayTime(0)).toBe(0);
    expect(recordTime(0.1)).toBe(1);
    expect(formatTime(recordTime(0.1))).toBe('0.001');
  });
});
