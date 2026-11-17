import { Unzip, UnzipInflate } from 'fflate';

export const ZIP_LIMITS = {
  compressed: 30 * 1024 * 1024,
  file: 30 * 1024 * 1024,
  total: 60 * 1024 * 1024,
  files: 2048,
};

/** Stream small input chunks; never allocate from untrusted ZIP size headers. */
export function unpackBoundedZip(bytes: Uint8Array, limits = ZIP_LIMITS): Record<string, Uint8Array> {
  if (bytes.length > limits.compressed) throw new Error('The zip file is too large');
  const files: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>();
  let total = 0;
  let pending = 0;
  const unzip = new Unzip((file) => {
    if (names.size >= limits.files) throw new Error('Too many files in the zip');
    if (!file.name || file.name.length > 240 || file.name.startsWith('/') || /[\\:\x00-\x1f]/.test(file.name)
      || file.name.split('/').some((part) => part === '..' || part === '.' || part === '__proto__')
      || names.has(file.name)) throw new Error('Invalid or duplicate zip path');
    names.add(file.name);
    if (file.originalSize !== undefined && file.originalSize > limits.file) throw new Error('Zip entry is too large');
    pending++;
    let size = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      total += data.length;
      if (size > limits.file || total > limits.total) throw new Error('Expanded zip is too large');
      chunks.push(data);
      if (final) {
        const out = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
        files[file.name] = out;
        pending--;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // A DEFLATE chunk can expand ~1032x: keep transient output bounded too.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  if (pending || !names.size) throw new Error('Incomplete or empty zip');
  return files;
}
