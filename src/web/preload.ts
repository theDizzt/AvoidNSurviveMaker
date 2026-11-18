import { language, t } from '../core/i18n';
import { FONT_MAIN, FONT_TIMER, FONT_TITLE } from './render';

export interface PreloadTask {
  label: string;
  run: () => Promise<unknown>;
}

/** Every font face the game uses. Canvas text never triggers a download by itself, so load them all here. */
export const FONT_TASKS: PreloadTask[] = [
  { label: t('preload.titleFont'), run: () => document.fonts.load(`700 16px ${FONT_TITLE}`) },
  { label: t('preload.mainRegular'), run: () => document.fonts.load(`400 16px ${FONT_MAIN}`) },
  { label: t('preload.mainBold'), run: () => document.fonts.load(`700 16px ${FONT_MAIN}`) },
  { label: t('preload.mainLight'), run: () => document.fonts.load(`300 16px ${FONT_MAIN}`) },
  { label: t('preload.timerFont'), run: () => document.fonts.load(`400 16px ${FONT_TIMER}`) },
  // Chinese fallbacks load only for Chinese text (unicode-range), so ask for some
  ...(language === 'zh' ? [
    { label: t('preload.zhMainFont'), run: () => document.fonts.load("400 16px 'ZhMain'", '中文') },
    { label: t('preload.zhTitleFont'), run: () => document.fonts.load("400 16px 'ZhTitle'", '中文') },
  ] : []),
];

const MIN_DURATION_MS = 800;
const TIMEOUT_MS = 8000;

/**
 * Run tasks in parallel and report progress. A failing task doesn't block the game
 * (it falls back, e.g. to system fonts), and the whole thing gives up waiting after
 * TIMEOUT_MS so a stalled network can't trap the player on the loading screen.
 */
export async function runPreload(
  tasks: readonly PreloadTask[],
  onProgress: (done: number, total: number, label: string) => void,
): Promise<void> {
  const started = performance.now();
  let done = 0;
  onProgress(0, tasks.length, 'Loading…');
  const all = Promise.all(
    tasks.map(async (t) => {
      try {
        await t.run();
      } catch {
        /* fall back silently */
      }
      done++;
      onProgress(done, tasks.length, `${t.label} loaded`);
    }),
  );
  await Promise.race([all, new Promise((r) => setTimeout(r, TIMEOUT_MS))]);
  const remaining = MIN_DURATION_MS - (performance.now() - started);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}
