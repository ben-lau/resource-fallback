---
title: Production deployment
description: Align CDN and origin paths, publish identical artifacts, deploy the external runtime, and verify recovery and rollback.
outline: [2, 3]
---

# Production deployment

Publish the same build artifacts to every candidate path before publishing the HTML that references them. This example uses an `/app/` deployment.

## Align paths {#paths}

| Item                                      | Example                                          |
| ----------------------------------------- | ------------------------------------------------ |
| Page                                      | `https://app.example.com/app/`                   |
| Vite `base` / Webpack `output.publicPath` | `https://cdn1.example.com/app/`                  |
| Rule `base`                               | `https://cdn1.example.com/app/`                  |
| Candidates                                | `https://cdn2.example.com/app/`, `/app/`         |
| Build file                                | `assets/app-HASH.js`                             |
| Required origin resource                  | `https://app.example.com/app/assets/app-HASH.js` |

```ts
resourceFallback({
  rules: [
    {
      base: 'https://cdn1.example.com/app/',
      urls: ['https://cdn2.example.com/app/', '/app/'],
      retry: { max: 1 },
    },
  ],
});
```

Fallback replaces the entire `base` and retains `assets/app-HASH.js`. `'/'` means the page origin root; use `'/app/'` when files are deployed there. Check the [URL prefix preview](./url-preview.md).

## Publish and retain old artifacts {#release}

1. Build once and synchronize identical hashed JS, CSS, and subresources to every CDN and the origin. SRI requires identical contents.
2. Check each URL for real resource contents, the correct `Content-Type`, and the CORS/CSP required by the application.
3. Publish HTML after candidates are ready. Retain old hashed assets for clients with cached HTML or already-open pages; choose retention according to application cache and session lifetimes.
4. Open an unloaded route from an old page and verify its old chunk remains available. Before rollback, confirm the previous resources exist, then restore the matching HTML and configuration.

The origin fallback path must actually serve the file instead of forwarding back to the failed CDN. Missing static files should return 404 rather than the SPA HTML with status 200.

## Deploy an external runtime {#external-runtime}

`externalRuntime` generates a reference; deploy the runtime file yourself. Add a direct build dependency and export the file before building the application:

```bash
pnpm add -D @resource-fallback/core
```

```js
// scripts/copy-rf-runtime.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { getRuntimeCode } from '@resource-fallback/core';

await mkdir('public/__rf', { recursive: true });
await writeFile('public/__rf/runtime.js', getRuntimeCode());
```

```ts
resourceFallback({
  externalRuntime: true,
  externalRuntimePath: '/app/__rf/runtime.js',
  rules: [
    {
      base: 'https://cdn1.example.com/app/',
      urls: ['https://cdn2.example.com/app/', '/app/'],
    },
  ],
});
```

Vite copies public files into build output. For Webpack, publish this file to the same URL in your deployment step. Verify the runtime and subsequent initializer execute before application entry. Strict CSP must still authorize the automatic inline `install(...)`.

## Per-response nonce {#nonce}

The `nonce` option is a string, not an automatic dynamic value:

1. Use a dedicated build placeholder such as `nonce: '__RF_NONCE__'`.
2. Generate a new cryptographically secure random value for each HTML response at the server/edge, replacing the injected placeholder.
3. Use that same value in the response's CSP `script-src 'nonce-value'` and authorize the actual resource origins.
4. Ensure HTML caching never pairs an old nonce in the HTML with a new nonce in the header.

For static hosting without response transformation, evaluate CSP hash authorization or [manual external initialization](./manual-integration.md). See [CSP and SRI](./csp-sri.md).

## Release acceptance {#verification}

| Scenario               | Verify                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| Healthy primary        | First attempt succeeds, without recovery events                   |
| Blocked primary        | Backup actually succeeds; events match Network                    |
| Blocked CDNs           | Origin path, response body, and MIME are correct                  |
| All candidates fail    | Entry degradation or route error boundary appears; no reload loop |
| Old page opens a route | Old hashed files remain available                                 |
| Hybrid SW              | First/controlled visits and cold/warm caches checked separately   |

See [Quick start](./quick-start.md#verification) for fault injection and [SW operations](./sw-operations.md) for update and shutdown.
