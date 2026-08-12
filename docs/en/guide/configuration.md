---
title: Configuration Reference
---

# Configuration Reference

Full TypeScript types: [`packages/core/src/types.ts`](https://github.com/ben-lau/resource-fallback/blob/main/packages/core/src/types.ts).

Both Vite (`ViteResourceFallbackOptions`) and Webpack (`WebpackPluginOptions`) plugins use `PluginOptions`.

## PluginOptions

| Field                 | Type                              | Default              | Description                                                                                          |
| --------------------- | --------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `rules`               | `FallbackRule[]`                  | **Required**         | Fallback rules; compilation sorts by descending `base` length so longer prefixes match first         |
| `defaults`            | `{ retry?, circuit? }`            | —                    | Default retry/circuit config for all rules                                                           |
| `debug`               | `boolean \| 'auto'`               | `'auto'`             | `true` always logs; `'auto'` controlled via `localStorage.__RF_DEBUG__`                              |
| `sri`                 | `'strip' \| 'keep' \| 'strict'`   | `'strip'`            | Strategy for handling `integrity` during fallback                                                    |
| `enableDev`           | `boolean`                         | `false`              | Whether to activate in dev mode                                                                      |
| `nonce`               | `string`                          | —                    | CSP nonce appended to the injected `<script>` tag                                                    |
| `externalRuntime`     | `boolean`                         | `false`              | Changes script placement only; it does not preserve function hooks from build config                 |
| `externalRuntimePath` | `string`                          | `'/__rf/runtime.js'` | Path for the external runtime script                                                                 |
| `injectPreconnect`    | `boolean`                         | `true`               | Inject `<link rel="preconnect">` for each fallback domain                                            |
| `htmlInject`          | `'head-prepend' \| 'head-append'` | `'head-prepend'`     | Position in `<head>` for injection                                                                   |
| `serviceWorker`       | `boolean \| ServiceWorkerOptions` | `false`              | Enable Hybrid SW for non-script subresources and controlled CSS `@import`                            |
| `hooks`               | `RuntimeHooks`                    | —                    | Functions are dropped during serialized injection; for auto-injected setups prefer DOM `rf:*` events |
| `disableGlobals`      | `string[]`                        | `['__RF_DISABLE__']` | Additional kill-switch global variable names                                                         |
| `disableQueryParam`   | `string`                          | `'__rf'`             | Query param name that disables runtime when set to `off`                                             |
| `disableCookie`       | `string`                          | `'__rf_disable'`     | Cookie name that disables runtime when set to `1`                                                    |

## FallbackRule

| Field     | Type             | Default      | Description                                                                                                                                                                                                                              |
| --------- | ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`    | `string`         | **Required** | Asset URL prefix (case-sensitive). Used for: prefix-matching failed URLs, stripping the path for candidate swap, and Vite bare filename → CDN URL. May differ from `urls`: `base` is the first-load prefix; `urls` is the fallback chain |
| `urls`    | `string[]`       | **Required** | Ordered candidate URL prefix list (fallback chain). Last one is typically the origin                                                                                                                                                     |
| `retry`   | `RetryOptions`   | See below    | Override retry config for this rule                                                                                                                                                                                                      |
| `circuit` | `CircuitOptions` | See below    | Override circuit breaker config for this rule                                                                                                                                                                                            |

::: tip rule `base` vs Vite `base`

Vite's config `base` and `FallbackRule.base` share a name: call them Vite `base` vs rule `base` in prose. Vite `base` / Webpack `publicPath` should equal `rules[].base`. `base` and `urls` may differ — `base` is the first-load prefix; `urls` is the fallback chain. RegExp / function matchers are no longer supported.
:::

Current page-side rule and circuit behavior is more specific than the public type suggests:

- `window.__RF__.url(filename)` builds the initial URL from the first compiled rule's `base`; it is not circuit-aware;
- a recovery session first selects one rule from the initial URL, then walks that rule's ordered `urls` candidates;
- the page runtime currently has one circuit registry, initialized from the first compiled rule's circuit options. `FallbackRule.circuit` remains public, but independent per-rule page circuits are not implemented yet.

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

The page-side RecoveryCoordinator also shares one in-flight recovery Promise per `owner + logical resource key`. Calls from the same owner for the same logical resource join the same recovery chain; different owners or different logical keys do not share work. The ownership registry prevents Observer and builder-specific adapters from independently taking over the same logical resource.

## Hooks and serialization limits

`buildInjectedTags()` and plugin-generated `window.__RF__.install(...)` calls both serialize the config before it reaches the page, and function values are dropped during that step. So:

- `hooks` in build config do not survive automatic injection;
- `externalRuntime` only changes whether the runtime script is inline or external, not the serialization behavior;
- DOM `rf:*` events are the recommended monitoring path for auto-injected setups;
- use JS hooks only when you manually call `window.__RF__.install()` in page code and pass live function objects yourself.

## ServiceWorkerOptions

Hybrid SW is disabled by default. When enabled, Vite/Webpack plugins generate a resource manifest and emit a SW asset. The SW bundle preloads manifest/config, while the page runtime registers the SW, sends follow-up config updates, and bridges SW `postMessage` events into existing `rf:*` events.

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
      base: 'https://cdn.example.com/',
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
