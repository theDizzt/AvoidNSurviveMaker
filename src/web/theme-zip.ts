import { strFromU8, strToU8, zipSync } from 'fflate';
import { unpackBoundedZip, ZIP_LIMITS } from '../core/bounded-zip';
import { MAX_PACK_LEVELS, validateThemeInfo } from '../core/theme-pack';
import type { MapData } from '../core/types';
import { validateMap } from '../core/validate';
import type { StoredTheme } from './theme-registry';

/**
 * Theme pack zip files: theme.json, images, and levels/NN.json — the same layout as a folder in
 * the repo's themes/ and custom-themes/ packs. Official chapters are registered separately.
 */

const FILE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
};
async function unpack(bytes: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  // Node tests have no browser Worker. They use the same bounded decoder.
  if (typeof Worker === 'undefined') return unpackBoundedZip(new Uint8Array(bytes));
  const worker = new Worker(new URL('./theme-zip.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Zip extraction timed out')), 15_000);
      worker.onmessage = (event: MessageEvent<{ files: Record<string, Uint8Array>; error?: string }>) => {
        clearTimeout(timer);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.files);
      };
      worker.onerror = () => { clearTimeout(timer); reject(new Error('Could not extract zip')); };
      worker.postMessage(bytes, [bytes]);
    });
  } finally {
    worker.terminate();
  }
}

function toDataUrl(bytes: Uint8Array, type: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read a theme pack zip (theme.json may sit at the root or inside one top folder) */
export async function readThemeZip(file: File): Promise<StoredTheme> {
  if (file.size > ZIP_LIMITS.compressed) throw new Error('The zip file is too large (30 MB max)');
  const files = await unpack(await file.arrayBuffer());
  const infoPath = Object.keys(files).filter((p) => /(^|\/)theme\.json$/.test(p)).sort((a, b) => a.length - b.length)[0];
  if (!infoPath) throw new Error('No theme.json in the zip');
  const root = infoPath.slice(0, -'theme.json'.length);
  const info = validateThemeInfo(JSON.parse(strFromU8(files[infoPath])));

  const levels: MapData[] = [];
  const levelPaths = Object.keys(files).filter((p) => p.startsWith(`${root}levels/`) && p.endsWith('.json')).sort();
  for (const p of levelPaths.slice(0, MAX_PACK_LEVELS)) {
    try {
      levels.push(validateMap(JSON.parse(strFromU8(files[p]))));
    } catch (err) {
      throw new Error(`${p.slice(root.length)}: ${(err as Error).message}`);
    }
  }

  // Every image, font and audio asset in the pack, by its path inside the pack
  const images: Record<string, string> = {};
  for (const [p, bytes] of Object.entries(files)) {
    if (!p.startsWith(root) || p.endsWith('/')) continue;
    const name = p.slice(root.length);
    const type = FILE_TYPES[name.split('.').pop()?.toLowerCase() ?? ''];
    if (type) images[name] = toDataUrl(bytes, type);
  }
  return { info, levels, images };
}

/** Build the zip for a theme pack */
export function writeThemeZip(t: StoredTheme): Blob {
  const files: Record<string, Uint8Array> = {
    'theme.json': strToU8(`${JSON.stringify(t.info, null, 2)}\n`),
  };
  // Enough digits that the files sort in order (01…21, 001…150)
  const digits = Math.max(2, String(t.levels.length).length);
  t.levels.slice(0, MAX_PACK_LEVELS).forEach((m, i) => {
    files[`levels/${String(i + 1).padStart(digits, '0')}.json`] = strToU8(`${JSON.stringify(m, null, 2)}\n`);
  });
  for (const [name, url] of Object.entries(t.images)) files[name] = dataUrlBytes(url);
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' });
}

/** Image file → data URL (for covers and badge images picked in the theme editor) */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** An official theme's image URL → data URL, so it can go into an exported zip */
export async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
