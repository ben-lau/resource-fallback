# Vite + Vue Example

> **[中文](README.md)** | English

Demonstrates full integration of `@resource-fallback/vite-plugin` in a Vue 3 application, including:

- Vue Router lazy-loaded routes (`() => import('./views/About.vue')`)
- `defineAsyncComponent` async components
- `@vitejs/plugin-legacy` generated SystemJS legacy bundles
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

```ts
// vite.config.ts
{
  base: 'http://cdn-primary.example.invalid/',  // build output URL prefix
  plugins: [
    resourceFallback({
      rules: [{
        match: 'http://cdn-primary.example.invalid/',  // matches base
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

## Running

```bash
# From monorepo root
pnpm install
pnpm build                   # Build packages first

# Build example
pnpm --filter @resource-fallback-example/vite-vue build

# Start preview server
pnpm --filter @resource-fallback-example/vite-vue start
```

Open http://127.0.0.1:4174 and switch between routes to observe async chunk fallback behavior.

Open DevTools → Network panel to see:
1. Requests to `cdn-primary.example.invalid` fail
2. Runtime retries → switches to `cdn-secondary` → then `cdn-backup` → finally origin `/`
3. Origin fallback succeeds, page renders normally

The in-page event panel shows all `rf:*` events in real time.

> **Note**: Vite dev server (`vite dev`) does not support dynamic import fallback interception. Use `vite preview` or `vite build` to verify.

## E2E Tests

```bash
# Install Playwright browsers
pnpm --filter @resource-fallback-example/vite-vue exec playwright install

# Run tests
pnpm --filter @resource-fallback-example/vite-vue test:e2e
```

Test coverage:
- Full retry → fallback → origin chain for entry scripts
- Async chunk fallback on route switches
- Event order verification (retry → fallback → success)
- No console errors
