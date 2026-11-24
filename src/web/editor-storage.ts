import type { EditorDraft } from '../core/editor-document';
import { validateMap } from './localized/validate';

const STORAGE_KEY = 'avoid-n-survive:editor';
const PREFERENCES = {
  gridTop: 'avoid-n-survive:editor-grid-top',
  center: 'avoid-n-survive:editor-center-lines',
  symmetry: 'avoid-n-survive:editor-symmetry',
  starTier: 'avoid-n-survive:editor-star-tier',
} as const;
export function loadEditorPreference(key: keyof typeof PREFERENCES): string | null {
  try { return localStorage.getItem(PREFERENCES[key]); } catch { return null; }
}
export function saveEditorPreference(key: keyof typeof PREFERENCES, value: string): void {
  try { localStorage.setItem(PREFERENCES[key], value); } catch { /* session-only preference */ }
}
/** Browser adapter; the document model never reads or writes storage. */
export function saveEditorDraft(draft: EditorDraft): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); return true; }
  catch { return false; }
}
export function loadEditorDraft(): EditorDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { map: validateMap(data.map), verifiedJson: typeof data.verifiedJson === 'string' ? data.verifiedJson : null };
  } catch { return null; }
}
