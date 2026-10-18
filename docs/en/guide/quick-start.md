---
title: Quick Start
---

# Quick Start

Choose your build tool, configure the asset prefix and fallback destinations, then verify a CDN failure against a production build.

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
          base: 'https://cdn1.example.com/',
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

::: tip Align rule `base` with Vite `base`
`rules[].base` (rule `base`) should equal Vite `base` so build output URLs hit the rule.
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
          base: 'https://cdn1.example.com/',
          urls: ['https://cdn2.example.com/', 'https://backup.example.com/', '/'],
        },
      ],
    }),
  ],
};
```

::: tip Align rule `base` with publicPath
`rules[].base` (rule `base`) should equal `output.publicPath`.
:::

## Verification

### Expected request order

Suppose `https://app.example.com/` loads `assets/app.js`. With the config above, each fallback keeps the asset path. With closed circuits and each preceding address still failing, the browser tries these URLs in order.

| Destination               | Request URL                                |
| ------------------------- | ------------------------------------------ |
| Primary CDN               | `https://cdn1.example.com/assets/app.js`   |
| Backup CDN                | `https://cdn2.example.com/assets/app.js`   |
| Self-hosted static server | `https://backup.example.com/assets/app.js` |
| Page origin (`'/'`)       | `https://app.example.com/assets/app.js`    |

Deploy the same build output to the corresponding paths at every destination. The `'/'` prefix resolves at the root of the page origin. Use `'/app/'` when the build is served under that path.

### Simulate a CDN failure

1. Preview the production build. For Vite, run `pnpm exec vite build` and `pnpm exec vite preview`. For Webpack, run `pnpm exec webpack --mode production` and serve the build output with a static server.
2. Disable caching in the DevTools Network panel and block the primary CDN request for one lazy-loaded chunk. The app can still start while you test that chunk. Match requests with query parameters too, since retries may add one.
3. Register the listeners below before triggering the lazy load. Check for `rf:retry`, `rf:fallback`, and `rf:success` for the same asset, then confirm the successful request's host in Network.
4. In a fresh browser session, block that asset at every CDN to verify origin recovery. Block the origin too and check for `rf:error` and your application's fallback UI.

```js
for (const name of ['rf:retry', 'rf:fallback', 'rf:success', 'rf:error']) {
  window.addEventListener(name, (event) => {
    console.log(name, event.detail);
  });
}
```

To test an entry script, register the listener before the page first requests the asset. See [fallback UI for entry failures](./runtime-events.md).

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

1. **Align `rules[].base` with the emitted asset prefix** — Vite: Vite `base`; Webpack: `output.publicPath`. If the initial resource URL does not match the rule `base`, the runtime will not enter retry/fallback.
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
