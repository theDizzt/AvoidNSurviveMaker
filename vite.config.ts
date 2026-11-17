import { configDefaults, defineConfig } from 'vitest/config';

// base: './' → works when deployed under a sub-path (e.g. GitHub Pages)
export default defineConfig({
  base: './',
  test: {
    // scripts/*.test.mjs are plain Node scripts with their own setup (e.g. security-db, see
    // docs/SECURITY.md), not Vitest suites
    exclude: [...configDefaults.exclude, 'scripts/**'],
  },
});
