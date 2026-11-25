---
title: API navigation
description: Find Resource Fallback APIs by plugin configuration, browser runtime, Node build helpers, and Service Worker tasks.
---

# API navigation

Find the interface for your task before opening full generated types. Most auto-injected integrations only need plugin configuration and DOM events.

## Plugin configuration

| Task                              | Interface and guide                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install and verify                | [Vite](../guide/vite.md), [Webpack](../guide/webpack.md), [Quick start](../guide/quick-start.md)                                                                    |
| Configure prefixes/candidates     | [PluginOptions / FallbackRule](../guide/configuration.md), [URL preview](../guide/url-preview.md)                                                                   |
| Retry and circuit settings        | [RetryOptions](../guide/configuration.md#retryoptions), [CircuitOptions](../guide/configuration.md#circuitoptions), [deadlines](../guide/configuration.md#timeouts) |
| Recover images/fonts/subresources | [Hybrid SW](../guide/service-worker.md), [Coverage](../guide/coverage.md)                                                                                           |

## Browser runtime

| Task                                | Interface and guide                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Inspect version/install marker      | [`window.__RF__`](./runtime.md#status)                                                    |
| First initialization and live hooks | [`install()`](./runtime.md#install), [manual integration](../guide/manual-integration.md) |
| Vite loading and URL construction   | [`load()` / `url()`](./runtime.md#loading)                                                |
| Dispose page runtime                | [`dispose()`](./runtime.md#dispose)                                                       |
| Monitor recovery                    | [DOM events](../guide/runtime-events.md), with page/SW semantics                          |

## Node build helpers

| Interface                                                                         | Purpose                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`defineConfig()`](../api/index.md#defineconfig)                                  | Preserve configuration inference                              |
| [`getRuntimeCode()`](../api/index.md#getruntimecode)                              | Read the deployable browser IIFE                              |
| [`buildInjectedTags()`](../api/index.md#buildinjectedtags)                        | Generate tags and auto-initialize; function hooks are dropped |
| [`buildServiceWorkerAssets()`](../api/service-worker.md#buildserviceworkerassets) | Generate SW and manifest for a custom build                   |

## Full generated reference

- [Functions and helpers](../api/index.md): complete Node exports.
- [Types and interfaces](../api/types.md): fields, inheritance, and source links.
- [Service Worker helpers](../api/service-worker.md): manifest and worker build APIs.

TypeDoc generates this reference from source. Some generated comments remain in Chinese; core usage is explained in English here and in the runtime guide. API edit links target source files because editing generated pages would be overwritten.
