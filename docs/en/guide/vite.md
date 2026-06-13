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

::: tip Important
The value of `base` should match `match` so build output URLs hit the rule.
:::

Full options: [Configuration Reference](./configuration.md).

## How it works

The plugin does three things at build time:

### 1. HTML injection

Via `transformIndexHtml`, injects into `<head>`:

- `<link rel="preconnect">` tags (pre-connect for each fallback domain)
- `<script>` with inlined runtime IIFE + `install(config)` call

### 2. renderBuiltUrl

Uses Vite's `experimental.renderBuiltUrl` hook to rewrite JS asset URLs for runtime resolution:

```js
// Original output
import('/assets/chunk-abc.js');

// Rewritten (in build output)
window.__RF__.url('assets/chunk-abc.js');
// → 'https://cdn.example.com/assets/chunk-abc.js' (or skips unavailable host due to circuit breaker)
```

`__RF__.url()` resolves the final URL at runtime based on rules and circuit breaker state, skipping tripped hosts.

### 3. Dynamic import rewriting

The plugin wraps dynamic `import()` in two ways:

#### renderDynamicImport

Uses Rollup's `renderDynamicImport` hook to wrap dynamic `import()` into a loading function with a fallback loop:

```js
// Original code
const mod = await import('./Lazy.vue');

// After build
const mod = await window.__RF__.load('assets/Lazy-abc.js', import('./Lazy.vue'));
```

#### writeBundle + es-module-lexer

The `writeBundle` hook uses `es-module-lexer` to parse dynamic imports inside chunks and replace match-rule URLs with `__RF__.load()` calls. This preserves dependency relationships when async modules include CSS.

```js
// writeBundle rewrite example
window.__RF__.load('assets/About-xxx.js');
```

### shouldRewriteUrls gate

In `configResolved`, the plugin compares Vite's final resolved `base` with `rules[].match`:

- If `base` matches at least one rule's `match`, URL rewriting is enabled (`renderBuiltUrl`, `writeBundle`)
- Otherwise rewriting is skipped to avoid incorrectly rewriting non-matching resources

::: info Why configResolved
`base` is read from `configResolved` to get Vite's final resolved value (after other plugins may override it).
:::

### **RF**.load fallback loop

`__RF__.load` runs the full retry → fallback loop:

1. Determines initial URL via `resolveBuiltUrl`
2. Attempts `import(url)`
3. On failure, retries per config (exponential backoff + jitter)
4. After retry budget is exhausted, switches to the next candidate URL
5. ES Module retries automatically append `__rf=` to bypass browser module cache
6. Emits `rf:retry` / `rf:fallback` / `rf:error` at each step
7. Throws the original error when all candidates are exhausted

### vite:preloadError handling

The runtime listens for Vite's `vite:preloadError` event. When modulepreload fails:

- **`preventDefault()` is required** — otherwise Vite throws and blocks subsequent `__RF__.load()` calls
- Payload is read from **`event.payload`** (not `detail`)
- Records host failure to the circuit breaker
- Lets subsequent `resolveBuiltUrl` skip unavailable hosts
- For CSS preload failures, CSS entity loading is delegated to Observer via `<link>` error events

```ts
// Simplified behavior in installViteAdapter
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const url = extractUrlFromError(event.payload);
  if (url) resolver.recordFailure(url);
});
```

## Configuration example

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
      rules: [{ match: 'https://cdn.example.com/', urls: ['/'] }],
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
| Async chunk (`import()`)   | ✓ `__RF__.load` + `renderDynamicImport`        | ✗          |
| CSS dynamic injection      | ✓ Observer                                     | ✓ Observer |
| SystemJS (legacy bundle)   | ✓ `instantiate` hook                           | —          |
| Images / fonts / media     | ✓ Hybrid SW (opt-in)                           | ✗          |
| CSS `url()` / `@font-face` | ✓ Hybrid SW (opt-in)                           | ✗          |
| CSS `@import`              | ✓ Hybrid SW (CSS referrer must match manifest) | ✗          |

## Related docs

- [Quick Start](./quick-start.md)
- [Hybrid Service Worker](./service-worker.md)
- [Runtime Events](./runtime-events.md)
