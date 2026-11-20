import { createLevelApi } from '../../core/level';
import { t } from '../i18n';
export * from '../../core/level';
export const { starsFor, starText, chapterLevelCode, levelLabel, starGoals, gameplayKey } = createLevelApi(t);
