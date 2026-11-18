import { describe, expect, it } from 'vitest';
import { displayTime, recordTime } from './time';
import { formatTime } from './simulation';

describe('leaderboard millisecond precision', () => {
  it.each([
    [7918.49, 7918, '7.918'],
    [7918.5, 7918, '7.918'],
    [7918.99, 7918, '7.918'],
    [999.999, 999, '0.999'],
    [1000, 1000, '1.000'],
    [(690 / 700) * 1000, 985, '0.985'],
  ])('truncates %s ms to %s ms and displays %s', (raw, stored, text) => {
    expect(recordTime(raw)).toBe(stored);
    expect(displayTime(raw)).toBe(stored);
    expect(formatTime(raw)).toBe(text);
    expect(formatTime(recordTime(raw))).toBe(text);
  });
  it('preserves zero for the ready timer and the server minimum for clears', () => {
    expect(displayTime(0)).toBe(0);
    expect(recordTime(0.1)).toBe(1);
    expect(formatTime(recordTime(0.1))).toBe('0.001');
  });
});
