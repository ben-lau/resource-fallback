---
title: Troubleshooting
outline: [2, 3]
---

# Troubleshooting

Start with one failed static asset. Use Network to check which URLs were requested, then use the `rf:*` events to find where recovery reached.

## Start with the symptom {#symptoms}

| Signal                                                     | Next check                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| The primary CDN failed with no `rf:retry` or `rf:fallback` | [Check the runtime and rule match](#rule-match)                      |
| `rf:fallback` fired, but the next request failed           | [Check the destination and response](#candidate-response)            |
| `rf:error` fired and the user outcome is unclear           | [Distinguish a terminal error from cache recovery](#terminal-result) |
| Scripts recover, but images or fonts fail                  | [Check Hybrid Service Worker](#service-worker)                       |

::: tip Reproduce one failure at a time
Use a production build and a fresh browser context. Open Network, block one lazy-loaded chunk on the primary CDN, and visit its route. The page can boot, so you can correlate events for that asset.
:::

## Check the runtime and rule match {#rule-match}

1. In Network, find the first failed URL, including its path. Compare it with the build's Vite `base` or Webpack `output.publicPath`, then check which `rules[].base` matches the actual request. The longest matching prefix wins.
2. Check the built HTML and Console. Confirm that the runtime and its initialization script loaded and that the [kill switch](./csp-sri.md) is inactive. With `externalRuntime`, check the runtime URL and the CSP permission for inline initialization.
3. Register [event listeners](./runtime-events.md) before triggering the lazy load. By default, Vite enables full dynamic import recovery in production builds. Follow the [verification steps](./quick-start.md#verification) to reproduce it.

If the same URL recovers after `rf:retry`, expect `rf:success` as the terminal event. With `retry.max: 0`, a matching load failure can go directly to the next destination.

## Check the destination and response {#candidate-response}

- Use `rf:fallback.detail.from` and `to` to identify the two requests. After the prefix changes, confirm that the generated filename and asset subdirectory exist at the destination.
- Inspect the response body and `Content-Type`. A static server's SPA routing fallback may return HTML for a missing JS file. Network can show `200` even when the module fails to load.
- Confirm that each destination serves the same build output. Check Console for cross-origin, CSP, and integrity errors. If you use SRI, check the files and integrity policy against the [CSP and SRI guide](./csp-sri.md).
- When a destination never receives a request, check the `urls` order, whether an earlier destination already recovered, and whether the host's circuit is open. Use [debug logging](./best-practices.md#enable-debug-logging) to investigate.

## Distinguish error from cache recovery {#terminal-result}

`rf:success.detail.url` points to the recovered asset. For page-side recovery, `rf:error.detail.url` points to the current destination when the session ends. That can be a backup CDN or the origin. An entry failure UI should match the entry's [full set of candidate URLs](./runtime-events.md#degraded-ui-for-entry-failures).

Hybrid SW can still find a Cache API response after exhausting network destinations. In that case, `rf:error` describes the network outcome. Check Network and the actual resource on the page to see whether the cache served it.

## Check Hybrid Service Worker {#service-worker}

1. In a secure context, check `navigator.serviceWorker.controller?.scriptURL`. Confirm the expected worker controls the page and its `scope` includes the page URL. On a first visit, return to the page after the worker is ready and try again.
2. Check the request's resource type and owner. Images, fonts, media, and eligible CSS subresources can use [Hybrid SW](./service-worker.md). Scripts use the page-side adapters.
3. A cross-origin `no-cors` request can produce an opaque response whose status the worker cannot read. If recovery needs to act on readable HTTP statuses, check the candidate's CORS response and `fallbackOnOpaque`.

## Verify before release {#release-checks}

- With a **healthy primary CDN**, confirm the asset loads directly. An initial success emits no recovery event.
- With the **primary CDN unavailable**, check the `rf:fallback` destination and the asset that loads.
- With **all CDNs unavailable**, confirm the asset loads from the expected path on the page origin.
- With the **origin unavailable too**, check `rf:error` and the user-facing degraded state. For Hybrid SW, test separately with a cold cache and a populated cache.

Verify the entry script and a lazy-loaded chunk separately. For Hybrid SW, also test an image or font that the page uses.
