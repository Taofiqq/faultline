import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Use /faultline/ base for GitHub Pages production deploy.
  // Local dev/preview stays at / so Playwright and HMR work unchanged.
  // Set GITHUB_PAGES=1 in the deploy workflow to activate.
  base: process.env.GITHUB_PAGES === '1' ? '/faultline/' : '/',
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
