import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig([
  // 1) Node-side entry: types + helpers consumed by webpack/vite plugins.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'node18',
    outDir: 'dist',
    sourcemap: true,
    splitting: false,
    shims: true,
  },
  // 2) Browser runtime: a single self-contained ES5 IIFE shipped to the page.
  {
    entry: { runtime: 'src/runtime/entry.ts' },
    format: ['iife'],
    target: 'es5',
    outDir: 'dist',
    outExtension: () => ({ js: '.iife.js' }),
    globalName: '__RF__',
    sourcemap: false,
    minify: true,
    clean: false,
    splitting: false,
    define: {
      __RF_VERSION__: JSON.stringify(pkg.version),
    },
    // The IIFE returns the module-level exports of entry.ts. Because entry.ts
    // mutates `window.__RF__` directly, we don't really care about the IIFE
    // return value - but tsup still requires globalName to be set when format=iife.
    footer: { js: '' },
    banner: { js: '' },
  },
  // 3) Service Worker runtime: separate bundle because SW has no window/document.
  {
    entry: { sw: 'src/sw/entry.ts' },
    format: ['iife'],
    target: 'es2018',
    outDir: 'dist',
    outExtension: () => ({ js: '.js' }),
    globalName: '__RF_SW__',
    sourcemap: false,
    minify: true,
    clean: false,
    splitting: false,
  },
]);
