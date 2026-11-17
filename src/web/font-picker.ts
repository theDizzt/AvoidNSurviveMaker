import { LIBRARY_FONTS, type CatalogFont } from '../core/font-catalog';
import { ensureLibraryFont, libraryFontCss } from './library-fonts';

const SCRIPTS: [CatalogFont['script'], string][] = [['latin', 'Latin'], ['korean', 'Korean'], ['japanese', 'Japanese']];

/**
 * Add the bundled library fonts to a font <select> (its own options become "Basic"). Fonts that
 * aren't under the Open Font License are marked, since their terms limit public releases.
 */
export function fontPicker(s: HTMLSelectElement, value: string): HTMLSelectElement {
  const basic = document.createElement('optgroup');
  basic.label = 'Basic';
  basic.append(...s.querySelectorAll('option'));
  s.append(basic);
  for (const [script, label] of SCRIPTS) {
    const g = document.createElement('optgroup');
    g.label = `Library · ${label}`;
    for (const f of LIBRARY_FONTS.filter((x) => x.script === script)) {
      const mark = f.license === 'ofl' ? '' : f.license === 'check' ? ' ⓘ' : ' ⚠';
      const o = new Option(`${f.name}${mark}`, f.id, false, f.id === value);
      o.style.fontFamily = libraryFontCss(f.id);
      o.title = f.license === 'ofl' ? 'SIL Open Font License' : f.license === 'personal' ? 'Personal use only' : f.license === 'commercial' ? 'Commercial font: needs a paid license' : 'License not stated in the font file';
      g.append(o);
    }
    s.append(g);
  }
  s.value = value;
  s.title = 'Fonts marked ⓘ do not state their license in the file: see Options → Font licenses';
  const preview = () => {
    const f = LIBRARY_FONTS.find((x) => x.id === s.value);
    s.style.fontFamily = f ? libraryFontCss(f.id) : '';
  };
  preview();
  s.addEventListener('change', preview);
  s.addEventListener('focus', () => LIBRARY_FONTS.forEach((f) => void ensureLibraryFont(f.id)), { once: true });
  return s;
}
