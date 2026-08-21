---
title: Vite Integration
---

# Vite Integration

`@resource-fallback/vite-plugin` is a Vite 4+ plugin that provides runtime retry and multi-CDN fallback for Vite build outputs (sync JS/CSS, async chunks, modulepreload).

## Installation

```bash
pnpm add -D @resource-fallback/vite-plugin
```

## Basic configuration

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
          base: 'https://cdn.example.com/',
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

::: tip Important
Vite `base` should equal `rules[].base` (rule `base`) so build output URLs hit the rule.
:::

Full options: [Configuration Reference](./configuration.md).

## How it works

The plugin follows this build/runtime sequence:

### 1. `configResolved`: compare normalized Vite base against rule bases

The plugin first reads Vite's final resolved `base` in `configResolved`, then compares it with every `rules[].base` using the same trailing-slash normalization.

- If the normalized Vite `base` matches at least one rule `base`, URL rewriting stays enabled for later build steps
- If it does not match, `writeBundle` skips the dynamic import rewrite so a non-CDN build is not rewritten into external URLs

### 2. `generateBundle`: optionally emit Service Worker assets

If `serviceWorker` is enabled, `generateBundle` optionally emits:

- `rf-sw.js`
- `manifest.json`

### 3. `writeBundle`: parse literal dynamic imports and replace them with `window.__RF__.load(filename)`

`writeBundle` uses `es-module-lexer` to parse dynamic imports inside chunks, then rewrites only literal imports that satisfy all of the following:

1. the import specifier is a literal string
2. the resolved filename exists in `chunk.dynamicImports`
3. the build has already passed the normalized base gate

Matching imports are replaced with `window.__RF__.load(filename)`, for example:

```js
// Original code
const mod = await import('./Lazy.vue');

// After build
const mod = await window.__RF__.load('assets/Lazy-abc.js');
```

### Current `window.__RF__.url(filename)` semantics

`window.__RF__.url(filename)` only joins the filename with the **first compiled rule** `base` to build the initial URL. It does not inspect circuit state or skip hosts at page runtime.

### Current `window.__RF__.load(filename)` recovery semantics

`window.__RF__.load(filename)` resolves the initial URL first, then delegates retry / fallback / deadline / cancellation to the shared `RecoveryCoordinator`. It also uses a normalized sharing key so concurrent loads from the same owner for the same logical resource can share one recovery Promise.

### 4. `transformIndexHtml`: inject runtime and preconnect tags

`transformIndexHtml` injects into `<head>`:

- `<link rel="preconnect">` tags
- a `<script>` that inlines the runtime IIFE and the `install(config)` call

### vite:preloadError handling

The runtime listens for Vite's `vite:preloadError` event. When modulepreload fails:

- the adapter reads `event.payload`
- if the extracted URL matches a configured rule, it calls `event.preventDefault()`
- it does not update circuit state, emit a recovery event, or choose a fallback URL directly
- CSS `<link>` failures remain Observer-owned; this handler only stops Vite from throwing on a managed failure

## Configuration example

```ts
resourceFallback({
  rules: [
    {
      base: 'https://cdn.example.com/',
      urls: ['https://cdn-backup.example.com/', 'https://static.mysite.com/', '/'],
      retry: { max: 2, baseDelay: 300, maxDelay: 3000, jitter: true },
      circuit: { threshold: 3, cooldown: 30000 },
    },
  ],
  debug: 'auto',
  sri: 'strip',
  nonce: 'my-csp-nonce',
  injectPreconnect: true,
  htmlInject: 'head-prepend',
});
```

## With @vitejs/plugin-legacy

When using `@vitejs/plugin-legacy` for SystemJS legacy bundles, the runtime installs the SystemJS adapter automatically via `System.constructor.prototype.instantiate`.

```ts
import legacy from '@vitejs/plugin-legacy';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn.example.com/',
  plugins: [
    legacy({ targets: ['defaults', 'not IE 11'] }),
    resourceFallback({
      rules: [{ base: 'https://cdn.example.com/', urls: ['/'] }],
    }),
  ],
});
```

## Vite dev mode

The plugin is inactive in dev by default (`enableDev: false`). Vite dev uses native ESM — dynamic import failures cannot be intercepted.

::: warning Verification
Use `vite build && vite preview` to verify fallback. Setting `enableDev: true` injects the runtime in dev, but only sync `<script>` / `<link>` error events work.
:::

## Sync/async coverage

| Scenario                   | Vite (build/preview)                           | Vite (dev) |
| -------------------------- | ---------------------------------------------- | ---------- |
| Sync `<script>` / `<link>` | ✓ Observer                                     | ✓ Observer |
| Async chunk (`import()`)   | ✓ `__RF__.load` + `writeBundle` rewrite        | ✗          |
| CSS dynamic injection      | ✓ Observer                                     | ✓ Observer |
| SystemJS (legacy bundle)   | ✓ `instantiate` hook                           | —          |
| Images / fonts / media     | ✓ Hybrid SW (opt-in)                           | ✗          |
| CSS `url()` / `@font-face` | ✓ Hybrid SW (opt-in)                           | ✗          |
| CSS `@import`              | ✓ Hybrid SW (CSS referrer must match manifest) | ✗          |

## Related docs

- [Quick Start](./quick-start.md)
- [Hybrid Service Worker](./service-worker.md)
- [Runtime Events](./runtime-events.md)
