import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts'],
      thresholds: {
        statements: 60,
        branches: 75,
        functions: 80,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@resource-fallback/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
});
