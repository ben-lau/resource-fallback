# @resource-fallback/webpack-plugin

> **[中文](README.md)** | English

Webpack 5+ plugin that provides runtime retry and multi-CDN fallback for Webpack build outputs (entry scripts, async chunks, CSS).

## Installation

```bash
pnpm add @resource-fallback/webpack-plugin -D
```

Also requires `html-webpack-plugin` (v4+) for automatic runtime injection.

## Basic Usage

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

> **Important**: `output.publicPath` should equal `rules[].base` (rule `base`).

## How It Works

The plugin does two things at build time, with dual-layer runtime protection:

### Build Time

#### 1. HTML Injection

Via `html-webpack-plugin`'s `alterAssetTagGroups` hook, injects into `<head>`:

- `<link rel="preconnect">` tags (pre-build connections for each fallback domain)
- `<script>` with inlined runtime IIFE + `install(config)` call

If `html-webpack-plugin` is not detected, the plugin outputs a warning and won't auto-inject. In that case, use `@resource-fallback/core`'s `getRuntimeCode()` for manual injection.

#### 2. RuntimeModule Injection

Injects a Webpack `RuntimeModule` (stage = `STAGE_TRIGGER`) that patches `__webpack_require__.l` inside webpack's bootstrap — after its definition but before the first chunk load triggers. This is far more reliable than monkey-patching from outside.

The injected code only connects Webpack's loader callbacks to core's private `window.__RF__.internal` bridge; it is not a public API for application code. The page-side RecoveryCoordinator remains the recovery decision engine and owns retry, fallback, circuit state, events, cancellation, and sharing of in-flight recovery Promises.

### Runtime — Dual-Layer Protection

#### Layer 1: `__webpack_require__.l` Wrapping

All async chunks in webpack (including `React.lazy()`, dynamic `import()`) load `<script>` tags through `__webpack_require__.l`. The RuntimeModule is the primary path: it wraps the native loader inside bootstrap, then delegates recovery decisions to the Coordinator. The wrapped flow:

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

Concurrent requests for the same logical chunk join one Coordinator session and share one recovery Promise. Each retry/fallback creates a brand new `<script>` element, preserves webpack metadata such as `nonce`, `crossOrigin`, `referrerPolicy`, `charset`, and `trustedScriptUrl`, and adds `data-webpack` when a `key` is available.

#### Layer 2: Observer

Observer acts as a safety net, handling scenarios not covered by `__webpack_require__.l`:

- **Entry scripts** (no `data-webpack` attribute)
- **CSS chunks** (`<link>` tags emitted by `mini-css-extract-plugin` or `experiments.css`; even with `data-webpack`, CSS replacement does not belong to the webpack adapter)
- **Other external `<script>` tags**

Observer automatically skips `<script>` tags with `data-webpack` to avoid duplicate takeover of the same async JS chunk with the webpack adapter; that rule does not transfer CSS ownership, so CSS `<link>` replacement still belongs to Observer. Meanwhile the RuntimeModule wraps non-`j` `__webpack_require__.f` loaders and swallows recognized CSS rejection so `Promise.all` does not fail before Observer replaces the `<link>`.

### chunkLoadingGlobal Hook

The runtime also hooks `window[chunkLoadingGlobal]` `push` as a fallback path. Once the webpack bootstrap installs `__webpack_require__`, the page-side adapter captures and wraps `__webpack_require__.l`. The global name comes from `output.chunkLoadingGlobal` when set, otherwise from webpack's `uniqueName`-derived default, so it is not always literally `webpackChunk_`.

This chunk-array path is a backup, not a replacement for the RuntimeModule primary path; if the RuntimeModule already wrapped `.l`, the page-side adapter detects the marker and yields.

## Configuration

`WebpackPluginOptions` is equivalent to `PluginOptions` from `@resource-fallback/core`. For full field reference, see the [root README](../../README.en.md#configuration-reference).

### Common Configuration Example

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

### Non-Browser Targets

When `target` is `node` / `webworker` / `electron-main`, the plugin automatically skips and injects nothing.

### React.lazy Error Handling

When using `React.lazy()`, if async chunks still fail after all candidate URLs are exhausted, `React.lazy()` throws an error. `<Suspense>` only handles loading state, not errors. It's recommended to wrap with an `ErrorBoundary`:

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
      return <div>Resource loading failed, please refresh the page</div>;
    }
    return this.props.children;
  }
}

// Usage
<ChunkErrorBoundary>
  <Suspense fallback={<Loading />}>
    <LazyComponent />
  </Suspense>
</ChunkErrorBoundary>;
```

### Entry Script Fallback

If all fallbacks fail for the entry script, React/Vue won't initialize and the page shows a white screen. It's recommended to add an inline `rf:error` listener in `index.html`:

```html
<script>
  window.addEventListener('rf:error', function () {
    document.body.innerHTML = '<p>Resource loading failed, please refresh the page</p>';
  });
</script>
```

### dispose Cleanup

When `window.__RF__.dispose()` runs, the runtime cancels in-flight recovery for owner = `webpack` and removes the `__webpack_require__.l` wrapper, chunk-array `push` patches, scan timers, and related listeners. Old sessions do not continue affecting a fresh installation.

## License

MIT
