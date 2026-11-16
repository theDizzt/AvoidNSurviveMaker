import { defineConfig } from 'vite';

// base: './' → works when deployed under a sub-path (e.g. GitHub Pages)
export default defineConfig({
  base: './',
});
