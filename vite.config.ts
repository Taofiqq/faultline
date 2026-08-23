import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The project enforces its real 500 KB gzip budget in check-bundle-size.js.
    // Keep Vite's raw-chunk advisory aligned with the current 544 KB entry chunk.
    chunkSizeWarningLimit: 600,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,prop}.ts', 'test/**/*.{test,prop}.tsx'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/invariants/**', 'src/metrics/**'],
      thresholds: {
        branches: 90,
      },
    },
  },
});
