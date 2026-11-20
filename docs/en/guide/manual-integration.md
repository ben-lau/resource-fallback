---
title: Manual integration
description: Export the runtime, initialize custom HTML once, pass live hooks, and manage disposal.
---

# Manual integration

Plugin auto-injection users should subscribe with DOM `rf:*` events. Use manual initialization when you own the HTML startup sequence.

## Export the runtime

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

Run `node scripts/copy-rf-runtime.mjs` before the application build, then deploy the file. Load only the runtime IIFE below; do not call `buildInjectedTags()`, which also initializes the runtime and serializes callbacks.

## First installation {#first-install}

Put initialization in an external file and execute it before application entry:

```js
// public/__rf/bootstrap.js
window.__RF__.install({
  rules: [
    {
      base: 'https://cdn1.example.com/',
      urls: ['https://cdn2.example.com/', '/'],
      retry: { max: 1 },
    },
  ],
  hooks: {
    onFallback: (event) => console.info('resource fallback', event),
    onError: (event) => console.error('resource recovery ended', event),
  },
});
```

```html
<script src="/__rf/runtime.js"></script>
<script src="/__rf/bootstrap.js"></script>
<!-- Application entry follows; do not use async/defer on the initializers. -->
<script type="module" src="https://cdn1.example.com/assets/app.js"></script>
```

Authorize both initializer scripts in CSP. For `/app/` hosting, adjust deployed paths and script URLs together.

This example installs the page Observer. Vite dynamic-import rewriting, the Webpack RuntimeModule, and SW manifests still require their build integrations; copying runtime alone does not generate them. Existing auto-injected pages should use [DOM events](./runtime-events.md) and omit this second initializer.

## Installation and disposal

- `install()` is idempotent: a second call neither updates rules nor adds hooks.
- `dispose()` cancels page recovery and removes page listeners/global state; it does not immediately disable an existing worker. See [SW operations](./sw-operations.md).
- Do not dispose/reinstall for ordinary event subscription. If reinstallation is necessary, recreate the entire startup path and verify in-flight resources.

See the [Runtime API](../reference/runtime.md) for method availability.
