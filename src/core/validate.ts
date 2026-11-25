/** Compatibility entry point for localized map validation and defaults. */
import { createValidateApi } from './schema/map';

export { createValidateApi };
export { MapValidationError } from './schema/validation';

export const { LIMITS, validateMap, validatePack, mapErrors, mapWarnings, createEmptyMap, DEFAULT_MOTION, DEFAULT_BOULDER_WAVE, DEFAULT_FALL, DEFAULT_PULLEY, DEFAULT_ICE_GRIP, DEFAULT_BLINK, DEFAULT_GUN, DEFAULT_MISSILE, DEFAULT_TORCH_LIGHT, DEFAULT_SECRET_RADIUS, DEFAULT_SPOT, defaultRotation } = createValidateApi();
