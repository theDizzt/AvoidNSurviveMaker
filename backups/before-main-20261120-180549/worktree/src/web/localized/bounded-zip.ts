import { createBoundedZipApi } from '../../core/bounded-zip';
import { t } from '../i18n';
export * from '../../core/bounded-zip';
export const { ZIP_LIMITS, unpackBoundedZip } = createBoundedZipApi(t);
