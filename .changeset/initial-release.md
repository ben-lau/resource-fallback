---
'@resource-fallback/core': patch
'@resource-fallback/webpack-plugin': patch
'@resource-fallback/vite-plugin': patch
---

Initial 0.0.1 release.

- `@resource-fallback/core`: ES5 IIFE runtime, resolver / retry / circuit-breaker / observer / kill-switch, `defineConfig` + `getRuntimeCode` + `buildInjectedTags` Node helpers.
- `@resource-fallback/webpack-plugin`: Webpack 5+ plugin with `RuntimeModule` injection patching `__webpack_require__.l`, html-webpack-plugin integration, automatic `chunkLoadingGlobal` forwarding.
- `@resource-fallback/vite-plugin`: Vite 4+ plugin wiring `experimental.renderBuiltUrl` to `__RF__.url()` and listening to `vite:preloadError`.
