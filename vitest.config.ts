import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts'],
      thresholds: {
        statements: 75,
        branches: 80,
        functions: 90,
        lines: 75,
      },
    },
  },
  resolve: {
    alias: {
      '@resource-fallback/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
});
