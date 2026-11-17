import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8, zipSync } from 'fflate';
import { unpackBoundedZip, ZIP_LIMITS } from './bounded-zip';
import { decodeMap, encodeMap, MAX_SHARE_BYTES, readBoundedStream } from './share';
import { createEmptyMap } from './validate';

describe('untrusted compressed input', () => {
  it('round-trips normal shared maps', async () => {
    const map = createEmptyMap();
    expect(await decodeMap(await encodeMap(map))).toEqual(map);
  });

  it('cancels the source immediately when streamed output exceeds its budget', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(8)); },
      cancel() { cancelled = true; },
    });
    await expect(readBoundedStream(stream, 10)).rejects.toThrow('too large');
    expect(cancelled).toBe(true);
  });

  it('rejects a compressed share bomb before parsing JSON', async () => {
    const compressed = deflateSync(new Uint8Array(MAX_SHARE_BYTES + 1));
    const code = 'z' + btoa(String.fromCharCode(...compressed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expect(decodeMap(code)).rejects.toThrow('too large');
  });

  it('rejects oversized encoded input before base64 decoding', async () => {
    await expect(decodeMap('j' + '!'.repeat(4 * Math.ceil(MAX_SHARE_BYTES / 3) + 1))).rejects.toThrow('too large');
  });

  it('extracts stored and deflated files, including nested folders', () => {
    const files = { 'theme.json': strToU8('{"format":1}'), 'levels/01.json': new Uint8Array(4000) };
    for (const level of [0, 6] as const) {
      const out = unpackBoundedZip(zipSync(files, { level }));
      expect(out['theme.json']).toEqual(files['theme.json']);
      expect(out['levels/01.json']).toEqual(files['levels/01.json']);
    }
  });

  it('limits count, per-file size, and aggregate decoded size', () => {
    const zip = zipSync({ a: new Uint8Array(20), b: new Uint8Array(20) });
    expect(() => unpackBoundedZip(zip, { ...ZIP_LIMITS, files: 1 })).toThrow('Too many');
    expect(() => unpackBoundedZip(zip, { ...ZIP_LIMITS, file: 10 })).toThrow('too large');
    expect(() => unpackBoundedZip(zip, { ...ZIP_LIMITS, total: 30 })).toThrow('too large');
  });

  it('counts actual output even when a ZIP size header lies', () => {
    const zip = zipSync({ bomb: new Uint8Array(100_000) });
    // Falsify local uncompressed size; streaming inflate must still count actual bytes.
    new DataView(zip.buffer).setUint32(22, 1, true);
    expect(() => unpackBoundedZip(zip, { ...ZIP_LIMITS, file: 1024 })).toThrow('too large');
  });

  it('rejects unsafe paths and truncated file payloads', () => {
    expect(() => unpackBoundedZip(zipSync({ '../theme.json': strToU8('{}') }))).toThrow('path');
    const zip = zipSync({ a: new Uint8Array(2000) }, { level: 0 });
    expect(() => unpackBoundedZip(zip.subarray(0, 100))).toThrow();
  });
});
