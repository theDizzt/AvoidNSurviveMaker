import { t } from './i18n';
/**
 * Account field rules, shared by the sign-up form and mirrored by the database
 * (supabase/migrations/*_profiles.sql) so both sides agree.
 */

export const NICKNAME_MAX_BYTES = 32;
export const DISCRIMINATOR_MAX = 9999;
export const PASSWORD_MIN = 8;
/** bcrypt only uses the first 72 bytes; longer passwords are rejected rather than silently truncated */
export const PASSWORD_MAX_BYTES = 72;

const encoder = new TextEncoder();

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** "Dizzt", 42 → "Dizzt#0042" */
export function formatTag(nickname: string, discriminator: number): string {
  return `${nickname}#${String(discriminator).padStart(4, '0')}`;
}

/** Returns an error message, or null when the nickname is acceptable. Expects a trimmed value. */
export function nicknameError(nickname: string): string | null {
  if (nickname.length === 0) return t('account.nickEmpty');
  if (nickname !== nickname.trim()) return t('account.nickSpace');
  if (byteLength(nickname) > NICKNAME_MAX_BYTES) return t('account.nickLong', { max: NICKNAME_MAX_BYTES });
  if (nickname.includes('#')) return t('account.nickHash');
  if (/[\u0000-\u001f\u007f-\u009f]/.test(nickname)) return t('account.nickInvalid');
  return null;
}

export function emailError(email: string): string | null {
  if (email.length === 0) return t('account.emailEmpty');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return t('account.emailInvalid');
  return null;
}

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return t('account.passShort', { min: PASSWORD_MIN });
  if (byteLength(password) > PASSWORD_MAX_BYTES) return t('account.passLong', { max: PASSWORD_MAX_BYTES });
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return t('account.passMix');
  return null;
}

/** 4115 (seconds) → "1h 08m 35s" (hours keep growing past 24) */
export function formatPlayTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  // Same notation in every language
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}
