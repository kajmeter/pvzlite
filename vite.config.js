import { defineConfig } from 'vite';

// `vite build --mode single` produces one self-contained chunk (used for the
// single-file HTML build that can be opened from disk or embedded as a preview).
export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173, host: true },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
    rollupOptions:
      mode === 'single'
        ? { output: { inlineDynamicImports: true, manualChunks: undefined } }
        : { output: { manualChunks: { three: ['three'] } } },
  },
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 120000,
  },
}));
