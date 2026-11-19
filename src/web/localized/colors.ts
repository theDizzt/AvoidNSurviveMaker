import { createColorsApi } from '../../core/colors';
import { t } from '../i18n';
export * from '../../core/colors';
export const { SWITCH_COLORS, switchColor } = createColorsApi(t);
