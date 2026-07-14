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

### Runtime — Dual-Layer Protection

#### Layer 1: `__webpack_require__.l` Wrapping

All async chunks in webpack (including `React.lazy()`, dynamic `import()`) load `<script>` tags through `__webpack_require__.l`. The wrapped flow:

```
Chunk load request
  │
  ├── __webpack_require__.l(url, done, key, chunkId)
  │   │
  │   ├── Original <script> load
  │   │   ├── Success → recordSuccess → done(event)
  │   │   └── Failure → resolver.resolve()
  │   │       ├── retry → create new <script>, delay and retry
  │   │       ├── fallback → create new <script>, switch URL
  │   │       └── giveup → done(event) (let webpack handle the error)
```

Each retry/fallback creates a brand new `<script>` element (with `data-webpack` attribute) to bypass browser cache.

#### Layer 2: Observer

Observer acts as a safety net, handling scenarios not covered by `__webpack_require__.l`:

- **Entry scripts** (no `data-webpack` attribute)
- **CSS chunks** (`<link>` tags output by `mini-css-extract-plugin`, which also have `data-webpack` but aren't handled by the webpack adapter)
- **Other external `<script>` tags**

Observer automatically skips `<script>` tags with `data-webpack` attribute to avoid duplicate processing with the webpack adapter.

### chunkLoadingGlobal Hook

The runtime also hooks `window[chunkLoadingGlobal]` (default: `webpackChunk_`) `push` method. Once the webpack bootstrap installs `__webpack_require__`, the runtime captures and wraps `__webpack_require__.l`. This provides a fallback path: even if the `RuntimeModule` fails to take effect for some reason, the external hook can still take over.

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

## License

MIT
