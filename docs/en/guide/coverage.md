---
title: Coverage and limitations
description: Check resource ownership, build environment, Service Worker control, and browser constraints before integration.
---

# Coverage and limitations

Identify who loads each resource and whether the page is controlled by a Service Worker. The plugin recovers resource loads; the application still deploys backup files and degraded UI.

## Choose the recovery path

| Resource or scenario                                 | Default page runtime                 | Hybrid SW requirements                                                        |
| ---------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Entry scripts and stylesheet links                   | Observer handles element load errors | Page keeps ownership                                                          |
| Literal dynamic imports in Vite production builds    | Build rewriting and Vite adapter     | Page keeps ownership                                                          |
| Webpack JS chunks and extracted CSS chunks           | RuntimeModule and Observer cooperate | Page keeps ownership                                                          |
| Images, fonts, media, CSS `url()`                    | Not covered                          | Controlled page; URL belongs to the manifest's SW-owned asset set             |
| CSS `@import`                                        | Not covered                          | Controlled page; `includeStyleImports` enabled; CSS referrer matches manifest |
| Initial HTML navigation and business fetch/API calls | Not covered                          | Current Hybrid SW does not handle these                                       |
| Worker / SharedWorker and server-side SSR requests   | Not covered                          | Current Hybrid SW does not handle these                                       |

Image recovery applies to manifest assets. An arbitrary external image URL assembled at runtime is not automatically handled merely because its CDN prefix matches.

## Images and fonts: handling conditions {#images-and-fonts}

Enable Hybrid SW and verify all three conditions: the expected worker controls the page, the resource URL matches the build manifest, and candidate responses meet browser CORS/MIME requirements. For a first visit without a controller or an external URL assembled at runtime, check these conditions first.

## First visit and startup

SW registration, installation, activation, and control are asynchronous. Early image/font requests may precede control on the first visit. Inspect `navigator.serviceWorker.controller` and verify first and subsequent visits separately.

Page recovery needs the HTML, runtime, and initializer to load first. With `externalRuntime`, deploy the runtime to an independently available same-origin path and verify startup order. Code that has not executed cannot recover its own failed download.

If entry candidates all fail, React/Vue has not booted. Register [entry degradation](./runtime-events.md#degraded-ui-for-entry-failures) before the entry script; handle terminal lazy-load failures with application error boundaries.

## Environment and execution constraints

- Verify full Vite dynamic-import recovery in build/preview. `enableDev: true` only enables observable script/style failures in dev.
- Replacing a failed synchronous classic script cannot guarantee its original ordering relative to later scripts or undo side effects.
- Cross-origin fonts, modules, and SW requests remain subject to CORS, CSP, MIME, and SRI. Opaque HTTP status is unreadable; see [Hybrid SW](./service-worker.md#opaque-responses).
- The page currently shares one circuit registry. Independent per-rule page circuits are not implemented. See [Configuration](./configuration.md#fallbackrule) for multi-rule URL construction constraints.

## Next steps

- [Compatibility](./compatibility.md): declared support and continuous validation.
- [Quick start](./quick-start.md): reproduce primary CDN failure.
- Deployment: publish identical artifacts and verify candidates.
- [Troubleshooting](./troubleshooting.md): start with the observed symptom.
