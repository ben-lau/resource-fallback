import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/core/src/**/*.ts'],
      exclude: [
        'packages/core/src/**/*.test.ts',
        'packages/core/src/types.ts',
        'packages/core/src/sw/entry.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@resource-fallback/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
});
