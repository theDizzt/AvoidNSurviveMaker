import { FONT_CATALOG, libraryFont, type CatalogFont } from './localized/font-catalog';
import { FONT_MAIN } from './render';

/** URLs of the bundled font files, by folder/file name */
const FILES = import.meta.glob('../assets/fonts/*/*.{ttf,otf}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function catalogFontUrl(f: CatalogFont): string | undefined {
  return FILES[`../assets/fonts/${f.folder}/${f.file}`];
}

const requested = new Set<string>();

/** CSS family name of a library font (registered on first use) */
export function libraryFamily(id: string): string {
  return `anf-${id}`;
}

/** Load a library font so text using it renders (canvas redraws pick it up once loaded) */
export function ensureLibraryFont(id: string): Promise<void> {
  const f = libraryFont(id) ?? FONT_CATALOG.find((c) => c.id === id);
  const url = f && catalogFontUrl(f);
  if (!f || !url || requested.has(id)) return Promise.resolve();
  requested.add(id);
  const face = new FontFace(libraryFamily(id), `url("${url}")`);
  return face.load().then((ff) => {
    document.fonts.add(ff);
  }).catch(() => {
    requested.delete(id);
  });
}

/** CSS font-family list for a library font, falling back to the main UI font */
export function libraryFontCss(id: string): string {
  void ensureLibraryFont(id);
  return `'${libraryFamily(id)}', ${FONT_MAIN}`;
}
