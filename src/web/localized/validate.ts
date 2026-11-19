import { createValidateApi } from '../../core/validate';
import { t } from '../i18n';
export * from '../../core/validate';
export const { LIMITS, validateMap, validatePack, mapErrors, mapWarnings, createEmptyMap, DEFAULT_MOTION, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS, defaultRotation } = createValidateApi(t);
