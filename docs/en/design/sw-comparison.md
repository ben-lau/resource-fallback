---
title: SW Fallback Comparison
---

# Service Worker Resource Fallback — Design Comparison

## Executive summary

Service Worker significantly extends resource fallback coverage — especially for `img`, `video`, `@font-face` fonts, CSS `url()` subresources, and CSS `@import` requests that DOM Observer cannot easily perceive. But SW is **not** a strict superset of the current DOM Observer, Webpack adapter, and Vite adapter. It solves fetch-layer request fallback; it cannot fully replace page-side handling of script execution semantics, builder runtime Promises, SRI tag attributes, and first-load timing.

The recommended path is not SW-first, but **layered**: keep existing script and builder adapter ownership; introduce Hybrid SW for non-script resources and CSS subresources. If strict synchronous classic script ordering is needed later, use an opt-in ScriptSequencer at build and runtime — don't force that problem onto SW.

## Current implementation status

Hybrid SW is implemented as opt-in. Vite/Webpack plugins generate a resource manifest, emit a SW asset, and preload manifest into the SW file so early subresources (images, background images, fonts) don't pass through to the primary CDN before the page `postMessage`s config.

Default SW path follows scope: `scope: '/'` → `/rf-sw.js`, `scope: '/app/'` → `/app/rf-sw.js`. Only when `path` is explicitly outside the scope directory do you need `Service-Worker-Allowed`.

Images and CSS backgrounds often use `no-cors`; SW may only see opaque responses without readable status. By default opaque responses are not failures; demo projects enable `serviceWorker.fallbackOnOpaque` to show visual fallback after fake CDN failure.

## Current baseline

README TODO lists Service Worker interception, image/font support, and sync script ordering as related but independent upgrades. SW extends coverage; it is not a predefined full replacement.

Runtime installs from `packages/core/src/runtime/entry.ts`:

```ts
installObserver({ resolver, bus, log, sri: config.sri || 'strip' });
installWebpackAdapter({
  resolver,
  bus,
  log,
  chunkLoadingGlobals: config.webpackChunkLoadingGlobals,
});
installViteAdapter({ resolver, bus, log });
installSystemJSAdapter({ resolver, bus, log });
```

Adapters share `Resolver`, retry, circuit breaker, and hook bus but handle different failure semantics.

`packages/core/src/runtime/observer.ts` captures `<script>` and `<link rel="stylesheet">` `error`/`load` and replaces with retry or fallback URLs. It does **not** handle `<img>`, `video`, fonts, or CSS internal `url()`/`@import`. It documents sync classic script limits: after failure, `replaceChild` cannot reorder scripts that already continued executing.

`packages/core/src/runtime/adapter-vite.ts` handles Vite dynamic `import()` Promise semantics, module map failure cache busting, and `vite:preloadError` `preventDefault()` — not expressible as fetch success/failure alone.

`packages/core/src/runtime/adapter-webpack.ts` and `packages/webpack-plugin/src/index.ts` handle Webpack async chunks, `__webpack_require__.l`, `data-webpack` ownership, and CSS chunk promise rejections that would otherwise short-circuit `Promise.all`. Ownership must be split with Observer to avoid double state machines.

## Capability comparison

### Script

Classic script, module script, Webpack async chunk, Vite dynamic import, and SystemJS are not the same resource type.

Current approach: Observer for entry `<script>`, Webpack adapter for async chunks, `__RF__.load()` for Vite dynamic import, SystemJS instantiate hook. They switch URLs **and** handle module cache, builder Promises, loader markers, and events.

SW on a controlled page can deliver a successful script response for fetch-layer fallback — valuable when SW controls the request. But SW cannot guarantee early first-visit scripts are controlled, nor modify original `<script integrity="...">`. When SW cannot fix fetch, page adapters still handle failed Promises, cache bust, and events.

**Conclusion**: SW can improve script success rate; it should not replace existing script adapters in phase one.

### Style and CSS subresources

Observer covers top-level `<link rel="stylesheet">` and some runtime-injected CSS chunk `<link>` tags. It cannot see CSS `@import` failures or `background-image: url(...)`, `@font-face src: url(...)` subresource failures.

SW naturally fills this gap when the page is controlled — internal CSS requests go through `fetch`.

Top-level stylesheets need care: Observer + SW on the same `<link>` → duplicate retry, event chaos, inflated circuit counts. Phase one: SW owns CSS subresources and optional `style` destination; Observer keeps top-level stylesheet boundary.

**Conclusion**: CSS `url()`, `@font-face`, `@import` are high-value SW targets; top-level stylesheets need ownership design.

### Font

`@font-face` font requests suit SW fallback — fills a current gap.

Fallback URLs must satisfy browser requirements: CORS headers for cross-origin fonts; MIME, CORP, cache policy. SW cannot override security rejection.

**Conclusion**: Font fallback is supported with SW; document and test CORS/MIME prerequisites.

### Image and media

`img`, `picture`, CSS images, `video`, `audio` lack script execution and builder Promise semantics — best SW MVP targets.

Many cross-origin images use `no-cors` → opaque response. SW reliably fallbacks on fetch rejection (DNS/network); opaque HTTP 404 may be indistinguishable from success.

**Conclusion**: Images/media are Hybrid SW MVP priorities; document opaque response limits.

### Fetch and business APIs

SW can intercept page `fetch()`/XHR, but resource fallback should **not** default to business APIs. APIs have auth, idempotency, credentials, status semantics — different from static CDN fallback.

Future `fetch` destination support should be explicit opt-in with path rules (`/assets/`, `.js`, `.css`, etc.).

**Conclusion**: Don't include business APIs by default.

### Worker and SharedWorker

Page runtime needs `window`, `document`, DOM events — no Worker support. SW ≠ automatic Worker support.

SW intercepts some client requests in scope; Worker lifecycle, `importScripts`, module workers, CSP need separate modeling.

**Conclusion**: Worker support stays independent TODO; not SW MVP criteria.

## Service Worker boundaries

### SW controls page clients, not CDN origin

Page at `https://app.example.com/` registers SW from same origin; controls scope clients. SW can intercept `https://cdn.example.com/assets/a.js` from controlled pages and fallback fetch.

SW cannot install on `cdn.example.com`, control direct CDN URL visits, or out-of-scope iframes/other origins.

### First visit cannot be fully covered

SW register/install/activate/claim is async. First visit early `<script>`, `<link>`, images, fonts may complete before `fetch` events. `clients.claim()` and reload help but cannot precede first HTML parse with an active controller.

Inline runtime and Observer remain valuable for first lifecycle DOM failures.

### SW cannot modify HTML tag attributes

Observer strips/preserves `integrity` per `sri` when replacing tags. SW only returns different responses — original `integrity`, `nonce`, `crossorigin`, `referrerpolicy` unchanged. SRI hash mismatch on fallback CDN fails browser verification even if SW fetch succeeded.

### Opaque response limits

`no-cors` → opaque response: no `status`, `ok`, headers, body. SW cannot reliably distinguish usable image vs opaque 404 HTML. Network errors and fetch rejections are reliable; opaque HTTP errors are not.

### Browser security policies still apply

CORS, MIME, CORP, COEP, CSP, SRI constrain fonts, scripts, styles, workers. SW is not a bypass.

### Event bridge is not free

Page dispatches `rf:*` directly; SW uses `client.postMessage()` → page runtime → DOM CustomEvent. Design for loss, ordering, multi-client, debugging complexity.

## Solution candidates

### Option A: enhance current approach

Extend DOM Observer — listen for `<img>`, `video`, `source` `error`, swap `src`/`srcset`.

**Pros**: Low cost, no SW lifecycle, reuses hook bus/SRI/DOM attr logic.

**Cons**: No CSS `@font-face`, `url()`, `@import`; awkward for `srcset`/`picture`.

**Fit**: Low-cost explicit DOM elements only.

### Option B: Hybrid SW

New SW fetch layer; keep adapter ownership. Phase one: SW for `image`, `font`, `media`, CSS subresources, optional `style`; Observer/Webpack/Vite/SystemJS keep scripts and top-level DOM errors.

**Pros**: Fills biggest gaps without breaking script semantics; avoids double retry on same Webpack/Vite failure.

**Cons**: Requires ownership + event bridge; SW artifact, registration, scope, kill switch, E2E.

**Fit**: Most realistic next step for this library.

### Option C: SW-first

SW owns `script`, `style`, `image`, `font`, `media`, optional `fetch`; page runtime mostly register + bridge.

**Pros**: Unified network layer; max coverage on controlled pages.

**Cons**: Not strict superset — first visit, SRI attrs, opaque, Vite rejection, Webpack CSS promise, module cache still need page logic. Disabling adapters regresses edge cases.

**Fit**: Research or constrained environments (same-origin proxy, no SRI conflict, controlled CORS/MIME, accept reload).

### Option D: full layered architecture

Four layers:

1. Build-time manifest: type, URL, fallback, SRI, ownership
2. Page runtime: SW register, kill switch, event bridge, adapters, first-screen fallback
3. SW: fetch retry/fallback for non-script + CSS subresources
4. ScriptSequencer (opt-in): sync classic script strict ordering

**Pros**: Most complete; manifest reduces SW guessing.

**Cons**: Longest timeline; new build artifacts.

**Fit**: Post–Hybrid SW MVP evolution.

## Cost and risk

| Approach             | Scope                         | Tests                                                                     | Release risk                                       |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| **Enhance Observer** | core observer, types, docs    | Vitest + minimal Playwright                                               | Low; limited benefit                               |
| **Hybrid SW**        | core SW, plugins, bridge, E2E | Vitest + Playwright for SW lifecycle, fonts, opaque                       | Medium; opt-in safe; ownership bugs = double retry |
| **SW-first**         | nearly everything             | Highest — script, dynamic import, CSS promise, SRI, first load, SW update | High — misleading "SW replaces all"                |
| **Full layered**     | manifest + ScriptSequencer    | Largest; split into phases                                                | Scope risk — ship Hybrid MVP first                 |

## Recommended roadmap

**Phase 1**: Design doc + spikes (font CORS, opaque, SRI, first load, builder semantics) before heavy implementation.

**Phase 2**: Hybrid SW MVP — opt-in; `image`, `font`, `media`, CSS `url()`, CSS `@import`; scripts stay on existing adapters.

**Phase 3**: Manifest — Vite/Webpack emit type/URL map; SW decides from manifest; record page-owned resources to avoid duplicates.

**Phase 4**: Evaluate top-level `style` SW ownership only after proving no Observer duplicate retry / Webpack CSS promise regression.

**Phase 5**: ScriptSequencer opt-in if sync classic script ordering is required — build-time queue blocking scripts, serial load with retry/fallback per script.

## Validation spike checklist

1. **First-visit control**: log whether first-screen script/link/img/font enter `fetch` — first visit, refresh, reopen, `clients.claim()`, `skipWaiting`
2. **Opaque image**: no-cors cross-origin image — normal, 404, DNS fail — can SW distinguish and fallback?
3. **Font**: `@font-face` cross-origin `.woff2` with/without CORS on fallback
4. **SRI**: script/style with `integrity` — fallback to matching vs mismatched hash
5. **Vite dynamic import**: SW success vs giveup — `import()` Promise, module map, `__RF__.load` cache bust still needed?
6. **Webpack CSS chunk**: async component with separate CSS chunk — is page-side CSS promise patch still required with SW?
7. **Event bridge**: SW retry/fallback/success/error → `postMessage` → `rf:*` — order, loss, multi-tab
8. **Kill switch**: `__RF_DISABLE__`, query, cookie — does SW pass-through or stop?

## Synchronous script execution order

SW helps sync classic scripts on controlled pages when fetch fallback succeeds before parse continues — closer to original order than Observer's post-hoc `replaceChild`.

SW **cannot** guarantee order when:

- First visit script never entered SW
- All URLs fail — parse may continue after error
- Post-fetch SRI/MIME/CORS/CSP failure
- Subsequent scripts already ran — SW cannot roll back side effects

Sync script strict ordering is **not** SW MVP. **ScriptSequencer** is the reliable path — can coexist with SW as separate opt-in.

## Decision

**Short term: Hybrid SW, not SW-first.**

Not for less work — SW-first cannot cross first-control, SRI attrs, opaque responses, security policy, and builder runtime semantics. Keeping adapters protects solved script/builder problems; SW focuses on fetch-layer resources it handles best.

**Medium term: full layered architecture** — manifest, SW coverage expansion, page runtime for script semantics + event bridge, ScriptSequencer for sync classic scripts. Matches the library goal: zero mental overhead with explicit semantics.

## Related docs

- [Hybrid Service Worker](../guide/service-worker.md)
- [Configuration Reference](../guide/configuration.md)
- [Case Studies](../experience/case-studies.md#410-hybrid-service-worker-images-fonts-css-subresources-sw-is-not-universal-onerror)
