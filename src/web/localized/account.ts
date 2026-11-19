import { createAccountApi } from '../../core/account';
import { t } from '../i18n';
export * from '../../core/account';
export const { NICKNAME_MAX_BYTES, DISCRIMINATOR_MAX, PASSWORD_MIN, PASSWORD_MAX_BYTES, byteLength, formatTag, nicknameError, emailError, passwordError, formatPlayTime } = createAccountApi(t);
