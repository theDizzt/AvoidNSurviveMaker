import { createThemePackApi } from '../../core/theme-pack';
import { t } from '../i18n';
export * from '../../core/theme-pack';
export const { THEME_FORMAT, LEVELS_PER_THEME, MAX_PACK_LEVELS, STARS_PER_LEVEL, CRYSTALS_PER_THEME, STARS_PER_THEME, MIN_DIFFICULTY, MAX_DIFFICULTY, DEFAULT_BADGE, blankThemeInfo, validateThemeInfo, localizeThemeInfo, averageDifficulty, levelSlots, crystalSlots, maxStars, assignSlots, levelAt, filledSlots, themedLevel } = createThemePackApi(t);
