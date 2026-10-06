import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// `vite build --mode single` produces one self-contained chunk (used for the
// single-file HTML build that can be opened from disk or embedded as a preview).
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
    exclude: ['e2e/**', 'node_modules/**'],
    testTimeout: 120000,
  },
}));
