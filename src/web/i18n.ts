import { createTranslator, DEFAULT_LANGUAGE, LANGUAGES, type Language } from '../core/i18n';
export { DEFAULT_LANGUAGE, LANGUAGES, type Language, type MessageKey, type Translator } from '../core/i18n';

const STORAGE_KEY = 'avoid-n-survive:language';
function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.some(l => l.id === value)) return value as Language;
  } catch { /* unavailable in workers or blocked storage */ }
  return DEFAULT_LANGUAGE;
}

/** Browser preference is captured once; changing it still reloads startup labels. */
export const language = storedLanguage();
export const t = createTranslator(language);

export function saveLanguage(id: Language): boolean {
  try { localStorage.setItem(STORAGE_KEY, id); return true; }
  catch { return false; }
}
