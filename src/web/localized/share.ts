import { createShareApi } from '../../core/share';
import { t } from '../i18n';
export * from '../../core/share';
export const { MAX_SHARE_BYTES, readBoundedStream, encodeMap, decodeMap, encodePack, decodePack } = createShareApi(t);
