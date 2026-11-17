import type { MapData, MapPack } from './types';
import { validateMap, validatePack } from './validate';

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
  const kind = code[0];
  let bytes = fromBase64Url(code.slice(1));
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser does not support decompression');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'j') {
    throw new Error('Unknown share code format');
  }
  if (bytes.length > 20_000_000) throw new Error('Data is too large');
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
