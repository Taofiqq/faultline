import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,prop}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/invariants/**'],
      thresholds: {
        branches: 90,
      },
    },
  },
});
