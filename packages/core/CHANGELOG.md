# @resource-fallback/core

## 0.1.0

### Minor Changes

- 207f03f: Add opt-in Hybrid Service Worker fallback support for non-script resources.

  This release adds manifest-based Service Worker interception for images, fonts, media, CSS subresources, and controlled CSS imports while keeping script loading owned by the existing page-side adapters. It also emits SW assets from both Vite and Webpack plugins, preloads SW configuration to avoid first-load races, hardens SW event delivery and error handling, and documents the new behavior with examples and tests.

## 0.0.4

### Patch Changes

- fix the lack deps of css bundles

## 0.0.3

### Patch Changes

- db39ae0: fix vite bug
- fix the asset path join bug

## 0.0.2

### Patch Changes

- 7927832: initial version
- 95e33ca: Initial 0.0.1 release.

  - `@resource-fallback/core`: ES5 IIFE runtime, resolver / retry / circuit-breaker / observer / kill-switch, `defineConfig` + `getRuntimeCode` + `buildInjectedTags` Node helpers.
  - `@resource-fallback/webpack-plugin`: Webpack 5+ plugin with `RuntimeModule` injection patching `__webpack_require__.l`, html-webpack-plugin integration, automatic `chunkLoadingGlobal` forwarding.
  - `@resource-fallback/vite-plugin`: Vite 4+ plugin wiring `experimental.renderBuiltUrl` to `__RF__.url()` and listening to `vite:preloadError`.
