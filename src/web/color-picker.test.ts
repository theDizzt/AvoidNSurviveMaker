import { describe, expect, it } from 'vitest';
import { formatColor, parseColor } from './color-picker';

describe('color picker', () => {
  it('round-trips colors, with opacity only when not opaque', () => {
    for (const c of ['#000000', '#ffffff', '#3a9ff0', '#c55d36', '#12345680', '#ff000000']) expect(formatColor(parseColor(c)!)).toBe(c);
    expect(formatColor(parseColor('#abc')!)).toBe('#aabbcc');
    expect(formatColor(parseColor('#3a9ff0ff')!)).toBe('#3a9ff0');
    expect(formatColor(parseColor('#12345680')!, false)).toBe('#123456');
    expect(parseColor('nope')).toBeNull();
  });
});
