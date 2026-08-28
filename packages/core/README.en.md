# @resource-fallback/core

> **[中文](README.md)** | English

Browser runtime + Node utility functions — the core package of the `resource-fallback` solution.

End users typically don't need to depend on this package directly — install [`@resource-fallback/vite-plugin`](../vite-plugin) or [`@resource-fallback/webpack-plugin`](../webpack-plugin) instead. Only use this directly when you need custom integration or manual runtime injection.

## Installation

```bash
pnpm add @resource-fallback/core
```

## Common Node APIs

```ts
import {
  defineConfig,
  buildInjectedTags,
  getRuntimeCode,
  getRuntimePath,
  getServiceWorkerCode,
  getServiceWorkerPath,
  buildResourceFallbackManifest,
  buildServiceWorkerAssets,
  serialiseConfig,
} from '@resource-fallback/core';
```

| Function                                   | Description                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `defineConfig(opts)`                       | Identity helper for type-safe config authoring                                                                    |
| `getRuntimePath()`                         | Returns the absolute path to the IIFE runtime file                                                                |
| `getRuntimeCode()`                         | Returns the IIFE runtime file as a string (cached after first call)                                               |
| `getServiceWorkerPath()`                   | Returns the absolute path to the Service Worker runtime file                                                      |
| `getServiceWorkerCode()`                   | Returns the Service Worker runtime file as a string (cached after first call)                                     |
| `buildResourceFallbackManifest(input)`     | Builds a stable-version resource manifest from a version seed, rules, and asset list                              |
| `buildServiceWorkerAssets(options, input)` | Builds a Service Worker artifact with preloaded manifest/config; returns `null` when SW is disabled               |
| `buildInjectedTags(opts)`                  | Builds the `<script>` / `<link>` tag descriptors to inject into HTML; serializes config and drops function values |
| `serialiseConfig(cfg)`                     | Serializes runtime config to a page-safe JSON string; function fields are not preserved                           |

### defineConfig

```ts
import { defineConfig } from '@resource-fallback/core';

export default defineConfig({
  rules: [
    {
      base: 'https://cdn.example.com/',
      urls: ['https://backup.example.com/', '/'],
      retry: { max: 2, baseDelay: 300 },
      circuit: { threshold: 3 },
    },
  ],
  debug: 'auto',
});
```

### buildInjectedTags

Manually inject the runtime for custom plugins / build pipelines:

```ts
import { buildInjectedTags } from '@resource-fallback/core';

const tags = buildInjectedTags({
  rules: [{ base: 'https://cdn.example.com/', urls: ['/'] }],
  nonce: 'abc123',
  injectPreconnect: true,
});

// tags structure example:
// [
//   { tagName: 'link', attributes: { rel: 'preconnect', href: 'https://cdn.example.com', crossorigin: 'anonymous' } },
//   { tagName: 'script', attributes: { nonce: 'abc123' }, innerHTML: '<IIFE code>;window.__RF__.install({...})' },
// ]
```

Note: `buildInjectedTags()` and plugin-generated `window.__RF__.install(...)` calls always serialize config before it reaches the page. Functions inside `hooks` — and any other function-valued fields — are dropped at that step. `externalRuntime` externalizes only the runtime IIFE; the automatic `install(...)` call is still an inline script and needs a nonce or equivalent authorization under a strict CSP. It also does not preserve those functions. For auto-injected setups, prefer DOM `rf:*` events. Use JS hooks only when you manually call `window.__RF__.install()` in page code.

## Browser Runtime

The runtime is injected as an IIFE (currently ~10KB gzip; use the built artifact as the source of truth) and exposes its interface via `window.__RF__`:

```ts
interface RfGlobal {
  install(config: RuntimeConfig): void;
  url(filename: string): string;
  load(filename: string): Promise<unknown>; // Vite only
  dispose(): void;
  installed: boolean;
  version: string;
}
```

### Runtime Modules

| Module               | Responsibility                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **entry**            | Initializes `window.__RF__`, creates the shared RecoveryCoordinator / ownership / lifecycle services, and dispatches adapter installation    |
| **observer**         | Listens for `error` events on `window` (capture phase) and hands `<script>` and `<link rel="stylesheet">` failures to the shared coordinator |
| **coordinator**      | The page-side decision engine for rule matching, retry, fallback, circuit breaking, deadlines, cancellation, and recovery events             |
| **circuit**          | Per-host circuit state; the page runtime currently creates a single registry with `localStorage` cross-tab sharing                           |
| **retry**            | Exponential backoff delay calculation (`baseDelay × 2^(attempt-1)`), optional ±25% jitter                                                    |
| **hooks**            | Event bus; dispatches both DOM `CustomEvent` and JS function hooks                                                                           |
| **kill-switch**      | Triple kill-switch detection (global variable / query parameter / cookie)                                                                    |
| **logger**           | Optional logging output, supports `debug: 'auto'` (controlled via `localStorage.__RF_DEBUG__`)                                               |
| **adapter-vite**     | Runs Vite dynamic imports (`__RF__.load`) through the shared coordinator + `vite:preloadError` handling                                      |
| **adapter-webpack**  | Intercepts `chunkLoadingGlobal` `push` method + wraps `__webpack_require__.l`                                                                |
| **adapter-systemjs** | Hooks `System.constructor.prototype.instantiate` for legacy bundle fallback                                                                  |

### Observer Behavior Details

- Only handles `error` events on top-level `<script>` and `<link rel="stylesheet">`
- Automatically skips `<link rel="preload|prefetch|modulepreload">` and other preload hints
- Automatically skips `<script>` tags with `data-webpack` attribute (handled by webpack adapter)
- Uses the shared ownership registry to avoid competing with Webpack/SystemJS adapters for the same resource
- ES Module scripts add `__rf=` query parameter on retry to bypass browser module cache
- Classic scripts and CSS do not add cache-bust parameters to avoid reducing CDN cache hit rates
- Replacement tags use `createElement` instead of `cloneNode` to avoid the browser's "already started" flag

### Shared recovery and current rule limits

- The page-side RecoveryCoordinator shares one in-flight recovery Promise per `owner + logical resource key`
- Calls from the same owner for the same logical resource join the same retry/fallback chain; different owners or logical keys stay independent
- The ownership registry prevents Observer and Vite / Webpack / SystemJS adapters from independently taking over the same logical resource
- Rules are compiled with longer `base` prefixes first
- `window.__RF__.url(filename)` always constructs the initial URL from the first compiled rule's `base`; it is not circuit-aware
- The page runtime currently initializes one circuit registry from the first compiled rule's circuit options; the Service Worker still uses the legacy resolver terminology, with isolated in-memory circuit state

### Events

The runtime dispatches DOM `CustomEvent` at each decision point:

| Event         | When Fired                                           | `event.detail`                                   |
| ------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `rf:retry`    | Same URL retried                                     | `{ url: string, attempt: number }`               |
| `rf:fallback` | Switched to next candidate URL                       | `{ from: string, to: string, reason?: unknown }` |
| `rf:success`  | A recovered page-side session succeeds               | `{ url: string, attempts: number }`              |
| `rf:error`    | A page-side session fails, or an SW error is bridged | `{ url: string, reason?: unknown }`              |

## Exports

```jsonc
// package.json exports
{
  ".": "Node API (defineConfig / buildInjectedTags / types, etc.)",
  "./runtime": "Browser IIFE runtime file (runtime.iife.js)",
}
```

## Type Exports

```ts
export type {
  CircuitOptions,
  BuildInjectedTagsOptions,
  ErrorEvent,
  FallbackEvent,
  FallbackRule,
  HtmlTag,
  HtmlTagAttributes,
  NormalizedServiceWorkerOptions,
  PluginOptions,
  ResolveResult,
  ResourceFallbackAssetOwner,
  ResourceFallbackAssetType,
  ResourceFallbackManifest,
  ResourceFallbackManifestAsset,
  RetryEvent,
  RetryOptions,
  RuntimeConfig,
  RuntimeHooks,
  ServiceWorkerOptions,
  SriPolicy,
  SuccessEvent,
} from '@resource-fallback/core';
```

## License

MIT
