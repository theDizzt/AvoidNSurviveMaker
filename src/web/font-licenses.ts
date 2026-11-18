import { t } from '../core/i18n';
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
  const sample = el('span', 'lic-sample', f.script === 'korean' ? '가나 Aa 01' : f.script === 'japanese' ? 'あア Aa 01' : f.script === 'chinese' ? '中文 Aa 01' : 'Aa Bb 01');
  sample.style.fontFamily = f.group === 'ui' ? '' : libraryFontCss(f.id);
  if (f.group === 'ui') void ensureLibraryFont(f.id).then(() => (sample.style.fontFamily = `'anf-${f.id}'`));
  const body = el('div', 'lic-body');
  const head = el('div', 'lic-head');
  head.append(el('strong', '', f.name), el('span', `lic-tag lic-${f.license}`, LICENSE_LABELS[f.license]));
  body.append(head, el('small', 'lic-copy', f.copyright));
  const meta: string[] = [];
  if (f.designer) meta.push(t('licenses.design', { name: f.designer }));
  meta.push(f.group === 'ui' ? t('licenses.uiFont') : t('licenses.fontId', { id: f.id }));
  body.append(el('small', 'muted', meta.join(' · ')));
  if (f.licenseNote) body.append(el('small', 'lic-note', f.licenseNote));
  if (f.url) body.append(link(f.url, f.url));
  li.append(sample, body);
  return li;
}

/** Bundled music: every track is by Or4nges under CC BY-NC-SA 3.0 */
const MUSIC: { title: string; use: string; url: string; note: string }[] = [
  { title: '- Platform', use: t('menu.mainMenu'), url: 'https://www.newgrounds.com/audio/listen/458694', note: t('licenses.noteTrimmed') },
  { title: '- Have a Cookie', use: t('common.chapterN', { n: 1 }), url: 'https://www.newgrounds.com/audio/listen/414834', note: t('licenses.noteOriginal') },
  { title: '- For Science!', use: t('common.chapterN', { n: 7 }), url: 'https://www.newgrounds.com/audio/listen/447794', note: t('licenses.noteOriginal') },
];
const MUSIC_ARTIST = { name: 'Or4nges', url: 'https://or4nges.newgrounds.com/' };
const MUSIC_LICENSE = { name: 'CC BY-NC-SA 3.0', url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/' };

function link(text: string, href: string, cls = 'lic-link'): HTMLAnchorElement {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function musicRow(m: (typeof MUSIC)[number]): HTMLElement {
  const li = el('li', 'lic-row');
  const body = el('div', 'lic-body');
  const head = el('div', 'lic-head');
  head.append(el('strong', '', m.title), link(MUSIC_LICENSE.name, MUSIC_LICENSE.url, 'lic-tag lic-cc'));
  const by = el('small', 'lic-copy', t('licenses.by'));
  by.append(link(MUSIC_ARTIST.name, MUSIC_ARTIST.url, ''));
  body.append(head, by, el('small', 'muted', `${m.use} · ${m.note}`), link(m.url, m.url));
  li.append(el('span', 'lic-sample lic-music', '♪'), body);
  return li;
}

/** The credits list: bundled music, then every bundled font with its copyright and license */
export function renderFontLicenses(host: HTMLElement): void {
  const parts: HTMLElement[] = [el('h3', 'lic-group', t('common.music'))];
  const music = el('ul', 'lic-list');
  music.append(...MUSIC.map(musicRow));
  parts.push(music);
  const groups: [string, CatalogFont[]][] = [
    [t('licenses.uiFonts'), FONT_CATALOG.filter((f) => f.group === 'ui')],
    [t('licenses.libraryFonts'), [...FONT_CATALOG.filter((f) => f.group === 'library')]
      .sort((a, b) => ORDER.indexOf(a.license) - ORDER.indexOf(b.license) || a.name.localeCompare(b.name))],
  ];
  for (const [title, fonts] of groups) {
    parts.push(el('h3', 'lic-group', title));
    const ul = el('ul', 'lic-list');
    ul.append(...fonts.map(row));
    parts.push(ul);
  }
  const details = el('details', 'lic-ofl-text');
  details.append(el('summary', '', t('licenses.oflFull')), el('pre', '', oflText));
  parts.push(details);
  host.replaceChildren(...parts);
}
