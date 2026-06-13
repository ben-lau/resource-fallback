---
title: Changelog
---

# Changelog

Combined release history for `@resource-fallback/core`, `@resource-fallback/vite-plugin`, and `@resource-fallback/webpack-plugin`.

Versions are released together via [release-please](https://github.com/googleapis/release-please). Package-specific notes are grouped under each version.

---

## 0.1.5

### @resource-fallback/core

**Patch Changes**

- Circuit breaker changed from global singleton to **per-rule** — different rules can use different `threshold` / `cooldown`; rule A failures no longer affect rule B
- Fixed fallback path parsing when `match` and `urls` disagree: when URL matches via `match` but not in `urls`, `urlIndex` starts at `-1` so `pickNextUrl` searches from `urls[0]`
- `resolve()` / `resolveBuiltUrl()` use per-rule breaker `isOpen` to skip tripped hosts
- `recordFailure` / `recordSuccess` find matching rule via `findPrepared` before operating on the correct breaker
- Runtime adds **`dispose()`** — uninstall page listeners and clean `window.__RF__`
- `installViteAdapter` returns `{ dispose() }` — removes `vite:preloadError` listener
- `installObserver` returns `{ dispose() }` — removes capture-phase `error` / `load` listeners
- `ensureGlobal()` returns `null` in non-browser environments (SSR / Worker) instead of throwing
- JSON serialization escapes `<` as `\x3c` to prevent injected `</script>` from closing the script tag
- **`joinAssetPrefix`** exported from core (moved from vite/webpack plugins) — unified slash handling for prefix + filename; fixes empty filename and absolute URL cases
- Kill-switch globals strictified: only `true` / `1` / `'1'` / `'true'` disable runtime
- Kill-switch cookie match changed from `indexOf` prefix to exact equality — avoids `__rf_disable=10` false triggers
- Removed `circuit-open` giveup reason — open circuit skips rule hosts rather than abandoning resolve; `ResolveResult` simplified to `'rules-exhausted' | 'no-match'`

### @resource-fallback/vite-plugin

**Patch Changes**

- Replaced sync file I/O with async `readFile` / `writeFile` to avoid blocking Vite build pipeline
- `base` read from `configResolved` instead of `config` — final resolved base after plugin overrides
- `shouldRewriteUrls` evaluation moved to `configResolved` using final base
- `joinAssetPrefix` imported from `@resource-fallback/core` — removed duplicate in plugin
- `es-module-lexer` `init` as module-level `lexerReady` — avoid repeated initialization
- `writeBundle` guards against empty `outDir`
- Updated dependencies: `@resource-fallback/core@0.1.5`

### @resource-fallback/webpack-plugin

**Patch Changes**

- `joinAssetPrefix` imported from `@resource-fallback/core` — removed duplicate in plugin
- Updated dependencies: `@resource-fallback/core@0.1.5`

---

## 0.1.4

### @resource-fallback/core

**Patch Changes**

- SW resolver shares same `createResolver` implementation as page-side resolver
- SW manifest asset lookup: `Array.some()` → `Set` via `buildManifestLookupSets`; results cached in `WeakMap`
- `fetchWithFallback` accepts external `resolver`; SW entry reuses shared instance
- SW default filename renamed from `sw.js` to **`rf-sw.js`** to avoid conflicts
- SW manifest trimmed: only `owner === 'sw'` and `type === 'style'` assets — smaller preload payload
- `createSwResolver` extracted from `fetchWithFallback` for SW entry reuse
- SW adapter **`unregisterStaleWorkers`**: when `serviceWorker.enabled` is false, unregister old rf-sw
- SW registration sets `updateViaCache: 'none'` and calls `registration.update()` for latest version

### @resource-fallback/vite-plugin · @resource-fallback/webpack-plugin

**Patch Changes**

- SW shared resolver, optimized lookup, trimmed manifest, renamed to `rf-sw`
- Updated dependencies: `@resource-fallback/core@0.1.4`

---

## 0.1.3

### @resource-fallback/core

**Patch Changes**

- Fixed CORS probe credentials: explicit `credentials: 'omit'` instead of `fetch(new Request(req, { mode: 'cors' }))` — avoids cookie-triggered CORS preflight failure
- Introduced **`corsVerifiedHosts`** (semantic inversion of prior `noCorsHosts`): after first successful CORS on a host, subsequent requests use cors mode directly; probe failure only then falls back to no-cors
- `fallbackOnOpaque` JSDoc expanded: cors probe for real status on no-cors requests, auto-degrade when CORS unavailable

### @resource-fallback/vite-plugin · @resource-fallback/webpack-plugin

**Patch Changes**

- Fixed SW CORS probe credentials issue
- Updated dependencies: `@resource-fallback/core@0.1.3`

---

## 0.1.2

### @resource-fallback/core

**Patch Changes**

- Fixed `fallbackOnOpaque` misjudging fallback CDN: opaque check only on primary CDN; fallback CDN opaque responses accepted best-effort — avoids infinite cascade
- Opaque responses no longer retried: `attempt = Infinity` skips retry budget and goes to fallback — same no-cors retry would only repeat opaque

### @resource-fallback/vite-plugin · @resource-fallback/webpack-plugin

**Patch Changes**

- Fixed SW unexpectedly overriding opaque responses
- Updated dependencies: `@resource-fallback/core@0.1.2`

---

## 0.1.1

### @resource-fallback/core

**Patch Changes**

- CORS probe host-level cache (`swNoCorsHosts`): after cors probe fails for a host, skip cors attempts on later requests
- `fallbackOnOpaque` fetcher tries cors first for inspectable status, degrades to no-cors — fixes images failing to fallback on opaque HTTP errors (502/503)

### @resource-fallback/vite-plugin · @resource-fallback/webpack-plugin

**Patch Changes**

- Fixed image and similar resource loading under CORS scenarios
- Updated dependencies: `@resource-fallback/core@0.1.1`

---

## 0.1.0

### @resource-fallback/core

**Minor Changes — Hybrid Service Worker**

Manifest-driven SW intercepts non-script resources (images, fonts, media, CSS subresources, controlled `@import`); scripts remain page-side adapters.

- `fetchWithFallback` core loop: retry → fallback → cache fallback
- `shouldHandleSwRequest` filters by destination and manifest
- SW preloads config via **`__RF_SW_PRELOAD__`** — avoids first-fetch manifest race
- SW events bridged to page via `postMessage` → HookBus
- Vite/Webpack plugins generate SW asset + manifest with preload script
- **`fallbackOnOpaque`**: treat cross-origin opaque as failure
- Cache API: only non-opaque 2xx after successful fallback; `cleanupOldFallbackCaches` for old versions

### @resource-fallback/vite-plugin

**Minor Changes**

- Hybrid SW: `generateBundle` emits `rf-sw.js` + manifest
- `renderBuiltUrl` rewrites matched URLs to `__RF__.url()`
- SW preload script injection

**Patch Changes**

- Updated dependencies: `@resource-fallback/core@0.1.0`

### @resource-fallback/webpack-plugin

**Minor Changes**

- Hybrid SW: `processAssets` emits `rf-sw.js` + manifest
- `RuntimeModule` injects SW preload script
- `chunkLoadingGlobal` config forwarding

**Patch Changes**

- Updated dependencies: `@resource-fallback/core@0.1.0`

---

## 0.0.4

### @resource-fallback/core

**Patch Changes**

- Fixed CSS dependency loss in async modules: Vite adapter `onPreloadError` tracks related dynamic chunks via `chunk.dynamicImports` so CSS deps aren't dropped on fallback path
- Vite plugin `writeBundle` uses `es-module-lexer` to replace matched dynamic import URLs with `__RF__.url()` calls

### @resource-fallback/vite-plugin · @resource-fallback/webpack-plugin

**Patch Changes**

- Fixed async module CSS dependency tracking
- Updated dependencies: `@resource-fallback/core@0.0.4`

---

## 0.0.3

### @resource-fallback/core

**Patch Changes**

- Fixed asset path joining: `swap()` used raw string concat — missing trailing `/` on prefix caused `...prodjs/x.js`; now uses **`joinAssetPrefix`**
- `resolveBuiltUrl` uses `joinAssetPrefix(rule.match, filename)`

### @resource-fallback/vite-plugin

**Patch Changes**

- Fixed Vite forcing match URLs on async chunks: `renderBuiltUrl` checks dynamic chunk scope — avoids rewriting non-matching resources
- Updated dependencies: `@resource-fallback/core@0.0.3`

### @resource-fallback/webpack-plugin

**Patch Changes**

- Fixed resource path joining
- Updated dependencies: `@resource-fallback/core@0.0.3`

---

## 0.0.2 — Initial release

### @resource-fallback/core

**Patch Changes**

- ES5 IIFE runtime: resolver, retry (exponential backoff + jitter), circuit-breaker (per-host + cooldown), observer (capture error/load + script/link replacement), kill-switch (global / cookie / query)
- `defineConfig` typed config helper
- `getRuntimeCode` IIFE generation
- `buildInjectedTags` for `<script>` / `<link rel="preconnect">`

### @resource-fallback/vite-plugin

**Patch Changes**

- Vite 4+ plugin: `experimental.renderBuiltUrl` → `__RF__.url()`
- `vite:preloadError` listener for preload failure retry/fallback
- `writeBundle` scans chunks and rewrites matched import URLs to runtime calls
- Updated dependencies: `@resource-fallback/core@0.0.2`

### @resource-fallback/webpack-plugin

**Patch Changes**

- Webpack 5+ plugin: `RuntimeModule` patches `__webpack_require__.l`
- `html-webpack-plugin` integration for automatic injection
- Forwards `chunkLoadingGlobal` to runtime
- Updated dependencies: `@resource-fallback/core@0.0.2`

---

See individual package changelogs on GitHub:

- [`packages/core/CHANGELOG.md`](https://github.com/ben-lau/resource-fallback/blob/main/packages/core/CHANGELOG.md)
- [`packages/vite-plugin/CHANGELOG.md`](https://github.com/ben-lau/resource-fallback/blob/main/packages/vite-plugin/CHANGELOG.md)
- [`packages/webpack-plugin/CHANGELOG.md`](https://github.com/ben-lau/resource-fallback/blob/main/packages/webpack-plugin/CHANGELOG.md)
