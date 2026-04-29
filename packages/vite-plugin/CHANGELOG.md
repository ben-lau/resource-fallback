# @resource-fallback/vite-plugin

## 0.0.4

### Patch Changes

- fix the lack deps of css bundles
- Updated dependencies
  - @resource-fallback/core@0.0.4

## 0.0.3

### Patch Changes

- db39ae0: fix vite bug
- fix the asset path join bug
- Updated dependencies [db39ae0]
- Updated dependencies
  - @resource-fallback/core@0.0.3

## 0.0.2

### Patch Changes

- 7927832: initial version
- 95e33ca: Initial 0.0.1 release.

  - `@resource-fallback/core`: ES5 IIFE runtime, resolver / retry / circuit-breaker / observer / kill-switch, `defineConfig` + `getRuntimeCode` + `buildInjectedTags` Node helpers.
  - `@resource-fallback/webpack-plugin`: Webpack 5+ plugin with `RuntimeModule` injection patching `__webpack_require__.l`, html-webpack-plugin integration, automatic `chunkLoadingGlobal` forwarding.
  - `@resource-fallback/vite-plugin`: Vite 4+ plugin wiring `experimental.renderBuiltUrl` to `__RF__.url()` and listening to `vite:preloadError`.

- Updated dependencies [7927832]
- Updated dependencies [95e33ca]
  - @resource-fallback/core@0.0.2
