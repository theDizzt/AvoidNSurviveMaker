import { createFontCatalogApi } from '../../core/font-catalog';
import { t } from '../i18n';
export * from '../../core/font-catalog';
export const { LICENSE_LABELS, FONT_CATALOG, LIBRARY_FONTS, isLibraryFont, libraryFont } = createFontCatalogApi(t);
