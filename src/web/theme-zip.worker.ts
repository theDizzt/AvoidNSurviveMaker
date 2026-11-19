import { createTranslator, type Language } from '../core/i18n';
import { createBoundedZipApi } from '../core/bounded-zip';

self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer; language: Language }>) => {
  const t = createTranslator(event.data.language);
  try {
    const files = createBoundedZipApi(t).unpackBoundedZip(new Uint8Array(event.data.bytes));
    self.postMessage({ files }, { transfer: Object.values(files).map((file) => file.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : t('zip.invalid') });
  }
};
