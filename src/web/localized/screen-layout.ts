import { createScreenLayoutApi } from '../../core/screen-layout';
import { t } from '../i18n';
export * from '../../core/screen-layout';
export const { STAGE_W, STAGE_H, BUILTIN_FONTS, SCREEN_PLACEHOLDERS, difficultyLabel, DEFAULT_BUTTON, readLayout, readScreens, readFonts } = createScreenLayoutApi(t);
