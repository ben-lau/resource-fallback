---
title: Upgrading and migration
description: Verify rules, events, circuit behavior, Service Workers, and old assets when upgrading resource-fallback.
---

# Upgrading and migration

This page is for library users. The displayed documentation version comes from repository package.json; main may include unreleased changes. See the [changelog](../changelog.md) for releases.

## Before upgrading

1. Record installed versions, build configuration, and worker path/scope; retain rollback HTML and artifacts.
2. Upgrade the plugin you use. All three packages release together; direct core users should also check the core version so custom runtime files match the plugin.
3. Rebuild and deploy runtime, SW, and assets. Upgrading a plugin does not automatically redeploy a manually hosted external runtime.

```bash
# Choose your plugin
pnpm up -D @resource-fallback/vite-plugin
# Or
pnpm up -D @resource-fallback/webpack-plugin
```

## Current behavior and older assumptions {#behavior}

| Older assumption or usage                      | Current migration                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| RegExp / function rule matching                | Use a string `base` aligned with the build prefix                       |
| Branch on page reason strings                  | Use retry/fallback events to establish recovery; page reason is unknown |
| Independent per-rule page circuit breakers     | Page creates one registry from the first compiled rule                  |
| `__RF__.url()` skips open hosts                | It only constructs the initial URL from the first compiled rule         |
| Build-config hooks survive serialization       | Use DOM events; live hooks only in the first manual install             |
| Page and SW attempts both count total requests | Apply the separate [event definitions](./runtime-events.md#rf-success)  |
| Every first-try success emits success          | Only network success after retry/fallback emits it                      |

Historical changelog entries describe their releases. Use matching-version guides/source when diagnosing current behavior.

## Verify and roll back

Run [release acceptance](./deployment.md#verification) for entry, lazy routes, and CSS; old pages must still retrieve old hashed files. With SW enabled, also test first visits, old/new clients, and cold/warm caches.

Rollback restores matching HTML, configuration, runtime, and resources. A page-file rollback does not immediately remove SW registration; follow [SW operations](./sw-operations.md). Confirm old artifacts and target scope before disabling or deleting caches.
