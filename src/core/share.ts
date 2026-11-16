import type { MapData } from './types';
import { validateMap } from './validate';

/**
 * 맵 ↔ URL 공유 코드.
 *   'z' + base64url(deflate-raw(JSON))   (CompressionStream 지원 시)
 *   'j' + base64url(JSON)                (미지원 브라우저 대체)
 * 서버 없이 링크만으로 맵을 주고받기 위한 1단계 공유 방식.
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

export async function encodeMap(map: MapData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(map));
  if (typeof CompressionStream !== 'undefined') {
    return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }
  return 'j' + toBase64Url(bytes);
}

/** 공유 코드를 해석하고 검증까지 마친 맵을 돌려준다. 실패하면 예외. */
export async function decodeMap(code: string): Promise<MapData> {
  const kind = code[0];
  let bytes = fromBase64Url(code.slice(1));
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind !== 'j') {
    throw new Error('알 수 없는 공유 코드 형식입니다');
  }
  if (bytes.length > 2_000_000) throw new Error('맵 데이터가 너무 큽니다');
  return validateMap(JSON.parse(new TextDecoder().decode(bytes)));
}
