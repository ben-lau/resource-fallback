# @resource-fallback/vite-plugin

> **[中文](README.md)** | English

Vite 4+ plugin that provides runtime retry and multi-CDN fallback for Vite build outputs (sync JS/CSS and async chunks); for `modulepreload` failures it provides managed error suppression and rule gating, but does not replace the preload URL directly.

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

> **Important**: Vite `base` should equal `rules[].base` (rule `base`) so build output URLs hit the rule. URL rewriting runs only when both sides match after trailing-slash normalization (`ensureTrailingSlash(viteBase) === ensureTrailingSlash(r.base)`).

## How It Works

The plugin follows this build/runtime sequence:

### 1. `configResolved`: compare normalized Vite base against rule bases

The plugin first reads Vite's final resolved `base` in `configResolved`, then compares it with every `rules[].base` using the same trailing-slash normalization.

- If the normalized Vite `base` matches at least one rule `base`, later URL rewriting stays enabled
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

### 4. `transformIndexHtml`: inject runtime and preconnect tags

`transformIndexHtml` injects into `<head>`:

- `<link rel="preconnect">` tags
- a `<script>` that inlines the runtime IIFE and the `install(config)` call

### `__RF__.url` behavior

`__RF__.url(filename)` only joins the filename with the first compiled rule base. It does not inspect circuit state or skip hosts at runtime.

### `__RF__.load` fallback loop

`__RF__.load(filename)` resolves the initial URL first, then delegates retry / fallback / deadline / cancellation to the shared Coordinator. It also uses a normalized URL key so concurrent loads from the same owner can share one recovery Promise.

### vite:preloadError Handling

The runtime also listens for Vite's `vite:preloadError` event. When modulepreload fails:

- the adapter reads `event.payload`
- if the extracted URL matches a configured rule, it calls `event.preventDefault()`
- it does not update circuit state, emit a recovery event, or choose a fallback URL directly
- CSS `<link>` failures remain Observer-owned

## Configuration

`ViteResourceFallbackOptions` is equivalent to `PluginOptions` from `@resource-fallback/core`. For full field reference, see the [root README](../../README.en.md#configuration-reference).

### Common Configuration Example

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
      rules: [{ base: 'https://cdn.example.com/', urls: ['/'] }],
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

## License

MIT
