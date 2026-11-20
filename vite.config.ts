import { configDefaults, defineConfig } from 'vitest/config';

// base: './' → works when deployed under a sub-path (e.g. GitHub Pages)
export default defineConfig({
  base: './',
  test: {
    // scripts/*.test.mjs are plain Node scripts with their own setup (e.g. security-db, see
    // docs/SECURITY.md), not Vitest suites. backups/ and temp/ hold snapshots of older copies of
    // the repo (their tests don't run against today's code).
    exclude: [...configDefaults.exclude, 'scripts/**', 'backups/**', 'temp/**'],
  },
});
