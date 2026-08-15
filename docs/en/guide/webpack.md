---
title: Webpack Integration
---

# Webpack Integration

`@resource-fallback/webpack-plugin` is a Webpack 5+ plugin that provides runtime retry and multi-CDN fallback for Webpack build outputs (entry scripts, async chunks, CSS).

## Installation

```bash
pnpm add -D @resource-fallback/webpack-plugin html-webpack-plugin
```

Also install `html-webpack-plugin` (v4+) for automatic runtime injection.

## Basic configuration

```js
// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ResourceFallbackWebpackPlugin } = require('@resource-fallback/webpack-plugin');

module.exports = {
  output: {
    publicPath: 'https://cdn.example.com/',
  },
  plugins: [
    new HtmlWebpackPlugin(),
    new ResourceFallbackWebpackPlugin({
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
};
```

::: tip Important
`output.publicPath` should equal `rules[].base` (rule `base`).
:::

Full options: [Configuration Reference](./configuration.md).

## How it works

The plugin does two things at build time; the runtime provides dual-layer protection.

### Build time

#### 1. HTML injection

Via `html-webpack-plugin`'s `alterAssetTagGroups` hook, injects into `<head>`:

- `<link rel="preconnect">` tags
- `<script>` with inlined runtime IIFE + `install(config)` call

::: warning Without html-webpack-plugin
If `html-webpack-plugin` is not detected, the plugin logs a warning and does not inject automatically. Use `@resource-fallback/core`'s `getRuntimeCode()` to inject manually.
:::

#### 2. RuntimeModule injection

Injects a Webpack `RuntimeModule` (stage = `STAGE_TRIGGER`) that patches `__webpack_require__.l` inside webpack's bootstrap — after it is defined but before the first chunk load. This is more reliable than external monkey-patching.

The injected code only connects Webpack's loader callbacks to core's private `window.__RF__.internal` bridge. It is not a public application API and should not be treated as a semver-stable integration surface. The page-side RecoveryCoordinator remains the recovery decision engine and owns retry, fallback, circuit state, events, cancellation, and sharing of in-flight recovery Promises.

### Runtime — dual-layer protection

#### Layer 1: `__webpack_require__.l` wrapping

All async chunks (including `React.lazy()`, dynamic `import()`) load `<script>` tags through `__webpack_require__.l`. The RuntimeModule is the primary path: it wraps webpack's native loader inside bootstrap, preserves first-load callback semantics, then hands recovery decisions to the Coordinator. Wrapped flow:

```
Chunk load request
  │
  ├── __webpack_require__.l(url, done, key, chunkId)
  │   │
  │   ├── Original <script> load
  │   │   ├── Success → Coordinator → done(event)
  │   │   └── Failure → Coordinator recovery
  │   │       ├── retry → create new <script>, delay and retry
  │   │       ├── fallback → create new <script>, switch URL
  │   │       └── giveup → done(event) (let webpack handle the error)
```

Concurrent admissions for the same logical chunk (`logicalKey` derived from `key`/`chunkId`) join one Coordinator session and share one recovery Promise instead of launching parallel recoveries. Each retry/fallback creates a brand new `<script>` element and preserves webpack metadata such as `nonce`, `crossOrigin`, `referrerPolicy`, `charset`, and `trustedScriptUrl`; when a `key` is present, the new node also carries `data-webpack`.

#### data-webpack ownership

Retry/fallback `<script>` elements get a `data-webpack` attribute (chunk loading key). Observer only skips `<script>` tags with `data-webpack`, which prevents duplicate takeover of the same async JS chunk by both Observer and the webpack adapter; this rule does not transfer CSS ownership, so CSS `<link>` replacement still belongs to Observer.

::: info Ownership split

- **Webpack adapter** — async chunk `<script>` with `data-webpack`
- **Observer** — entry scripts (no `data-webpack`), CSS chunks, other external `<script>`
  :::

#### CSS chunk promise handling

`mini-css-extract-plugin` and webpack `experiments.css` register non-`j` loaders on `__webpack_require__.f` (e.g. `miniCss`, `css`). When an async chunk includes a separate `.css` chunk, `__webpack_require__.e(chunkId)` runs `Promise.all` over JS and CSS loader promises.

If CSS `<link>` load fails, webpack's generated `onerror` **rejects with `ChunkLoadError`** (`code: 'CSS_CHUNK_LOAD_FAILED'`) or an error whose `request` points at a `.css` URL. The RuntimeModule does exactly one thing here: swallow that recognized CSS rejection so `Promise.all` does not fail early. The actual `<link>` replacement still belongs to Observer. In other words, the webpack hook prevents premature failure, while Observer creates and owns the replacement CSS node.

The injected `RuntimeModule` wraps every non-`j` loader on `__webpack_require__.f`:

```js
// Simplified injected logic
for (const fk of Object.keys(__webpack_require__.f)) {
  if (fk === 'j') continue;
  const origFn = __webpack_require__.f[fk];
  __webpack_require__.f[fk] = function (chunkId, promises) {
    const before = promises.length;
    origFn(chunkId, promises);
    for (let pi = before; pi < promises.length; pi++) {
      promises[pi] = promises[pi].catch((err) => {
        const isCss =
          err?.code === 'CSS_CHUNK_LOAD_FAILED' ||
          (err?.request && /\.css([?#]|$)/.test(err.request));
        if (!isCss) throw err;
        // The Observer owns the CSS link replacement. Swallow the original
        // rejection so Promise.all does not fail before that replacement.
      });
    }
  };
}
```

CSS entity loading still relies on Observer for `<link>` replacement — same ownership split as async JS scripts.

#### Layer 2: Observer

Observer acts as a safety net for scenarios `__webpack_require__.l` does not cover:

- **Entry scripts** (no `data-webpack`)
- **CSS chunks** (`<link>` from mini-css-extract-plugin)
- **Other external `<script>` tags**

### chunkLoadingGlobal hook

core's webpack adapter also hooks `window[chunkLoadingGlobal]` `push` as a fallback path: once chunk runtime code exposes `__webpack_require__`, it can wrap `__webpack_require__.l` from the page side. The global name comes from `output.chunkLoadingGlobal` when set, otherwise from webpack's `uniqueName`-derived default, so it is not always literally `webpackChunk_`.

This chunk-array / `chunkLoadingGlobal` path is a backup, not a replacement for the RuntimeModule primary path. If the RuntimeModule misses due to version or injection timing, the page-side adapter can still take over; if the plugin RuntimeModule already wrapped `.l`, the chunk-array adapter detects the marker and yields.

## Configuration example

```js
new ResourceFallbackWebpackPlugin({
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
});
```

## Notes

### Non-browser targets

When `target` is `node` / `webworker` / `electron-main`, the plugin skips injection.

### React.lazy error handling

If an async chunk exhausts all candidate URLs, `React.lazy()` throws. `<Suspense>` only handles loading, not errors. Wrap with `ErrorBoundary`:

```tsx
class ChunkErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div>Resource load failed. Please refresh the page.</div>;
    }
    return this.props.children;
  }
}

<ChunkErrorBoundary>
  <Suspense fallback={<Loading />}>
    <LazyComponent />
  </Suspense>
</ChunkErrorBoundary>;
```

### Entry script fallback

If the entry bundle exhausts all fallbacks, React/Vue never initializes. Add an inline `rf:error` listener in `index.html`:

```html
<script>
  window.addEventListener('rf:error', function () {
    document.body.innerHTML = '<p>Resource load failed. Please refresh the page.</p>';
  });
</script>
```

### dispose cleanup

When `window.__RF__.dispose()` runs, or the current runtime installation is torn down, the webpack owner cancels in-flight recovery and removes the `__webpack_require__.l` wrapper, chunk-array `push` patches, scan timers, and listeners. Old sessions do not continue taking over page state after a fresh install; a new runtime installation creates its own Coordinator and adapters.

## Sync/async coverage

| Scenario                   | Webpack                                        |
| -------------------------- | ---------------------------------------------- |
| Sync `<script>` / `<link>` | ✓ Observer                                     |
| Async chunk (`import()`)   | ✓ `__webpack_require__.l` hook                 |
| CSS dynamic injection      | ✓ Observer                                     |
| SystemJS (legacy bundle)   | ✓ `instantiate` hook                           |
| Images / fonts / media     | ✓ Hybrid SW (opt-in, controlled pages)         |
| CSS `url()` / `@font-face` | ✓ Hybrid SW (opt-in, controlled pages)         |
| CSS `@import`              | ✓ Hybrid SW (CSS referrer must match manifest) |

## Related docs

- [Quick Start](./quick-start.md)
- [Hybrid Service Worker](./service-worker.md)
- [Runtime Events](./runtime-events.md)
