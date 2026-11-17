import { FONT_CATALOG, LICENSE_LABELS, type CatalogFont, type FontLicense } from '../core/font-catalog';
import oflText from '../assets/fonts/OFL.txt?raw';
import { ensureLibraryFont, libraryFontCss } from './library-fonts';

const ORDER: FontLicense[] = ['ofl', 'check', 'personal', 'commercial'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function row(f: CatalogFont): HTMLElement {
  const li = el('li', 'lic-row');
  const sample = el('span', 'lic-sample', f.script === 'korean' ? '가나 Aa 01' : f.script === 'japanese' ? 'あア Aa 01' : 'Aa Bb 01');
  sample.style.fontFamily = f.group === 'ui' ? '' : libraryFontCss(f.id);
  if (f.group === 'ui') void ensureLibraryFont(f.id).then(() => (sample.style.fontFamily = `'anf-${f.id}'`));
  const body = el('div', 'lic-body');
  const head = el('div', 'lic-head');
  head.append(el('strong', '', f.name), el('span', `lic-tag lic-${f.license}`, LICENSE_LABELS[f.license]));
  body.append(head, el('small', 'lic-copy', f.copyright));
  const meta: string[] = [];
  if (f.designer) meta.push(`Design: ${f.designer}`);
  meta.push(f.group === 'ui' ? 'Used by the game interface' : `Theme font id: ${f.id}`);
  body.append(el('small', 'muted', meta.join(' · ')));
  if (f.licenseNote) body.append(el('small', 'lic-note', f.licenseNote));
  if (f.url) {
    const a = el('a', 'lic-link', f.url);
    a.href = f.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    body.append(a);
  }
  li.append(sample, body);
  return li;
}

/** The font credits list: every bundled font with its copyright and license */
export function renderFontLicenses(host: HTMLElement): void {
  const parts: HTMLElement[] = [];
  const groups: [string, CatalogFont[]][] = [
    ['Interface fonts', FONT_CATALOG.filter((f) => f.group === 'ui')],
    ['Library fonts (themes and level badges)', [...FONT_CATALOG.filter((f) => f.group === 'library')]
      .sort((a, b) => ORDER.indexOf(a.license) - ORDER.indexOf(b.license) || a.name.localeCompare(b.name))],
  ];
  for (const [title, fonts] of groups) {
    parts.push(el('h3', 'lic-group', title));
    const ul = el('ul', 'lic-list');
    ul.append(...fonts.map(row));
    parts.push(ul);
  }
  const details = el('details', 'lic-ofl-text');
  details.append(el('summary', '', 'SIL Open Font License 1.1 (full text)'), el('pre', '', oflText));
  parts.push(details);
  host.replaceChildren(...parts);
}
