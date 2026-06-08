# Webpack + React Example

> **[中文](README.md)** | English

Demonstrates full integration of `@resource-fallback/webpack-plugin` in a React 18 application, including:

- `React.lazy()` + `<Suspense>` async component loading
- `ErrorBoundary` fallback for chunk load failures
- Entry script `rf:error` white screen fallback
- Runtime event panel, showing `rf:retry` / `rf:fallback` / `rf:success` / `rf:error` events in real time

## Fallback Chain

```
cdn-primary.example.invalid  (DNS always fails)
        ↓ retry 1 time
cdn-secondary.example.invalid (DNS always fails)
        ↓ retry 1 time
cdn-backup.example.invalid    (DNS always fails)
        ↓ retry 1 time
/                             (origin fallback, same-origin request, succeeds)
```

Uses `.invalid` domains (RFC 2606 reserved) — DNS always fails, no mock server needed to observe the full fallback chain.

## Configuration

```js
// webpack.config.cjs
{
  output: {
    publicPath: 'http://cdn-primary.example.invalid/',  // build output URL prefix
  },
  plugins: [
    new ResourceFallbackWebpackPlugin({
      rules: [{
        match: 'http://cdn-primary.example.invalid/',  // matches publicPath
        urls: [
          'http://cdn-secondary.example.invalid/',     // backup CDN 1
          'http://cdn-backup.example.invalid/',         // backup CDN 2
          '/',                                          // origin fallback
        ],
        retry: { max: 1, baseDelay: 300, maxDelay: 1000, jitter: false },
        circuit: { threshold: 2, cooldown: 15_000, storageTtl: 60_000 },
      }],
      debug: true,
    }),
  ],
}
```

## Error Handling

This example demonstrates two layers of fallback:

### 1. Entry Script Failure → White Screen Fallback

An inline `rf:error` listener in `index.html`. When all fallbacks fail for the entry bundle, React won't initialize. The inline script displays a degraded UI (error message + refresh button).

### 2. Async Chunk Failure → ErrorBoundary

`React.lazy()` throws an error when chunk loading fails. `<Suspense>` only handles loading state, not errors. This example uses a `ChunkErrorBoundary` component to catch errors and display a retry UI, preventing the entire app from crashing.

## Running

```bash
# From monorepo root
pnpm install
pnpm build                   # Build packages first

# Build example
pnpm --filter @resource-fallback-example/webpack-react build

# Start static server
pnpm --filter @resource-fallback-example/webpack-react start
```

Open http://127.0.0.1:4173 and click the "Load Lazy Module" button to observe async chunk fallback behavior.

Open DevTools → Network panel to see:

1. Entry script requests to `cdn-primary.example.invalid` fail
2. Webpack adapter retries → switches to `cdn-secondary` → then `cdn-backup` → finally origin `/`
3. Origin fallback succeeds, React app renders normally
4. Clicking load async module triggers the same fallback chain again

The in-page event panel shows all `rf:*` events in real time.

## E2E Tests

```bash
# Install Playwright browsers
pnpm --filter @resource-fallback-example/webpack-react exec playwright install

# Run tests
pnpm --filter @resource-fallback-example/webpack-react test:e2e
```

Test coverage:

- Full retry → fallback → origin chain for entry scripts
- Sequential loading and fallback for multiple `React.lazy()` components
- Event order verification
- Circuit breaker state persistence across multiple loads
- No uncaught exceptions
