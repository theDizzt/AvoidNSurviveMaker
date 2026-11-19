import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'supabase/functions/verify-replay',
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    lib: { entry: 'src/server/verifier.ts', formats: ['es'], fileName: () => 'verifier.js' },
  },
});
