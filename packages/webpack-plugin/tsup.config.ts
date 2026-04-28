import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  outDir: 'dist',
  sourcemap: true,
  splitting: false,
  external: ['webpack', 'html-webpack-plugin', '@resource-fallback/core'],
});
