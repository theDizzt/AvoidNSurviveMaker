import { t } from '../../core/i18n';
/**
 * Cloudflare Turnstile CAPTCHA. Supabase Auth verifies the token server-side
 * (Dashboard → Authentication → Attack Protection), so the client only renders the widget
 * and passes the token along with sign-up / sign-in requests.
 */

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(t('captcha.startFailed'))));
    s.onerror = () => {
      loading = null;
      reject(new Error(t('captcha.loadFailed')));
    };
    document.head.append(s);
  });
  return loading;
}

export class Captcha {
  private widget: string | null = null;
  private current: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly siteKey: string,
    private readonly onState: (ready: boolean) => void = () => {},
  ) {}

  /** No site key configured → no widget, requests go out without a token */
  get enabled(): boolean {
    return this.siteKey.length > 0;
  }

  async mount(): Promise<void> {
    if (!this.enabled || this.widget) return;
    const api = await loadTurnstile();
    this.widget = api.render(this.container, {
      sitekey: this.siteKey,
      theme: 'dark',
      callback: (token: string) => {
        this.current = token;
        this.onState(true);
      },
      'expired-callback': () => this.clear(),
      'error-callback': () => this.clear(),
    });
  }

  /** Token for the next request, or undefined when CAPTCHA is disabled */
  token(): string | undefined {
    return this.current ?? undefined;
  }

  get ready(): boolean {
    return !this.enabled || this.current !== null;
  }

  /** Tokens are single-use: get a fresh one after every submit */
  reset(): void {
    this.clear();
    if (this.widget) window.turnstile?.reset(this.widget);
  }

  private clear(): void {
    this.current = null;
    this.onState(false);
  }
}
