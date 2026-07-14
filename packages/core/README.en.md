# @resource-fallback/core

> **[中文](README.md)** | English

Browser runtime + Node utility functions — the core package of the `resource-fallback` solution.

End users typically don't need to depend on this package directly — install [`@resource-fallback/vite-plugin`](../vite-plugin) or [`@resource-fallback/webpack-plugin`](../webpack-plugin) instead. Only use this directly when you need custom integration or manual runtime injection.

## Installation

```bash
pnpm add @resource-fallback/core
```

## Node API

```ts
import {
  defineConfig,
  buildInjectedTags,
  getRuntimeCode,
  getRuntimePath,
  serialiseConfig,
} from '@resource-fallback/core';
```

| Function                  | Description                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `defineConfig(opts)`      | Identity helper for type-safe config authoring                                          |
| `getRuntimePath()`        | Returns the absolute path to the IIFE runtime file                                      |
| `getRuntimeCode()`        | Returns the IIFE runtime file as a string (cached after first call)                     |
| `buildInjectedTags(opts)` | Builds the `<script>` / `<link>` tag descriptors to inject into HTML based on config    |
| `serialiseConfig(cfg)`    | Serializes runtime config to a JSON string suitable for embedding in the page           |

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

## Browser Runtime

The runtime is injected as an IIFE (~5KB gzip) and exposes its interface via `window.__RF__`:

```ts
interface RfGlobal {
  install(config: RuntimeConfig): void;
  url(filename: string): string;
  load(filename: string): Promise<unknown>; // Vite only
  resolver?: Resolver;
  installed: boolean;
  version: string;
}
```

### Runtime Modules

| Module               | Responsibility                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **entry**            | Initializes the `window.__RF__` global object, dispatches adapter installation                                                                                        |
| **observer**         | Listens for `error` events on `window` (capture phase), intercepts `<script>` and `<link rel="stylesheet">` load failures, replaces with retry/fallback URLs in-place |
| **resolver**         | Rule matching engine, decides next action (retry / fallback / giveup)                                                                                                 |
| **circuit**          | Per-host circuit breaker with `localStorage` cross-tab state sharing                                                                                                  |
| **retry**            | Exponential backoff delay calculation (`baseDelay × 2^(attempt-1)`), optional ±25% jitter                                                                             |
| **hooks**            | Event bus; dispatches both DOM `CustomEvent` and JS function hooks                                                                                                    |
| **kill-switch**      | Triple kill-switch detection (global variable / query parameter / cookie)                                                                                             |
| **logger**           | Optional logging output, supports `debug: 'auto'` (controlled via `localStorage.__RF_DEBUG__`)                                                                        |
| **adapter-vite**     | Vite dynamic import fallback loop (`__RF__.load`) + `vite:preloadError` handling                                                                                      |
| **adapter-webpack**  | Intercepts `chunkLoadingGlobal` `push` method + wraps `__webpack_require__.l`                                                                                         |
| **adapter-systemjs** | Hooks `System.constructor.prototype.instantiate` for legacy bundle fallback                                                                                           |

### Observer Behavior Details

- Only handles `error` events on top-level `<script>` and `<link rel="stylesheet">`
- Automatically skips `<link rel="preload|prefetch|modulepreload">` and other preload hints
- Automatically skips `<script>` tags with `data-webpack` attribute (handled by webpack adapter)
- Automatically skips URLs in `systemjsManagedUrls` (handled by systemjs adapter)
- ES Module scripts add `__rf=` query parameter on retry to bypass browser module cache
- Classic scripts and CSS do not add cache-bust parameters to avoid reducing CDN cache hit rates
- Replacement tags use `createElement` instead of `cloneNode` to avoid the browser's "already started" flag

### Events

The runtime dispatches DOM `CustomEvent` at each decision point:

| Event         | When Fired                        | `event.detail`                                   |
| ------------- | --------------------------------- | ------------------------------------------------ |
| `rf:retry`    | Same URL retried                  | `{ url: string, attempt: number }`               |
| `rf:fallback` | Switched to next candidate URL    | `{ from: string, to: string, reason?: unknown }` |
| `rf:success`  | Resource loaded after fallback    | `{ url: string, attempts: number }`              |
| `rf:error`    | All candidates exhausted (giveup) | `{ url: string, reason?: unknown }`              |

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
  ErrorEvent,
  FallbackEvent,
  FallbackRule,
  HtmlTag,
  HtmlTagAttributes,
  PluginOptions,
  ResolveResult,
  RetryEvent,
  RetryOptions,
  RuntimeConfig,
  RuntimeHooks,
  SriPolicy,
  SuccessEvent,
} from '@resource-fallback/core';
```

## License

MIT
