import { beforeEach, describe, expect, it } from 'vitest';
import { AutoQuality } from './auto-quality';
import { options, resetOptions, setOption } from './options';

/** Feed `seconds` of frames at `fps`, starting at `from` ms; returns the time after and any change */
function play(q: AutoQuality, from: number, fps: number, seconds: number): { now: number; lowered: string[] } {
  const gap = 1000 / fps;
  const lowered: string[] = [];
  let now = from;
  for (let i = 0; i < fps * seconds; i++) {
    now += gap;
    const level = q.frame(now, gap);
    if (level) lowered.push(level);
  }
  return { now, lowered };
}

describe('AutoQuality', () => {
  beforeEach(() => resetOptions());

  it('keeps the quality when play is smooth', () => {
    const q = new AutoQuality();
    q.reset(0);
    expect(play(q, 0, 60, 10).lowered).toEqual([]);
    expect(options.graphics).toBe('high');
  });

  it('steps down one level at a time, waiting for the canvases to settle in between', () => {
    const q = new AutoQuality();
    q.reset(0);
    const first = play(q, 0, 25, 3.5);
    expect(first.lowered).toEqual(['medium']);
    expect(options.graphics).toBe('medium');
    // Still slow: the next step only after the settle time and a full window
    const second = play(q, first.now, 25, 8);
    expect(second.lowered).toEqual(['low']);
    expect(play(q, second.now, 25, 10).lowered).toEqual([]);
    expect(options.graphics).toBe('low');
  });

  it('judges against the frame limit and can be turned off', () => {
    setOption('frameLimit', 30);
    const q = new AutoQuality();
    q.reset(0);
    expect(play(q, 0, 30, 10).lowered).toEqual([]);
    setOption('frameLimit', 0);
    setOption('autoQuality', false);
    q.reset(0);
    expect(play(q, 0, 20, 10).lowered).toEqual([]);
    expect(options.graphics).toBe('high');
  });

  it('ignores pauses', () => {
    const q = new AutoQuality();
    q.reset(0);
    let now = 0;
    for (let i = 0; i < 20; i++) {
      now += 500; // a hidden tab: rare, long gaps
      expect(q.frame(now, 500)).toBeNull();
    }
    expect(options.graphics).toBe('high');
  });
});
