---
title: Browser runtime API
description: Installation, URL construction, Vite loading, status checks, and disposal for window.__RF__.
---

# Browser runtime API

The runtime IIFE creates `window.__RF__` in the browser. Plugins normally initialize it automatically; applications observe recovery through DOM events.

## Status and version {#status}

```js
console.log(window.__RF__?.version);
console.log(window.__RF__?.installed);
```

`installed` is only an installation marker. It can be true when a kill switch disables recovery. Verify a managed failure and observe retry/fallback events to establish that recovery is connected.

## install(config) {#install}

Accepts `RuntimeConfig`. The first call creates adapters, circuits, and events. Invalid configuration throws. A repeated call after installation returns without updating rules or hooks.

Automatic plugin injection serializes configuration and drops function values. For live hooks, load an uninstalled runtime and pass callbacks to its first browser installation; see [Manual integration](../guide/manual-integration.md).

## url(filename) and load(filename) {#loading}

`url(filename)` prefixes bare filenames with the first compiled rule's base. Rules are sorted by descending base length. Absolute http(s) URLs and paths starting with `/` remain unchanged. This method neither checks circuits nor performs a request.

`load(filename)` is installed by the Vite adapter for rewritten dynamic imports and returns a module Promise. Terminal recovery rejects and may emit `rf:error` first. Do not assume this method exists when a kill switch is active.

```js
const runtime = window.__RF__;
if (runtime && typeof runtime.load === 'function') {
  const module = await runtime.load('assets/route-HASH.js');
  console.log(module);
}
```

Keep ordinary framework dynamic imports in application code. `window.__RF__.internal` is a private bundler bridge, not an application integration API.

## dispose() {#dispose}

Cancels in-flight page recovery, removes listeners, and clears the global object. Old recovery work cannot affect the next installation. Manage worker registrations and controlled clients separately; see SW operations.

## TypeScript integration {#typescript}

The package does not augment global `Window` or `WindowEventMap`. For manual usage, declare only the surface your application uses:

```ts
import type { RuntimeConfig } from '@resource-fallback/core';

declare global {
  interface Window {
    __RF__?: {
      version: string;
      installed: boolean;
      install(config: RuntimeConfig): void;
      url(filename: string): string;
      load?: (filename: string) => Promise<unknown>;
      dispose(): void;
    };
  }
}
```

See [Runtime events](../guide/runtime-events.md) for DOM event typing and payload semantics.
