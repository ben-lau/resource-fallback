---
title: Configuration Reference
---

# Configuration Reference

Full TypeScript types: [`packages/core/src/types.ts`](https://github.com/ben-lau/resource-fallback/blob/main/packages/core/src/types.ts).

Both Vite (`ViteResourceFallbackOptions`) and Webpack (`WebpackPluginOptions`) plugins use `PluginOptions`.

## PluginOptions

| Field                 | Type                              | Default              | Description                                                               |
| --------------------- | --------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `rules`               | `FallbackRule[]`                  | **Required**         | Fallback rule array, matched in order; last match wins for duplicates     |
| `defaults`            | `{ retry?, circuit? }`            | —                    | Default retry/circuit config for all rules                                |
| `debug`               | `boolean \| 'auto'`               | `'auto'`             | `true` always logs; `'auto'` controlled via `localStorage.__RF_DEBUG__`   |
| `sri`                 | `'strip' \| 'keep' \| 'strict'`   | `'strip'`            | Strategy for handling `integrity` during fallback                         |
| `enableDev`           | `boolean`                         | `false`              | Whether to activate in dev mode                                           |
| `nonce`               | `string`                          | —                    | CSP nonce appended to the injected `<script>` tag                         |
| `externalRuntime`     | `boolean`                         | `false`              | Load runtime as external script instead of inline                         |
| `externalRuntimePath` | `string`                          | `'/__rf/runtime.js'` | Path for the external runtime script                                      |
| `injectPreconnect`    | `boolean`                         | `true`               | Inject `<link rel="preconnect">` for each fallback domain                 |
| `htmlInject`          | `'head-prepend' \| 'head-append'` | `'head-prepend'`     | Position in `<head>` for injection                                        |
| `serviceWorker`       | `boolean \| ServiceWorkerOptions` | `false`              | Enable Hybrid SW for non-script subresources and controlled CSS `@import` |
| `hooks`               | `RuntimeHooks`                    | —                    | JS function hooks (only available in `externalRuntime` mode)              |
| `disableGlobals`      | `string[]`                        | `['__RF_DISABLE__']` | Additional kill-switch global variable names                              |
| `disableQueryParam`   | `string`                          | `'__rf'`             | Query param name that disables runtime when set to `off`                  |
| `disableCookie`       | `string`                          | `'__rf_disable'`     | Cookie name that disables runtime when set to `1`                         |

## FallbackRule

| Field     | Type                                   | Default      | Description                                                         |
| --------- | -------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `match`   | `string \| RegExp \| (url) => boolean` | **Required** | URL matching pattern. String uses prefix matching                   |
| `urls`    | `string[]`                             | **Required** | Ordered candidate URL prefix list. Last one is typically the origin |
| `retry`   | `RetryOptions`                         | See below    | Override retry config for this rule                                 |
| `circuit` | `CircuitOptions`                       | See below    | Override circuit breaker config for this rule                       |

::: tip match pattern

- **string** — prefix match (case-sensitive)
- **RegExp** — regex test against URL
- **function** — per-URL decision (build-time serialization supports string or RegExp only)
  :::

## RetryOptions

| Field       | Type      | Default | Description                        |
| ----------- | --------- | ------- | ---------------------------------- |
| `max`       | `number`  | `2`     | Max retries per URL                |
| `baseDelay` | `number`  | `300`   | Initial retry delay (ms)           |
| `maxDelay`  | `number`  | `3000`  | Exponential backoff delay cap (ms) |
| `jitter`    | `boolean` | `true`  | Add ±25% random jitter to delay    |

## CircuitOptions

| Field             | Type      | Default  | Description                                                       |
| ----------------- | --------- | -------- | ----------------------------------------------------------------- |
| `threshold`       | `number`  | `5`      | Consecutive failures on the same host before tripping the circuit |
| `cooldown`        | `number`  | `30000`  | Cooldown duration after circuit trip (ms), then retry             |
| `shareAcrossTabs` | `boolean` | `true`   | Share circuit state across tabs via `localStorage`                |
| `storageTtl`      | `number`  | `120000` | TTL for circuit entries in localStorage (ms)                      |

## ServiceWorkerOptions

Hybrid SW is disabled by default. When enabled, Vite/Webpack plugins generate a resource manifest and emit a SW asset. The SW bundle preloads manifest/config (preserving `RegExp` rule semantics), while the page runtime registers the SW, sends follow-up config updates, and bridges SW `postMessage` events into existing `rf:*` events.

```ts
resourceFallback({
  rules: [...],
  serviceWorker: {
    scope: '/',
    includeStyleImports: true,
    fallbackOnOpaque: false,
    cache: { enabled: true, cacheOpaque: false },
  },
});
```

| Field                 | Type      | Default                                                                 | Description                                                                                                                                                                  |
| --------------------- | --------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`             | `boolean` | `true` for object config                                                | Set to `false` to disable from an object config                                                                                                                              |
| `path`                | `string`  | Derived from `scope`, e.g. `/` → `/rf-sw.js`, `/app/` → `/app/rf-sw.js` | SW file path. Default stays inside scope to avoid requiring `Service-Worker-Allowed`                                                                                         |
| `scope`               | `string`  | `'/'`                                                                   | SW control scope                                                                                                                                                             |
| `includeStyleImports` | `boolean` | `true`                                                                  | Let SW handle CSS `@import` when `request.destination === 'style'` and referrer matches a CSS manifest asset                                                                 |
| `fallbackOnOpaque`    | `boolean` | `false`                                                                 | Treat cross-origin opaque responses as failures and continue fallback. Useful when CDN errors are hidden as opaque responses; may skip otherwise usable opaque CDN responses |
| `cache.enabled`       | `boolean` | `true`                                                                  | Write to Cache API after a fallback network response succeeds                                                                                                                |
| `cache.cacheOpaque`   | `boolean` | `false`                                                                 | Whether to cache opaque responses. Disabled by default                                                                                                                       |

::: info Cache policy
Conservative by design: only readable 2xx responses from successful fallback are cached; manifest-version cache is read only after network retry/fallback is exhausted; old `resource-fallback-*` caches are cleaned when a new manifest version activates. Manifest version includes resources, fallback rules, and key SW cache policy.
:::

::: warning SW circuit breaker isolation
The SW resolver always uses an isolated in-memory circuit breaker. Even if page-side `defaults.circuit.shareAcrossTabs` is `true`, the SW does not read or write `localStorage`. If the SW fetch chain ultimately rejects, it emits `rf:error` and returns `Response.error()`.
:::

## Example configuration

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
  defaults: {
    retry: { max: 2 },
    circuit: { threshold: 5, cooldown: 30000 },
  },
  debug: 'auto',
  sri: 'strip',
  nonce: 'my-csp-nonce',
  injectPreconnect: true,
  htmlInject: 'head-prepend',
});
```

## Related docs

- [Vite Integration](./vite.md)
- [Webpack Integration](./webpack.md)
- [Hybrid Service Worker](./service-worker.md)
- [CSP & SRI](./csp-sri.md)
