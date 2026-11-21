import { t } from './i18n';
import { readDevice, recommendOptions } from './device-profile';
import { applyOptions } from './options';

const STORAGE_KEY = 'avoid-n-survive:device-check';
type Decision = 'granted' | 'denied';

function savedDecision(): Decision | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

function saveDecision(v: Decision): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* storage unavailable: asked again next time */
  }
}

/** Check the device and set Graphics options to match. Returns the chosen quality level. */
export function applyDeviceOptions(): string {
  const patch = recommendOptions(readDevice());
  applyOptions(patch);
  return t(`options.graphics.${patch.graphics ?? 'high'}`);
}

/** Ask whether the device may be checked; resolves true when the player agrees. */
export function askDeviceConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'consent-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'consent-title');

    const card = document.createElement('div');
    card.className = 'consent-card';
    const title = document.createElement('h3');
    title.id = 'consent-title';
    title.textContent = t('device.title');
    const body = document.createElement('p');
    body.textContent = t('device.body');
    const list = document.createElement('p');
    list.className = 'consent-list';
    list.textContent = t('device.items');
    const note = document.createElement('p');
    note.className = 'consent-note';
    note.textContent = t('device.privacy');

    const buttons = document.createElement('div');
    buttons.className = 'consent-buttons';
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.className = 'consent-deny';
    deny.textContent = t('device.deny');
    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = 'consent-allow';
    allow.textContent = t('device.allow');
    buttons.append(deny, allow);
    card.append(title, body, list, note, buttons);
    overlay.append(card);

    const done = (ok: boolean) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(ok);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      done(false);
    };
    deny.addEventListener('click', () => done(false));
    allow.addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    allow.focus();
  });
}

/**
 * First launch: ask once, and on yes set the options for this device. The answer is remembered;
 * the Graphics screen's Auto Setup tile runs the check again later.
 */
export async function firstRunDeviceCheck(): Promise<string | null> {
  if (savedDecision()) return null;
  const ok = await askDeviceConsent();
  saveDecision(ok ? 'granted' : 'denied');
  return ok ? applyDeviceOptions() : null;
}

/** Auto Setup tile: ask first unless the player already agreed */
export async function deviceCheckOnRequest(): Promise<string | null> {
  if (savedDecision() !== 'granted') {
    if (!(await askDeviceConsent())) return null;
    saveDecision('granted');
  }
  return applyDeviceOptions();
}
