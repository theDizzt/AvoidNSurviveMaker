import { language, t, type MessageKey } from './i18n';

/** data-i18n-* attribute → the element attribute it fills */
const ATTRS: [string, string][] = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
];

/**
 * Fill the static page text from the locale: data-i18n sets an element's text, and
 * data-i18n-title / -aria-label / -placeholder set those attributes.
 */
export function applyI18n(root: ParentNode = document): void {
  if (root === document) document.documentElement.lang = language;
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const [data, attr] of ATTRS) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${data}]`)) {
      el.setAttribute(attr, t(el.getAttribute(data) as MessageKey));
    }
  }
}
