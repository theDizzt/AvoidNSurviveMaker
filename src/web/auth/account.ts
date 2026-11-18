import { t } from '../../core/i18n';
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { formatTag } from '../../core/account';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  nickname: string;
  discriminator: number;
  created_at: string;
  /** Total time the game has been open (seconds) */
  total_play_seconds: number;
}

export type AuthResult = { ok: true } | { ok: false; code: string; message: string };

/** Where the verification email link sends the player back to */
function redirectUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** Turn Supabase errors into messages a player can act on */
function explain(e: AuthError | Error | null | undefined, fallback = t('auth.genericError')): AuthResult {
  if (!e) return { ok: false, code: 'unknown', message: fallback };
  const code = ('code' in e && typeof e.code === 'string' ? e.code : '') || 'unknown';
  const text = e.message ?? '';
  const messages: Record<string, string> = {
    invalid_credentials: t('auth.invalidCredentials'),
    email_not_confirmed: t('auth.emailNotConfirmed'),
    user_already_exists: t('auth.emailExists'),
    email_exists: t('auth.emailExists'),
    weak_password: t('auth.weakPassword'),
    captcha_failed: t('auth.captchaFailed'),
    over_email_send_rate_limit: t('auth.emailRateLimit'),
    over_request_rate_limit: t('auth.requestRateLimit'),
    signup_disabled: t('auth.signupDisabled'),
    email_address_invalid: t('account.emailInvalid'),
  };
  // Per-address cooldown ("…only request this after 42 seconds") vs. the project-wide hourly cap
  const wait = /after (\d+) seconds?/i.exec(text);
  if (code.startsWith('over_') && wait) {
    return { ok: false, code, message: t('auth.emailCooldown', { s: wait[1] }) };
  }
  if (code === 'over_email_send_rate_limit') {
    return { ok: false, code, message: t('auth.emailHourly') };
  }
  if (messages[code]) return { ok: false, code, message: messages[code] };
  // Errors raised by the sign-up trigger surface as a generic database error
  if (/NICKNAME_FULL/.test(text)) return { ok: false, code: 'nickname_full', message: t('auth.nicknameFull') };
  if (/INVALID_NICKNAME/.test(text)) return { ok: false, code: 'invalid_nickname', message: t('auth.nicknameInvalid') };
  if (/Database error saving new user/i.test(text)) return { ok: false, code: 'db', message: t('auth.createFailed') };
  if (/failed to fetch|network/i.test(text)) return { ok: false, code: 'network', message: t('net.unreachable') };
  return { ok: false, code, message: text || fallback };
}

/**
 * Current player account: session + public profile (nickname#tag).
 * Listeners fire whenever the signed-in state or profile changes.
 */
export class Account {
  user: User | null = null;
  profile: Profile | null = null;
  /** Message from the email-verification redirect, shown once after boot */
  notice: { kind: 'ok' | 'error'; text: string } | null = null;
  private readonly listeners = new Set<() => void>();

  get configured(): boolean {
    return supabase !== null;
  }

  get tag(): string | null {
    return this.profile ? formatTag(this.profile.nickname, this.profile.discriminator) : null;
  }

  /** Update the cached total after the server accepted a play-time report */
  setPlayTotal(totalSeconds: number): void {
    if (!this.profile) return;
    this.profile = { ...this.profile, total_play_seconds: totalSeconds };
    this.emit();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Restore the session and handle a returning verification link (?code=… or ?error=…) */
  async init(): Promise<void> {
    if (!supabase) return;
    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.startsWith('#m=') ? '' : location.hash.slice(1));
    const cameFromEmail = params.has('code');
    const linkError = params.get('error_description') ?? hashParams.get('error_description');

    supabase.auth.onAuthStateChange((_event, session) => {
      // Don't await inside the callback (supabase-js holds a lock while it runs)
      setTimeout(() => void this.applySession(session), 0);
    });

    const { data, error } = await supabase.auth.getSession();
    await this.applySession(data.session);

    if (linkError) {
      this.notice = { kind: 'error', text: t('auth.linkProblem', { error: linkError }) };
    } else if (cameFromEmail) {
      this.notice = data.session && !error
        ? { kind: 'ok', text: t('auth.verifiedWelcome', { tag: this.tag ?? t('auth.player') }) }
        // The link was opened in another browser: the email is confirmed, but the session can't be restored here
        : { kind: 'ok', text: t('auth.verifiedSignIn') };
    }
    if (cameFromEmail || linkError) {
      // Drop the one-time code from the address bar, keep any share link hash
      history.replaceState(null, '', `${location.pathname}${location.hash.startsWith('#m=') ? location.hash : ''}`);
    }
  }

  private async applySession(session: Session | null): Promise<void> {
    const user = session?.user ?? null;
    const changed = user?.id !== this.user?.id;
    this.user = user;
    if (!user) {
      this.profile = null;
    } else if (changed || !this.profile) {
      this.profile = await this.fetchProfile(user.id);
    }
    this.emit();
  }

  private async fetchProfile(id: string): Promise<Profile | null> {
    if (!supabase) return null;
    const { data } = await supabase.from('profiles').select('id, nickname, discriminator, created_at, total_play_seconds').eq('id', id).maybeSingle();
    return (data as Profile | null) ?? null;
  }

  /** Free tags left for a nickname (null if the check itself failed) */
  async slotsLeft(nickname: string): Promise<number | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('nickname_slots_left', { p_nickname: nickname });
    return error || typeof data !== 'number' ? null : data;
  }

  async signUp(email: string, password: string, nickname: string, captchaToken?: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, code: 'not_configured', message: t('auth.notConfigured') };
    const left = await this.slotsLeft(nickname);
    if (left === 0) return explain(new Error('NICKNAME_FULL'));

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nickname }, captchaToken, emailRedirectTo: redirectUrl() },
    });
    if (error) return explain(error);
    // With email confirmation on, an already-registered address returns a user with no identities
    if (data.user && data.user.identities?.length === 0) return explain({ code: 'user_already_exists' } as AuthError);
    return { ok: true };
  }

  async signIn(email: string, password: string, captchaToken?: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, code: 'not_configured', message: t('auth.notConfigured') };
    const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
    return error ? explain(error) : { ok: true };
  }

  async resendVerification(email: string, captchaToken?: string): Promise<AuthResult> {
    if (!supabase) return { ok: false, code: 'not_configured', message: t('auth.notConfigured') };
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectUrl(), captchaToken } });
    return error ? explain(error) : { ok: true };
  }

  /** Runs before signing out while the session is still valid (e.g. send pending play time) */
  beforeSignOut: (() => Promise<void>) | null = null;

  async signOut(): Promise<void> {
    await this.beforeSignOut?.().catch(() => {});
    await supabase?.auth.signOut();
  }
}

