import { describe, expect, it } from 'vitest';
import { byteLength, emailError, formatPlayTime, formatTag, nicknameError, passwordError } from './account';

describe('account rules', () => {
  it('formats nickname#discriminator with 4 digits', () => {
    expect(formatTag('Dizzt', 3942)).toBe('Dizzt#3942');
    expect(formatTag('Dizzt', 7)).toBe('Dizzt#0007');
    expect(formatTag('Dizzt', 9999)).toBe('Dizzt#9999');
  });

  it('limits nicknames to 32 UTF-8 bytes', () => {
    expect(nicknameError('a'.repeat(32))).toBeNull();
    expect(nicknameError('a'.repeat(33))).not.toBeNull();
    expect(byteLength('가나다라마바사아자차')).toBe(30);
    expect(nicknameError('가나다라마바사아자차')).toBeNull(); // 10 Korean chars = 30 bytes
    expect(nicknameError('가나다라마바사아자차카')).not.toBeNull(); // 33 bytes
    expect(nicknameError('😀'.repeat(8))).toBeNull(); // 4 bytes each = 32
    expect(nicknameError('😀'.repeat(9))).not.toBeNull();
  });

  it('rejects empty, padded, "#" and control-character nicknames', () => {
    expect(nicknameError('')).not.toBeNull();
    expect(nicknameError(' Dizzt')).not.toBeNull();
    expect(nicknameError('Diz#zt')).not.toBeNull();
    expect(nicknameError('Diz\nzt')).not.toBeNull();
    expect(nicknameError('Dizzt Kim')).toBeNull();
  });

  it('checks email and password', () => {
    expect(emailError('player@example.com')).toBeNull();
    expect(emailError('player@example')).not.toBeNull();
    expect(emailError('')).not.toBeNull();
    expect(passwordError('abc12345')).toBeNull();
    expect(passwordError('abc1234')).not.toBeNull(); // too short
    expect(passwordError('abcdefgh')).not.toBeNull(); // no number
    expect(passwordError('a1'.repeat(37))).not.toBeNull(); // 74 bytes > bcrypt's 72
  });

  it('formats play time as hours, minutes and seconds', () => {
    expect(formatPlayTime(0)).toBe('0m 00s');
    expect(formatPlayTime(59)).toBe('0m 59s');
    expect(formatPlayTime(95)).toBe('1m 35s');
    expect(formatPlayTime(4115)).toBe('1h 08m 35s');
    expect(formatPlayTime(100 * 3600 + 61)).toBe('100h 01m 01s');
  });
});
