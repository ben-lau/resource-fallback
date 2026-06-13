---
title: Quick Start
---

# Quick Start

## Installation

::: code-group

```bash [Vite]
pnpm add -D @resource-fallback/vite-plugin
```

```bash [Webpack]
pnpm add -D @resource-fallback/webpack-plugin html-webpack-plugin
```

:::

::: warning Webpack dependency
The Webpack plugin relies on `html-webpack-plugin` to inject the runtime automatically. If your project does not use it, inject the runtime manually via `@resource-fallback/core`.
:::

## Minimal Vite config

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn1.example.com/',
  plugins: [
    resourceFallback({
      rules: [
        {
          match: 'https://cdn1.example.com/',
          urls: [
            'https://cdn2.example.com/',
            'https://backup.example.com/',
            '/', // origin fallback
          ],
          retry: { max: 2, baseDelay: 300 },
          circuit: { threshold: 3, cooldown: 30000 },
        },
      ],
    }),
  ],
});
```

::: tip Align match with base
The value of `match` should match Vite's `base` so build output URLs hit the rule.
:::

## Minimal Webpack config

```js
// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ResourceFallbackWebpackPlugin } = require('@resource-fallback/webpack-plugin');

module.exports = {
  output: {
    publicPath: 'https://cdn1.example.com/',
  },
  plugins: [
    new HtmlWebpackPlugin(),
    new ResourceFallbackWebpackPlugin({
      rules: [
        {
          match: 'https://cdn1.example.com/',
          urls: ['https://cdn2.example.com/', 'https://backup.example.com/', '/'],
        },
      ],
    }),
  ],
};
```

::: tip Align match with publicPath
The value of `match` should match `output.publicPath`.
:::

## Verification

After building and previewing, open DevTools → Network to observe the full **retry → fallback → origin** chain.

Listen for `rf:retry` to confirm the runtime is active:

```ts
window.addEventListener('rf:retry', (e) => {
  console.log('Retry:', e.detail);
});
```

### Demo projects

Two examples ship without a mock server (`.invalid` domains simulate CDN failure):

```bash
pnpm install
pnpm build

# Vite + Vue
pnpm --filter @resource-fallback-example/vite-vue build
pnpm --filter @resource-fallback-example/vite-vue start   # http://127.0.0.1:4174

# Webpack + React
pnpm --filter @resource-fallback-example/webpack-react build
pnpm --filter @resource-fallback-example/webpack-react start   # http://127.0.0.1:4173
```

## Getting started notes

1. **Align `match` with the emitted asset prefix** — Vite: `base`; Webpack: `output.publicPath`. If the initial resource URL does not match `match`, the runtime will not enter retry/fallback.
2. **`urls` order is fallback order** — recommended: backup CDN → self-hosted static origin → same-origin `'/'`. The last entry is usually same-origin to avoid hitting a broken CDN again.
3. **Vite dev is not the main verification target** — the dev server uses native ESM; dynamic `import()` failures cannot be fully intercepted. Use `vite build && vite preview` or the example E2E tests.
4. **Add your own UI fallback for entry resource failures** — if the entry bundle exhausts all candidate URLs, React/Vue has not started yet. Add a lightweight `rf:error` listener in `index.html`.
5. **Hybrid SW is opt-in** — set `serviceWorker: true` or an object config for images, fonts, CSS background images, etc. Debug SW on `localhost`, `127.0.0.1`, or HTTPS.

::: warning Vite dev mode
The plugin is inactive in dev by default (`enableDev: false`). Use `vite build && vite preview` to verify fallback behavior.
:::

## Next steps

- [Configuration Reference](./configuration.md) — full options
- [Runtime Events](./runtime-events.md) — event listening and monitoring
- [Best Practices](./best-practices.md) — production recommendations
