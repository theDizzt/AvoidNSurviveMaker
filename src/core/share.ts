import type { MapData, MapPack } from './types';
import { validateMap, validatePack } from './validate';

export const MAX_SHARE_BYTES = 20_000_000;
const MAX_SHARE_CODE = 1 + 4 * Math.ceil(MAX_SHARE_BYTES / 3);

/** Stop consuming as soon as the decoded stream crosses the budget. */
export async function readBoundedStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Data is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Map <-> URL share code.
 *   'z' + base64url(deflate-raw(JSON))   (when CompressionStream is available)
 *   'j' + base64url(JSON)                (fallback for browsers without it)
 * Phase 1 sharing: exchange maps through a link alone, no server.
 */

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

async function encodeJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream !== 'undefined') {
    return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }
  return 'j' + toBase64Url(bytes);
}

async function decodeJson(code: string): Promise<unknown> {
  if (code.length > MAX_SHARE_CODE) throw new Error('Data is too large');
  const kind = code[0];
  if (kind !== 'z' && kind !== 'j') throw new Error('Unknown share code format');
  let bytes = fromBase64Url(code.slice(1));
  if (bytes.length > MAX_SHARE_BYTES) throw new Error('Data is too large');
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser does not support decompression');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = await readBoundedStream(stream, MAX_SHARE_BYTES);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function encodeMap(map: MapData): Promise<string> {
  return encodeJson(map);
}

/** Decode a share code and return the validated map. Throws on failure. */
export async function decodeMap(code: string): Promise<MapData> {
  return validateMap(await decodeJson(code));
}

/** Map packs use the same code format (shared as `#p=` links) */
export function encodePack(pack: MapPack): Promise<string> {
  return encodeJson(pack);
}

export async function decodePack(code: string): Promise<MapPack> {
  return validatePack(await decodeJson(code));
}
