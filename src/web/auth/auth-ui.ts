import { byteLength, emailError, formatPlayTime, NICKNAME_MAX_BYTES, nicknameError, passwordError } from '../../core/account';
import type { Account, AuthResult } from './account';
import { Captcha } from './captcha';
import { TURNSTILE_SITE_KEY } from './supabase';

type Tab = 'signin' | 'signup';
const RESEND_COOLDOWN_S = 60;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

export function showToast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(window.setTimeout(() => (t.hidden = true), 6000));
}

/**
 * Sign-in / sign-up / verify-email screens and the account badges.
 * `navigate` switches the app to another screen (owned by main.ts).
 */
export class AuthUI {
  private pendingEmail = '';
  private cooldownUntil = 0;
  private readonly signinForm = $<HTMLFormElement>('signin-form');
  private readonly signupForm = $<HTMLFormElement>('signup-form');
  private readonly captchas: Record<'signin' | 'signup' | 'verify', Captcha>;

  constructor(
    private readonly account: Account,
    private readonly navigate: (screen: 'menu' | 'auth' | 'verify') => void,
  ) {
    const gate = (form: HTMLFormElement | HTMLElement, button: HTMLButtonElement) => (ready: boolean) => {
      button.disabled = !ready;
      form.classList.toggle('waiting-captcha', !ready);
    };
    this.captchas = {
      signin: new Captcha($('signin-captcha'), TURNSTILE_SITE_KEY, gate(this.signinForm, this.submitButton(this.signinForm))),
      signup: new Captcha($('signup-captcha'), TURNSTILE_SITE_KEY, gate(this.signupForm, this.submitButton(this.signupForm))),
      verify: new Captcha($('verify-captcha'), TURNSTILE_SITE_KEY, (ready) => this.updateResend(ready)),
    };

    $('tab-signin').addEventListener('click', () => this.setTab('signin'));
    $('tab-signup').addEventListener('click', () => this.setTab('signup'));
    $('auth-back').addEventListener('click', () => this.navigate('menu'));
    this.signinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitSignIn();
    });
    this.signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitSignUp();
    });
    $('signin-resend').addEventListener('click', () => {
      this.pendingEmail = this.value(this.signinForm, 'email');
      this.openVerify();
    });
    $('verify-resend').addEventListener('click', () => void this.resend());
    $('verify-signin').addEventListener('click', () => this.open('signin'));

    // Live nickname preview: "Nickname#????" and byte counter
    const nick = this.input(this.signupForm, 'nickname');
    const updateNick = () => {
      const v = nick.value.trim();
      const bytes = byteLength(v);
      $('nick-preview').textContent = `${v || 'Nickname'}#????`;
      const counter = $('nick-bytes');
      counter.textContent = `${bytes}/${NICKNAME_MAX_BYTES} bytes`;
      counter.classList.toggle('over', bytes > NICKNAME_MAX_BYTES);
    };
    nick.addEventListener('input', updateNick);
    updateNick();

    account.onChange(() => this.renderBadges());
    this.renderBadges();
  }

  /** Show the account screen on a tab */
  open(tab: Tab = 'signin'): void {
    this.setTab(tab);
    this.navigate('auth');
    const off = !this.account.configured;
    $('auth-unconfigured').hidden = !off;
    for (const f of [this.signinForm, this.signupForm]) {
      for (const el of f.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) el.disabled = off;
    }
    if (!off) void this.mountCaptcha(tab);
  }

  private openVerify(): void {
    $('verify-email').textContent = this.pendingEmail || 'your email';
    this.setError($('verify-screen'), '');
    this.navigate('verify');
    void this.mountCaptcha('verify');
    this.updateResend(this.captchas.verify.ready);
  }

  private setTab(tab: Tab): void {
    $('tab-signin').setAttribute('aria-selected', String(tab === 'signin'));
    $('tab-signup').setAttribute('aria-selected', String(tab === 'signup'));
    this.signinForm.hidden = tab !== 'signin';
    this.signupForm.hidden = tab !== 'signup';
    this.setError(this.signinForm, '');
    this.setError(this.signupForm, '');
    if (this.account.configured) void this.mountCaptcha(tab);
    this.input(tab === 'signin' ? this.signinForm : this.signupForm, 'email').focus();
  }

  private async mountCaptcha(which: 'signin' | 'signup' | 'verify'): Promise<void> {
    const c = this.captchas[which];
    try {
      await c.mount();
      if (which !== 'verify') this.submitButton(which === 'signin' ? this.signinForm : this.signupForm).disabled = !c.ready;
    } catch (err) {
      const host = which === 'verify' ? $('verify-screen') : which === 'signin' ? this.signinForm : this.signupForm;
      this.setError(host, (err as Error).message);
    }
  }

  // ───────────────────────── Submit handlers ─────────────────────────

  private async submitSignIn(): Promise<void> {
    const f = this.signinForm;
    const email = this.value(f, 'email');
    const password = this.input(f, 'password').value;
    const problem = emailError(email) ?? (password ? null : 'Enter your password.');
    $('signin-resend').hidden = true;
    if (problem) return this.setError(f, problem);

    const res = await this.busy(f, () => this.account.signIn(email, password, this.captchas.signin.token()));
    this.captchas.signin.reset();
    if (!res.ok) {
      this.setError(f, res.message);
      $('signin-resend').hidden = res.code !== 'email_not_confirmed';
      return;
    }
    f.reset();
    showToast(`Signed in as ${this.account.tag ?? email}`);
    this.navigate('menu');
  }

  private async submitSignUp(): Promise<void> {
    const f = this.signupForm;
    const email = this.value(f, 'email');
    const password = this.input(f, 'password').value;
    const confirm = this.input(f, 'confirm').value;
    const nickname = this.value(f, 'nickname');
    const problem =
      emailError(email) ??
      passwordError(password) ??
      (password !== confirm ? 'Passwords do not match.' : null) ??
      nicknameError(nickname);
    if (problem) return this.setError(f, problem);

    const res = await this.busy(f, () => this.account.signUp(email, password, nickname, this.captchas.signup.token()));
    this.captchas.signup.reset();
    if (!res.ok) return this.setError(f, res.message);
    f.reset();
    this.pendingEmail = email;
    this.cooldownUntil = Date.now() + RESEND_COOLDOWN_S * 1000;
    this.openVerify();
  }

  private async resend(): Promise<void> {
    const host = $('verify-screen');
    if (emailError(this.pendingEmail)) {
      this.setError(host, 'Go back and enter the email address you signed up with.');
      return;
    }
    const btn = $<HTMLButtonElement>('verify-resend');
    btn.disabled = true;
    const res = await this.account.resendVerification(this.pendingEmail, this.captchas.verify.token());
    this.captchas.verify.reset();
    if (!res.ok) {
      this.setError(host, res.message);
    } else {
      this.setError(host, '');
      showToast(`Verification email sent to ${this.pendingEmail}`);
      this.cooldownUntil = Date.now() + RESEND_COOLDOWN_S * 1000;
    }
    this.updateResend(this.captchas.verify.ready);
  }

  /** Resend button: wait for the CAPTCHA and a cooldown so players can't spam emails */
  private updateResend(captchaReady: boolean): void {
    const btn = $<HTMLButtonElement>('verify-resend');
    const left = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
    btn.disabled = left > 0 || !captchaReady;
    btn.textContent = left > 0 ? `Resend email (${left}s)` : 'Resend email';
    if (left > 0) setTimeout(() => this.updateResend(this.captchas.verify.ready), 1000);
  }

  // ───────────────────────── Badges ─────────────────────────

  private renderBadges(): void {
    const tag = this.account.tag;
    const bar = $('account-bar');
    const top = $('topbar-account');
    if (tag) {
      const playTime = `Play time ${formatPlayTime(this.account.profile?.total_play_seconds ?? 0)}`;
      const name = document.createElement('span');
      name.className = 'account-tag';
      const tagText = document.createElement('strong');
      tagText.textContent = tag;
      const time = document.createElement('small');
      time.className = 'account-time';
      time.textContent = playTime;
      name.append(tagText, time);
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'link-btn';
      out.textContent = 'Sign Out';
      out.addEventListener('click', async () => {
        await this.account.signOut();
        showToast('Signed out');
      });
      bar.replaceChildren(name, out);
      top.textContent = tag;
      top.title = playTime;
    } else {
      const signIn = document.createElement('button');
      signIn.type = 'button';
      signIn.className = 'pill-btn';
      signIn.textContent = 'Sign In';
      signIn.addEventListener('click', () => this.open('signin'));
      const join = document.createElement('button');
      join.type = 'button';
      join.className = 'pill-btn ghost';
      join.textContent = 'Create Account';
      join.addEventListener('click', () => this.open('signup'));
      bar.replaceChildren(signIn, join);
      top.textContent = '';
      top.title = '';
    }
  }

  // ───────────────────────── Form helpers ─────────────────────────

  private input(form: HTMLFormElement, name: string): HTMLInputElement {
    return form.elements.namedItem(name) as HTMLInputElement;
  }

  private value(form: HTMLFormElement, name: string): string {
    return this.input(form, name).value.trim();
  }

  private submitButton(form: HTMLFormElement): HTMLButtonElement {
    return form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  }

  private setError(host: HTMLElement, text: string): void {
    const el = host.querySelector<HTMLElement>('.form-error');
    if (el) el.textContent = text;
  }

  private async busy(form: HTMLFormElement, fn: () => Promise<AuthResult>): Promise<AuthResult> {
    const btn = this.submitButton(form);
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Please wait…';
    form.setAttribute('aria-busy', 'true');
    try {
      return await fn();
    } finally {
      btn.textContent = label;
      btn.disabled = !(form === this.signinForm ? this.captchas.signin : this.captchas.signup).ready;
      form.removeAttribute('aria-busy');
    }
  }
}
