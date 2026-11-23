import en from '../locale/en';
import ko from '../locale/ko';
import zh from '../locale/zh';

/**
 * Every player-facing string lives in src/locale/<lang>/<area>.json (flat "area.name" keys). Text can
 * carry {placeholders}, filled from the vars passed to t(). English (src/locale/en) is the reference: a key
 * missing from another language falls back to English.
 *
 * Translation is explicit and independent of browser storage or mutable global locale state.
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
const fallback: Record<string, string> = en;

export function translate(language: Language, key: MessageKey, vars?: MessageVars): string {
  const messages: Record<string, string> = LANGUAGES.find((l) => l.id === language)?.messages ?? fallback;
  const s = messages[key] ?? fallback[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export type Translator = (key: MessageKey, vars?: MessageVars) => string;

export function createTranslator(language: Language): Translator {
  return (key, vars) => translate(language, key, vars);
}

/** Deterministic default for server and headless callers. */
export const t: Translator = createTranslator(DEFAULT_LANGUAGE);
