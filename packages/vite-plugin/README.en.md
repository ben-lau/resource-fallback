# @resource-fallback/vite-plugin

> **[中文](README.md)** | English

Vite 4+ plugin that provides runtime retry and multi-CDN fallback for Vite build outputs (sync JS/CSS, async chunks, modulepreload).

## Installation

```bash
pnpm add @resource-fallback/vite-plugin -D
```

## Basic Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn.example.com/',
  plugins: [
    resourceFallback({
      rules: [
        {
          match: 'https://cdn.example.com/',
          urls: [
            'https://cdn-backup.example.com/',
            '/', // origin fallback
          ],
        },
      ],
    }),
  ],
});
```

> **Important**: The value of `base` should match `match` to ensure build output URLs match the rule.

## How It Works

The plugin does three things at build time:

### 1. HTML Injection

Via the `transformIndexHtml` hook, injects into `<head>`:

- `<link rel="preconnect">` tags (pre-build connections for each fallback domain)
- `<script>` with inlined runtime IIFE + `install(config)` call

### 2. Static Asset URL Rewriting

Uses Vite's `experimental.renderBuiltUrl` hook to rewrite JS asset URLs for runtime resolution:

```js
// Original output
import('/assets/chunk-abc.js');

// Rewritten (in build output)
window.__RF__.url('assets/chunk-abc.js');
// → 'https://cdn.example.com/assets/chunk-abc.js' (or skips unavailable host due to circuit breaker)
```

### 3. Dynamic Import Wrapping

Uses Rollup's `renderDynamicImport` hook to wrap dynamic `import()` into a loading function with fallback loop:

```js
// Original code
const mod = await import('./Lazy.vue');

// After build
const mod = await window.__RF__.load('assets/Lazy-abc.js', import('./Lazy.vue'));
```

`__RF__.load` internally executes the full retry → fallback loop:

1. Determines initial request URL via `resolveBuiltUrl`
2. Attempts `import(url)`
3. On failure, retries per config (exponential backoff + jitter)
4. After retry budget is exhausted, switches to next candidate URL
5. ES Module retries automatically add `__rf=` parameter to bypass browser module cache
6. Each step emits corresponding `rf:retry` / `rf:fallback` / `rf:error` events
7. After all candidates are exhausted, throws the original error

### vite:preloadError Handling

The runtime also listens for Vite's `vite:preloadError` event. When modulepreload fails, it records the host failure to the circuit breaker so subsequent `resolveBuiltUrl` calls automatically skip unavailable hosts.

## Configuration

`ViteResourceFallbackOptions` is equivalent to `PluginOptions` from `@resource-fallback/core`. For full field reference, see the [root README](../../README.en.md#configuration-reference).

### Common Configuration Example

```ts
resourceFallback({
  rules: [
    {
      match: 'https://cdn.example.com/',
      urls: ['https://cdn-backup.example.com/', 'https://static.mysite.com/', '/'],
      retry: { max: 2, baseDelay: 300, maxDelay: 3000, jitter: true },
      circuit: { threshold: 3, cooldown: 30000 },
    },
  ],
  debug: 'auto', // controlled via localStorage.__RF_DEBUG__
  sri: 'strip', // remove integrity on fallback
  nonce: 'my-csp-nonce', // CSP nonce
  injectPreconnect: true, // inject <link rel="preconnect">
  htmlInject: 'head-prepend', // inject at top of <head>
});
```

### With @vitejs/plugin-legacy

If your project uses `@vitejs/plugin-legacy` to generate SystemJS-format legacy bundles, the runtime automatically installs the SystemJS adapter, hooking `System.constructor.prototype.instantiate` to provide fallback for legacy entry points and async chunks.

```ts
// vite.config.ts
import legacy from '@vitejs/plugin-legacy';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn.example.com/',
  plugins: [
    legacy({ targets: ['defaults', 'not IE 11'] }),
    resourceFallback({
      rules: [{ match: 'https://cdn.example.com/', urls: ['/'] }],
    }),
  ],
});
```

## Vite Dev Mode

By default the plugin is inactive in `dev` mode (`enableDev: false`). Vite dev server uses native ESM, so dynamic import failures cannot be intercepted. To debug fallback logic, use:

```bash
vite build && vite preview
```

Setting `enableDev: true` also injects the runtime in dev mode, but only sync `<script>` / `<link>` error events will work.

## License

MIT
