---
title: Introduction
---

# Introduction

Resource Fallback recovers JavaScript and CSS assets built with Vite or Webpack. After a load fails, it retries the original URL, follows the configured CDN order, and can fall back to the page origin.

## What is resource-fallback

Register the plugin in your build configuration to inject the runtime. Keep your existing React.lazy calls, Vue async components, and lazy-loaded routes. For images, fonts, and other subresources, enable [Hybrid Service Worker](./service-worker.md).

| Asset                                                        | Recovery path                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Entry scripts and static or dynamically inserted stylesheets | The page observer listens for load errors on the relevant elements                            |
| Dynamically loaded JS chunks                                 | The Vite or Webpack adapter integrates with its bundler's loader                              |
| Images, fonts, media, and eligible CSS `@import`             | Optional Hybrid Service Worker. See [resource ownership](./service-worker.md#ownership-model) |

## Why resource fallback matters

Frontend static assets are usually served from CDNs. When the primary CDN hits DNS failures, network jitter, or regional outages, pages can white-screen, lose styles, or fail lazy-loaded modules.

Traditional approaches require manual failure handling in business code or complex gateway routing. resource-fallback **injects a runtime at build time and intercepts failures automatically**, retrying the same URL, switching to backup CDNs, and finally falling back to origin — all transparent to application code.

::: tip Use cases

- Multi-CDN disaster recovery and primary/backup switching
- Automatic degradation when static assets fail to load
- Monitoring and observability for fallback chains
  :::

## Integration path

1. Check [coverage](./coverage.md) and [compatibility](./compatibility.md) for your resources and environment.
2. Choose your bundler in [Quick start](./quick-start.md) and configure candidate prefixes.
3. Publish identical artifacts, block the primary CDN in a production build, and compare Network with recovery events.
4. Complete [deployment checks](./deployment.md) for origin, total failure, and old pages; verify SW update/shutdown if enabled.

## Architecture overview

Bundler adapters and Observer receive load failures, then coordinate retries and candidates. Optional Hybrid SW handles images/fonts in its own context. See [How it works](../design/architecture.md) for diagrams.

### Recovery flow {#fallback-flow}

Initial failure → retry the same URL → ordered candidates → success or termination. Circuits and deadlines can skip candidates or end recovery early; see [Configuration](./configuration.md).

## Package structure

### @resource-fallback/core

Browser runtime, types, and Node build helpers. Plugins normally consume it for application integrations.

### @resource-fallback/vite-plugin

Vite HTML injection and production dynamic-import rewriting; see [Vite](./vite.md).

### @resource-fallback/webpack-plugin

Webpack RuntimeModule and HTML injection; see [Webpack](./webpack.md).

## Next steps

- [Quick Start](./quick-start.md) — installation and minimal config
- [Configuration Reference](./configuration.md) — full options
- [Hybrid Service Worker](./service-worker.md) — image, font, and subresource fallback
