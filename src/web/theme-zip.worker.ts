import { unpackBoundedZip } from '../core/bounded-zip';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const files = unpackBoundedZip(new Uint8Array(event.data));
    self.postMessage({ files }, { transfer: Object.values(files).map((file) => file.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Invalid zip' });
  }
};
