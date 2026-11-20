import { t } from './i18n';
/** Menu music override stored as a Blob, outside localStorage's small quota. */
const bundled = import.meta.glob<string>('../assets/music/main-menu.{mp3,ogg,wav,m4a,aac,flac}', { eager: true, query: '?url', import: 'default' });
const defaultUrl = Object.values(bundled)[0] ?? null;
const defaultName = defaultUrl ? '- Platform / Or4nges' : t('music.none');
let objectUrl: string | null = null;
export let menuMusicUrl: string | null = defaultUrl;

function store(file: File | null | undefined): Promise<File | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('avoid-n-survive:audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('tracks', file === undefined ? 'readonly' : 'readwrite');
      const records = tx.objectStore('tracks');
      const operation = file === undefined ? records.get('menu') : file === null ? records.delete('menu') : records.put(file, 'menu');
      tx.oncomplete = () => { db.close(); resolve(file === undefined ? operation.result as File | undefined : file ?? undefined); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

export function installMenuMusicControls(onChange: () => void): void {
  const input = document.getElementById('menu-music-file') as HTMLInputElement;
  const remove = document.getElementById('menu-music-remove') as HTMLButtonElement;
  const label = document.getElementById('menu-music-name')!;
  let revision = 0;
  const apply = (file?: File) => {
    const previous = objectUrl;
    objectUrl = file ? URL.createObjectURL(file) : null;
    menuMusicUrl = objectUrl ?? defaultUrl;
    label.textContent = file?.name ?? defaultName;
    onChange();
    if (previous) URL.revokeObjectURL(previous);
  };
  void store(undefined).then((file) => { if (!revision) apply(file); }).catch(() => {
    if (!revision) apply();
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
      label.textContent = t('music.tooLarge');
      return;
    }
    revision++;
    input.disabled = remove.disabled = true;
    try { await store(file); apply(file); }
    catch { label.textContent = t('music.saveFailed'); }
    finally { input.disabled = remove.disabled = false; }
  });
  remove.addEventListener('click', async () => {
    revision++;
    input.disabled = remove.disabled = true;
    try { await store(null); apply(); }
    catch { label.textContent = t('music.resetFailed'); }
    finally { input.disabled = remove.disabled = false; }
  });
}
