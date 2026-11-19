import { createThemeApi } from '../../core/theme';
import { t } from '../i18n';
export * from '../../core/theme';
export const { BASE_THEME, THEME_PRESETS, primaryColor, secondaryColor, shade } = createThemeApi(t);
