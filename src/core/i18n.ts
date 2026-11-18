import en from '../locale/en.json';
import ko from '../locale/ko.json';
import zh from '../locale/zh.json';

/**
 * Every player-facing string lives in src/locale/<lang>.json (flat "area.name" keys). Text can
 * carry {placeholders}, filled from the vars passed to t(). en.json is the reference: a key
 * missing from another language falls back to English.
 *
 * The language is picked once, when this module loads (many strings are built into constants at
 * startup), so changing it saves the choice and reloads the page.
 */
export type MessageKey = keyof typeof en;
export type MessageVars = Record<string, string | number>;

/** Languages offered in Options; the label is shown in its own language */
export const LANGUAGES = [
  { id: 'en', label: 'English', messages: en as Record<string, string> },
  { id: 'ko', label: '한국어', messages: ko as Record<string, string> },
  // Simplified Chinese: still the English text, waiting for a translation
  { id: 'zh', label: '中文', messages: zh as Record<string, string> },
] as const;
export type Language = (typeof LANGUAGES)[number]['id'];

export const DEFAULT_LANGUAGE: Language = 'en';
const STORAGE_KEY = 'avoid-n-survive:language';

function storedLanguage(): Language {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (LANGUAGES.some((l) => l.id === v)) return v as Language;
  } catch {
    // Storage blocked (private mode, tests): use the default
  }
  return DEFAULT_LANGUAGE;
}

export const language: Language = storedLanguage();
const messages: Record<string, string> = LANGUAGES.find((l) => l.id === language)!.messages;
const fallback: Record<string, string> = en;

export function t(key: MessageKey, vars?: MessageVars): string {
  const s = messages[key] ?? fallback[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Save the language for the next page load; returns false when it could not be stored */
export function saveLanguage(id: Language): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
