import { t } from './i18n';
import { LIBRARY_FONTS, type CatalogFont } from './localized/font-catalog';
import { ensureLibraryFont, libraryFontCss } from './library-fonts';

const SCRIPTS: [CatalogFont['script'], string][] = [['latin', t('fontPicker.latin')], ['korean', t('fontPicker.korean')], ['japanese', t('fontPicker.japanese')], ['chinese', t('fontPicker.chinese')]];

/**
 * Add the bundled library fonts to a font <select> (its own options become "Basic"). Fonts that
 * aren't under the Open Font License are marked, since their terms limit public releases.
 */
export function fontPicker(s: HTMLSelectElement, value: string): HTMLSelectElement {
  const basic = document.createElement('optgroup');
  basic.label = t('fontPicker.basic');
  basic.append(...s.querySelectorAll('option'));
  s.append(basic);
  for (const [script, label] of SCRIPTS) {
    const g = document.createElement('optgroup');
    g.label = t('fontPicker.library', { script: label });
    for (const f of LIBRARY_FONTS.filter((x) => x.script === script)) {
      const mark = f.license === 'ofl' ? '' : f.license === 'check' ? ' ⓘ' : ' (!)';
      const o = new Option(`${f.name}${mark}`, f.id, false, f.id === value);
      o.style.fontFamily = libraryFontCss(f.id);
      o.title = t(f.license === 'ofl' ? 'fontPicker.ofl' : f.license === 'personal' ? 'fontPicker.personal' : f.license === 'commercial' ? 'fontPicker.commercial' : 'fontLicense.check');
      g.append(o);
    }
    s.append(g);
  }
  s.value = value;
  s.title = t('fontPicker.hint');
  const preview = () => {
    const f = LIBRARY_FONTS.find((x) => x.id === s.value);
    s.style.fontFamily = f ? libraryFontCss(f.id) : '';
  };
  preview();
  s.addEventListener('change', preview);
  s.addEventListener('focus', () => LIBRARY_FONTS.forEach((f) => void ensureLibraryFont(f.id)), { once: true });
  return s;
}
